import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OWNER_LOGOUT_PATH,
  OWNER_SESSION_COOKIE_NAME,
  YANDEX_AUTH_CALLBACK_PATH,
  YANDEX_AUTH_START_PATH,
  handleYandexOwnerAuthRequest,
} from '../../dist/auth/yandexOwnerAuthTransport.js';

const NOW_MS = 1_788_856_200_000;
const CONFIG = Object.freeze({
  clientId: 'synthetic-yandex-oauth-client',
  ownerPsuid: '1.synthetic-owner.psuid',
  redirectUri: `https://app.example.invalid${YANDEX_AUTH_CALLBACK_PATH}`,
  sessionTtlSeconds: 900,
  appOrigin: 'https://app.example.invalid',
});

function event(path, method, overrides = {}) {
  return {
    version: '2.0',
    rawPath: path,
    headers: overrides.headers ?? {},
    queryStringParameters: overrides.query ?? {},
    cookies: overrides.cookies ?? [],
    requestContext: { http: { method, path }, apiGateway: {} },
  };
}

function deterministicRandom() {
  const values = [
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
  ];
  return {
    randomBytes(size) {
      assert.equal(size, 32);
      const next = values.shift();
      assert.ok(next);
      return next;
    },
  };
}

function transactionStore() {
  const values = new Map();
  return {
    creates: [],
    consumes: [],
    async create(transaction) {
      this.creates.push(transaction);
      values.set(transaction.state, transaction);
    },
    async consume(state) {
      this.consumes.push(state);
      const value = values.get(state) ?? null;
      values.delete(state);
      return value;
    },
  };
}

function dependencies(overrides = {}) {
  const store = overrides.store ?? transactionStore();
  const capture = {
    exchanges: [],
    infoTokens: [],
    issued: [],
    revoked: [],
  };
  const privateToken = 'private-synthetic-yandex-access-token';
  const privateSessionHandle = overrides.sessionHandle ?? 'private-session;opaque=handle';
  return {
    store,
    capture,
    privateToken,
    privateSessionHandle,
    value: {
      transactionStore: store,
      provider: overrides.provider ?? {
        async exchangeAuthorizationCode(input) {
          capture.exchanges.push(input);
          return privateToken;
        },
        async fetchUserInfo(token) {
          capture.infoTokens.push(token);
          return {
            client_id: CONFIG.clientId,
            psuid: CONFIG.ownerPsuid,
            login: 'ignored-private-login',
          };
        },
      },
      sessionIssuer: overrides.sessionIssuer ?? {
        async issue(input) {
          capture.issued.push(input);
          return privateSessionHandle;
        },
      },
      sessionRevoker: overrides.sessionRevoker ?? {
        async revoke(handle) {
          capture.revoked.push(handle);
        },
      },
      clock: { nowMs: () => NOW_MS },
      random: overrides.random ?? deterministicRandom(),
    },
  };
}

function body(response) {
  return response.body === '' ? null : JSON.parse(response.body);
}

function cookiePair(setCookie) {
  return setCookie.split(';', 1)[0];
}

function assertNoStore(response) {
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers.Pragma, 'no-cache');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
}

