import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OWNER_SESSION_MAX_TTL_SECONDS,
  OWNER_SESSION_MIN_TTL_SECONDS,
  YANDEX_OWNER_OAUTH_TRANSACTION_TTL_MS,
  beginYandexOwnerLogin,
  completeYandexOwnerLogin,
  revokeOwnerSession,
} from '../../dist/auth/yandexOwnerOAuthFlow.js';

const CONFIG = Object.freeze({
  clientId: 'synthetic-yandex-oauth-client',
  ownerPsuid: '1.synthetic-owner.psuid',
  redirectUri: 'https://app.example.invalid/auth/yandex/callback',
  sessionTtlSeconds: 900,
});
const NOW_MS = 1_788_855_600_000;

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

function clock(nowMs = NOW_MS) {
  return { nowMs: () => nowMs };
}

function transactionStore() {
  const values = new Map();
  return {
    creates: [],
    consumes: [],
    async create(transaction) {
      if (values.has(transaction.state)) throw new Error('duplicate synthetic state');
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

function provider(capture, overrides = {}) {
  return {
    async exchangeAuthorizationCode(input) {
      capture.exchanges.push(input);
      if (overrides.exchangeError) throw new Error('private-provider-exchange-detail');
      return overrides.accessToken ?? 'private-synthetic-oauth-access-token';
    },
    async fetchUserInfo(accessToken) {
      capture.infoTokens.push(accessToken);
      if (overrides.infoError) throw new Error('private-provider-info-detail');
      return overrides.userInfo ?? {
        client_id: CONFIG.clientId,
        psuid: CONFIG.ownerPsuid,
        login: 'ignored-private-login',
      };
    },
  };
}

function sessionIssuer(capture, overrides = {}) {
  return {
    async issue(input) {
      capture.sessions.push(input);
      if (overrides.issueError) throw new Error('private-session-store-detail');
      return overrides.sessionHandle ?? 'synthetic-owner-session-handle';
    },
  };
}

async function startedFlow(store = transactionStore()) {
  const result = await beginYandexOwnerLogin(CONFIG, store, {
    clock: clock(),
    random: deterministicRandom(),
  });
  assert.equal(result.status, 'REDIRECT');
  const authorizationUrl = new URL(result.authorizationUrl);
  return { store, result, authorizationUrl, state: authorizationUrl.searchParams.get('state') };
}

function assertSafeDenial(result, code, privateMarkers = []) {
  assert.deepEqual(result, { status: 'DENIED', code });
  const serialized = JSON.stringify(result);
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false);
  }
}

test('begin login creates one stored 256-bit state/PKCE transaction and S256 authorization URL', async () => {
  const store = transactionStore();
  const { authorizationUrl, state } = await startedFlow(store);
  assert.equal(store.creates.length, 1);
  const stored = store.creates[0];

  assert.equal(state, stored.state);
  assert.match(stored.state, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(stored.codeVerifier, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(stored.createdAtMs, NOW_MS);
  assert.equal(Object.isFrozen(stored), true);

  const expectedChallenge = createHash('sha256')
    .update(stored.codeVerifier, 'ascii')
    .digest('base64url');
  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://oauth.yandex.ru/authorize');
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('client_id'), CONFIG.clientId);
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(authorizationUrl.searchParams.get('code_challenge'), expectedChallenge);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
});

test('successful callback consumes flow once, uses stored verifier, authorizes OWNER and issues bounded session', async () => {
  const { store, state } = await startedFlow();
  const capture = { exchanges: [], infoTokens: [], sessions: [] };
  const privateCode = 'private-synthetic-authorization-code';
  const privateToken = 'private-synthetic-oauth-access-token';

  const result = await completeYandexOwnerLogin(CONFIG, { state, code: privateCode }, {
    transactionStore: store,
    provider: provider(capture, { accessToken: privateToken }),
    sessionIssuer: sessionIssuer(capture),
    clock: clock(),
  });

  assert.deepEqual(result, {
    status: 'AUTHENTICATED',
    role: 'OWNER',
    sessionHandle: 'synthetic-owner-session-handle',
    expiresAtMs: NOW_MS + CONFIG.sessionTtlSeconds * 1000,
  });
  assert.equal(store.consumes.length, 1);
  assert.equal(capture.exchanges.length, 1);
  assert.equal(capture.exchanges[0].code, privateCode);
  assert.equal(capture.exchanges[0].codeVerifier, store.creates[0].codeVerifier);
  assert.deepEqual(capture.infoTokens, [privateToken]);
  assert.deepEqual(capture.sessions, [{
    role: 'OWNER',
    issuedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + CONFIG.sessionTtlSeconds * 1000,
  }]);
  assert.equal(JSON.stringify(capture.sessions).includes(privateToken), false);
  assert.equal(JSON.stringify(result).includes(privateToken), false);
  assert.equal(JSON.stringify(result).includes(privateCode), false);
  assert.equal(JSON.stringify(result).includes(CONFIG.ownerPsuid), false);

  const replay = await completeYandexOwnerLogin(CONFIG, { state, code: privateCode }, {
    transactionStore: store,
    provider: provider(capture),
    sessionIssuer: sessionIssuer(capture),
    clock: clock(),
  });
  assertSafeDenial(replay, 'AUTH_FLOW_INVALID', [privateCode]);
  assert.equal(capture.exchanges.length, 1);
  assert.equal(capture.sessions.length, 1);
});

test('missing, malformed, mismatched and expired state fail before provider exchange', async () => {
  const capture = { exchanges: [], infoTokens: [], sessions: [] };
  const { store, state } = await startedFlow();
  const privateCode = 'private-code-never-sent';

  assertSafeDenial(
    await completeYandexOwnerLogin(CONFIG, { code: privateCode }, {
      transactionStore: store,
      provider: provider(capture),
      sessionIssuer: sessionIssuer(capture),
      clock: clock(),
    }),
    'AUTH_CALLBACK_INVALID',
    [privateCode],
  );

  const mismatchedState = 'A'.repeat(43);
  assertSafeDenial(
    await completeYandexOwnerLogin(CONFIG, { state: mismatchedState, code: privateCode }, {
      transactionStore: store,
      provider: provider(capture),
      sessionIssuer: sessionIssuer(capture),
      clock: clock(),
    }),
    'AUTH_FLOW_INVALID',
    [privateCode, mismatchedState],
  );

  assert.equal(capture.exchanges.length, 0);
  assert.equal(capture.sessions.length, 0);
  assert.equal(store.consumes.includes(state), false);

  assertSafeDenial(
    await completeYandexOwnerLogin(CONFIG, { state, code: privateCode }, {
      transactionStore: store,
      provider: provider(capture),
      sessionIssuer: sessionIssuer(capture),
      clock: clock(NOW_MS + YANDEX_OWNER_OAUTH_TRANSACTION_TTL_MS + 1),
    }),
    'AUTH_FLOW_INVALID',
    [privateCode, state],
  );
  assert.equal(capture.exchanges.length, 0);
});

test('provider denial consumes the transaction and never exchanges a code', async () => {
  const { store, state } = await startedFlow();
  const capture = { exchanges: [], infoTokens: [], sessions: [] };
  const privateDescription = 'private-user-denial-description';

  const result = await completeYandexOwnerLogin(CONFIG, {
    state,
    error: 'access_denied',
    error_description: privateDescription,
  }, {
    transactionStore: store,
    provider: provider(capture),
    sessionIssuer: sessionIssuer(capture),
    clock: clock(),
  });

  assertSafeDenial(result, 'AUTH_PROVIDER_DENIED', [privateDescription, state]);
  assert.equal(store.consumes.length, 1);
  assert.equal(capture.exchanges.length, 0);
  assert.equal(capture.sessions.length, 0);
});

test('provider failures are value-free and never issue a session', async () => {
  for (const overrides of [{ exchangeError: true }, { infoError: true }]) {
    const { store, state } = await startedFlow();
    const capture = { exchanges: [], infoTokens: [], sessions: [] };
    const result = await completeYandexOwnerLogin(CONFIG, {
      state,
      code: 'private-provider-failure-code',
    }, {
      transactionStore: store,
      provider: provider(capture, overrides),
      sessionIssuer: sessionIssuer(capture),
      clock: clock(),
    });
    assertSafeDenial(result, 'AUTH_PROVIDER_FAILED', [
      'private-provider-failure-code',
      'private-provider-exchange-detail',
      'private-provider-info-detail',
      'private-synthetic-oauth-access-token',
    ]);
    assert.equal(capture.sessions.length, 0);
  }
});

test('identity mismatch uses existing OWNER verifier and does not issue session', async () => {
  const { store, state } = await startedFlow();
  const capture = { exchanges: [], infoTokens: [], sessions: [] };
  const privateWrongPsuid = 'private-not-owner-psuid';
  const result = await completeYandexOwnerLogin(CONFIG, {
    state,
    code: 'private-valid-code',
  }, {
    transactionStore: store,
    provider: provider(capture, {
      userInfo: {
        client_id: CONFIG.clientId,
        psuid: privateWrongPsuid,
        login: 'private-owner-like-login',
      },
    }),
    sessionIssuer: sessionIssuer(capture),
    clock: clock(),
  });

  assertSafeDenial(result, 'OWNER_IDENTITY_FORBIDDEN', [privateWrongPsuid, 'private-owner-like-login']);
  assert.equal(capture.sessions.length, 0);
});

test('config enforces HTTPS redirect and bounded short session TTL before transaction storage', async () => {
  const cases = [
    { ...CONFIG, redirectUri: 'http://app.example.invalid/callback' },
    { ...CONFIG, redirectUri: 'https://user:pass@app.example.invalid/callback' },
    { ...CONFIG, redirectUri: 'https://app.example.invalid/callback#fragment' },
    { ...CONFIG, sessionTtlSeconds: OWNER_SESSION_MIN_TTL_SECONDS - 1 },
    { ...CONFIG, sessionTtlSeconds: OWNER_SESSION_MAX_TTL_SECONDS + 1 },
    { ...CONFIG, sessionTtlSeconds: 900.5 },
  ];
  for (const invalidConfig of cases) {
    const store = transactionStore();
    const result = await beginYandexOwnerLogin(invalidConfig, store, {
      clock: clock(),
      random: deterministicRandom(),
    });
    assertSafeDenial(result, 'AUTH_CONFIG_INVALID', [invalidConfig.redirectUri]);
    assert.equal(store.creates.length, 0);
  }
});

test('entropy and clock runtime failures use a distinct value-free safe code', async () => {
  const privateMarker = 'private-runtime-marker';
  const store = transactionStore();
  assertSafeDenial(
    await beginYandexOwnerLogin(CONFIG, store, {
      clock: clock(),
      random: { randomBytes() { throw new Error(privateMarker); } },
    }),
    'AUTH_FLOW_RUNTIME_FAILED',
    [privateMarker],
  );
  assert.equal(store.creates.length, 0);

  assertSafeDenial(
    await beginYandexOwnerLogin(CONFIG, store, {
      clock: { nowMs: () => Number.NaN },
      random: deterministicRandom(),
    }),
    'AUTH_FLOW_RUNTIME_FAILED',
    [privateMarker],
  );
  assert.equal(store.creates.length, 0);
});

test('transaction-store and session-issuer failures expose only safe codes', async () => {
  const privateMarker = 'private-storage-marker';
  const createFailureStore = {
    async create() { throw new Error(privateMarker); },
    async consume() { return null; },
  };
  assertSafeDenial(
    await beginYandexOwnerLogin(CONFIG, createFailureStore, {
      clock: clock(),
      random: deterministicRandom(),
    }),
    'AUTH_FLOW_STORE_FAILED',
    [privateMarker],
  );

  const { store, state } = await startedFlow();
  const capture = { exchanges: [], infoTokens: [], sessions: [] };
  const result = await completeYandexOwnerLogin(CONFIG, { state, code: 'private-valid-code' }, {
    transactionStore: store,
    provider: provider(capture),
    sessionIssuer: sessionIssuer(capture, { issueError: true }),
    clock: clock(),
  });
  assertSafeDenial(result, 'AUTH_SESSION_ISSUE_FAILED', [
    privateMarker,
    'private-session-store-detail',
    'private-synthetic-oauth-access-token',
  ]);
});

test('logout validates opaque handle and uses explicit revocation port with value-free failure', async () => {
  const revoked = [];
  assert.deepEqual(await revokeOwnerSession('synthetic-owner-session-handle', {
    async revoke(handle) { revoked.push(handle); },
  }), { status: 'REVOKED' });
  assert.deepEqual(revoked, ['synthetic-owner-session-handle']);

  assertSafeDenial(
    await revokeOwnerSession(' private-session-handle', { async revoke() {} }),
    'AUTH_SESSION_INVALID',
    ['private-session-handle'],
  );
  assertSafeDenial(
    await revokeOwnerSession('private-session-handle', {
      async revoke() { throw new Error('private-revocation-detail'); },
    }),
    'AUTH_SESSION_REVOKE_FAILED',
    ['private-session-handle', 'private-revocation-detail'],
  );
});
