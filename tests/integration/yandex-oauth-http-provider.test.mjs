import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YANDEX_ID_USER_INFO_URL,
  YANDEX_OAUTH_TOKEN_URL,
  createYandexOAuthHttpProvider,
} from '../../dist/auth/yandexOAuthHttpProvider.js';

const INPUT = Object.freeze({
  clientId: 'synthetic-yandex-client',
  redirectUri: 'https://app.example.invalid/auth/yandex/callback',
  code: 'private-synthetic-authorization-code',
  codeVerifier: 'v'.repeat(43),
});

function response(payload, ok = true) {
  return { ok, async json() { return payload; } };
}

test('Yandex HTTP provider exchanges PKCE code without client_secret and keeps token out of URL', async () => {
  const calls = [];
  const privateToken = 'private-synthetic-access-token';
  const provider = createYandexOAuthHttpProvider(async (url, init) => {
    calls.push({ url, init });
    return response({
      token_type: 'bearer',
      access_token: privateToken,
      refresh_token: 'private-refresh-token-never-returned',
    });
  });

  const token = await provider.exchangeAuthorizationCode(INPUT);
  assert.equal(token, privateToken);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, YANDEX_OAUTH_TOKEN_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.cache, 'no-store');
  assert.equal(call.init.headers.Authorization, undefined);
  assert.equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded');

  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), INPUT.code);
  assert.equal(body.get('client_id'), INPUT.clientId);
  assert.equal(body.get('code_verifier'), INPUT.codeVerifier);
  assert.equal(body.has('client_secret'), false);
  assert.equal(body.has('redirect_uri'), false);
  assert.equal(call.url.includes(INPUT.code), false);
  assert.equal(call.url.includes(privateToken), false);
});

test('Yandex HTTP provider requests /info with Authorization header and never oauth_token query', async () => {
  const calls = [];
  const privateToken = 'private-synthetic-access-token';
  const profile = {
    client_id: INPUT.clientId,
    psuid: '1.synthetic-owner.psuid',
    login: 'ignored-private-login',
  };
  const provider = createYandexOAuthHttpProvider(async (url, init) => {
    calls.push({ url, init });
    return response(profile);
  });

  const result = await provider.fetchUserInfo(privateToken);
  assert.deepEqual(result, profile);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, YANDEX_ID_USER_INFO_URL);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `OAuth ${privateToken}`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].url.includes(privateToken), false);
  assert.equal(calls[0].url.includes('oauth_token'), false);
});

test('provider network/status/json failures expose only one value-free error', async () => {
  const privateMarkers = [
    INPUT.code,
    'private-provider-body',
    'private-provider-network-detail',
  ];
  const cases = [
    async () => { throw new Error('private-provider-network-detail'); },
    async () => response({ error: 'private-provider-body' }, false),
    async () => ({ ok: true, async json() { throw new Error('private-provider-body'); } }),
    async () => response({ access_token: '' }),
  ];

  for (const fetchImpl of cases) {
    const provider = createYandexOAuthHttpProvider(fetchImpl);
    await assert.rejects(
      provider.exchangeAuthorizationCode(INPUT),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message, 'YANDEX_OAUTH_PROVIDER_FAILED');
        for (const marker of privateMarkers) assert.equal(error.message.includes(marker), false);
        return true;
      },
    );
  }
});

test('malformed provider input fails before fetch', async () => {
  let calls = 0;
  const provider = createYandexOAuthHttpProvider(async () => {
    calls += 1;
    return response({ access_token: 'should-not-be-called' });
  });

  await assert.rejects(
    provider.exchangeAuthorizationCode({ ...INPUT, codeVerifier: 'too-short' }),
    /YANDEX_OAUTH_PROVIDER_FAILED/u,
  );
  await assert.rejects(provider.fetchUserInfo(''), /YANDEX_OAUTH_PROVIDER_FAILED/u);
  assert.equal(calls, 0);
});