test('start accepts only API Gateway v2 and redirects to Yandex with stored state/PKCE', async () => {
  const deps = dependencies();
  const response = await handleYandexOwnerAuthRequest(
    CONFIG,
    event(YANDEX_AUTH_START_PATH, 'GET'),
    deps.value,
  );

  assert.equal(response.statusCode, 302);
  assert.equal(response.body, '');
  assertNoStore(response);
  const url = new URL(response.headers.Location);
  assert.equal(url.origin + url.pathname, 'https://oauth.yandex.ru/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(deps.store.creates.length, 1);
  assert.equal(url.searchParams.get('state'), deps.store.creates[0].state);
});

test('direct Function HTTPS/v1-like event fails closed before auth dependencies', async () => {
  const deps = dependencies();
  const directEvent = {
    httpMethod: 'GET',
    path: YANDEX_AUTH_START_PATH,
    headers: {},
    queryStringParameters: {},
    requestContext: {},
  };

  const response = await handleYandexOwnerAuthRequest(CONFIG, directEvent, deps.value);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(body(response), { status: 'DENIED', code: 'AUTH_TRANSPORT_INVALID' });
  assertNoStore(response);
  assert.equal(deps.store.creates.length, 0);
  assert.equal(deps.capture.exchanges.length, 0);

  const lookalike = event(YANDEX_AUTH_START_PATH, 'GET');
  delete lookalike.requestContext.apiGateway;
  const lookalikeResponse = await handleYandexOwnerAuthRequest(CONFIG, lookalike, deps.value);
  assert.equal(lookalikeResponse.statusCode, 400);
  assert.deepEqual(body(lookalikeResponse), { status: 'DENIED', code: 'AUTH_TRANSPORT_INVALID' });
  assert.equal(deps.store.creates.length, 0);
});

test('callback sets only host secure OWNER session cookie and never reflects OAuth/private values', async () => {
  const deps = dependencies();
  const start = await handleYandexOwnerAuthRequest(CONFIG, event(YANDEX_AUTH_START_PATH, 'GET'), deps.value);
  const state = new URL(start.headers.Location).searchParams.get('state');
  const privateCode = 'private-synthetic-authorization-code';

  const response = await handleYandexOwnerAuthRequest(
    CONFIG,
    event(YANDEX_AUTH_CALLBACK_PATH, 'GET', { query: { state, code: privateCode } }),
    deps.value,
  );

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.Location, '/');
  assertNoStore(response);
  const setCookie = response.headers['Set-Cookie'];
  assert.ok(setCookie.startsWith(`${OWNER_SESSION_COOKIE_NAME}=`));
  assert.ok(setCookie.includes('Max-Age=900'));
  assert.ok(setCookie.includes('Path=/'));
  assert.ok(setCookie.includes('HttpOnly'));
  assert.ok(setCookie.includes('Secure'));
  assert.ok(setCookie.includes('SameSite=Lax'));
  assert.equal(setCookie.includes('Domain='), false);

  const serialized = JSON.stringify(response);
  for (const marker of [
    privateCode,
    deps.privateToken,
    deps.privateSessionHandle,
    CONFIG.clientId,
    CONFIG.ownerPsuid,
    'ignored-private-login',
  ]) {
    assert.equal(serialized.includes(marker), false);
  }
  assert.equal(deps.capture.exchanges.length, 1);
  assert.deepEqual(deps.capture.infoTokens, [deps.privateToken]);
  assert.deepEqual(deps.capture.issued, [{
    role: 'OWNER',
    issuedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + CONFIG.sessionTtlSeconds * 1000,
  }]);
});

test('logout requires exact HTTPS Origin, revokes decoded session once and clears cookie', async () => {
  const deps = dependencies();
  const start = await handleYandexOwnerAuthRequest(CONFIG, event(YANDEX_AUTH_START_PATH, 'GET'), deps.value);
  const state = new URL(start.headers.Location).searchParams.get('state');
  const callback = await handleYandexOwnerAuthRequest(
    CONFIG,
    event(YANDEX_AUTH_CALLBACK_PATH, 'GET', { query: { state, code: 'synthetic-code' } }),
    deps.value,
  );
  const sessionCookie = cookiePair(callback.headers['Set-Cookie']);

  for (const origin of [undefined, 'https://evil.example.invalid', 'http://app.example.invalid']) {
    const headers = origin === undefined ? {} : { Origin: origin };
    const denied = await handleYandexOwnerAuthRequest(
      CONFIG,
      event(OWNER_LOGOUT_PATH, 'POST', { headers, cookies: [sessionCookie] }),
      deps.value,
    );
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(body(denied), { status: 'DENIED', code: 'AUTH_ORIGIN_FORBIDDEN' });
  }
  assert.equal(deps.capture.revoked.length, 0);

  const response = await handleYandexOwnerAuthRequest(
    CONFIG,
    event(OWNER_LOGOUT_PATH, 'POST', {
      headers: { origin: CONFIG.appOrigin },
      cookies: [sessionCookie],
    }),
    deps.value,
  );
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  assert.deepEqual(deps.capture.revoked, [deps.privateSessionHandle]);
  assert.ok(response.headers['Set-Cookie'].startsWith(`${OWNER_SESSION_COOKIE_NAME}=;`));
  assert.ok(response.headers['Set-Cookie'].includes('Max-Age=0'));
  assert.ok(response.headers['Set-Cookie'].includes('HttpOnly'));
  assert.ok(response.headers['Set-Cookie'].includes('Secure'));
  assertNoStore(response);
});

test('invalid/duplicate session cookie never invokes revoker', async () => {
  const deps = dependencies();
  for (const cookies of [
    [],
    [`${OWNER_SESSION_COOKIE_NAME}=not+base64url`],
    [`${OWNER_SESSION_COOKIE_NAME}=QQ`, `${OWNER_SESSION_COOKIE_NAME}=Qg`],
  ]) {
    const response = await handleYandexOwnerAuthRequest(
      CONFIG,
      event(OWNER_LOGOUT_PATH, 'POST', {
        headers: { Origin: CONFIG.appOrigin },
        cookies,
      }),
      deps.value,
    );
    assert.equal(response.statusCode, 400);
    assert.deepEqual(body(response), { status: 'DENIED', code: 'AUTH_SESSION_INVALID' });
  }
  assert.equal(deps.capture.revoked.length, 0);
});

test('provider/callback failures stay value-free and do not set a session cookie', async () => {
  const deps = dependencies({
    provider: {
      async exchangeAuthorizationCode() { throw new Error('private-provider-detail'); },
      async fetchUserInfo() { throw new Error('should-not-run'); },
    },
  });
  const start = await handleYandexOwnerAuthRequest(CONFIG, event(YANDEX_AUTH_START_PATH, 'GET'), deps.value);
  const state = new URL(start.headers.Location).searchParams.get('state');
  const privateCode = 'private-code-never-reflected';
  const response = await handleYandexOwnerAuthRequest(
    CONFIG,
    event(YANDEX_AUTH_CALLBACK_PATH, 'GET', { query: { state, code: privateCode } }),
    deps.value,
  );

  assert.equal(response.statusCode, 503);
  assert.deepEqual(body(response), { status: 'DENIED', code: 'AUTH_PROVIDER_FAILED' });
  assert.equal(response.headers['Set-Cookie'], undefined);
  assert.equal(JSON.stringify(response).includes(privateCode), false);
  assert.equal(JSON.stringify(response).includes('private-provider-detail'), false);
});

test('callback revokes an issued session if transport cannot safely emit its cookie', async () => {
  let clockCalls = 0;
  const store = transactionStore();
  const deps = dependencies({ store });
  deps.value.clock = {
    nowMs() {
      clockCalls += 1;
      return clockCalls <= 3 ? NOW_MS : NOW_MS + CONFIG.sessionTtlSeconds * 1000 + 1;
    },
  };

  const start = await handleYandexOwnerAuthRequest(CONFIG, event(YANDEX_AUTH_START_PATH, 'GET'), deps.value);
  const state = new URL(start.headers.Location).searchParams.get('state');
  const response = await handleYandexOwnerAuthRequest(
    CONFIG,
    event(YANDEX_AUTH_CALLBACK_PATH, 'GET', { query: { state, code: 'synthetic-code' } }),
    deps.value,
  );

  assert.equal(response.statusCode, 503);
  assert.deepEqual(body(response), { status: 'DENIED', code: 'AUTH_SESSION_ISSUE_FAILED' });
  assert.equal(response.headers['Set-Cookie'], undefined);
  assert.deepEqual(deps.capture.revoked, [deps.privateSessionHandle]);
});

test('transport config binds callback URI exactly to app origin and exact route/method', async () => {
  const deps = dependencies();
  const invalidConfig = { ...CONFIG, redirectUri: 'https://other.example.invalid/auth/yandex/callback' };
  const configDenied = await handleYandexOwnerAuthRequest(
    invalidConfig,
    event(YANDEX_AUTH_START_PATH, 'GET'),
    deps.value,
  );
  assert.equal(configDenied.statusCode, 503);
  assert.deepEqual(body(configDenied), { status: 'DENIED', code: 'AUTH_CONFIG_INVALID' });
  assert.equal(deps.store.creates.length, 0);

  for (const input of [
    event(YANDEX_AUTH_START_PATH, 'POST'),
    event(YANDEX_AUTH_CALLBACK_PATH, 'POST'),
    event(OWNER_LOGOUT_PATH, 'GET'),
    event('/auth/unknown', 'GET'),
  ]) {
    const denied = await handleYandexOwnerAuthRequest(CONFIG, input, deps.value);
    assert.equal(denied.statusCode, 400);
    assert.deepEqual(body(denied), { status: 'DENIED', code: 'AUTH_TRANSPORT_INVALID' });
  }
});
