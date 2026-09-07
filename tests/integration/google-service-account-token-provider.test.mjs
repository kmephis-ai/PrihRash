import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOOGLE_SHEETS_READONLY_SCOPE,
  GoogleServiceAccountTokenProviderError,
  createGoogleServiceAccountSheetsAccessTokenProvider,
  createGoogleSheetsAccessTokenProviderFromClient,
} from '../../dist/integration/google/googleServiceAccountTokenProvider.js';

const SYNTHETIC_EMAIL = 'synthetic-reader@example.invalid';
const SYNTHETIC_PRIVATE_KEY = [
  '-----BEGIN ' + 'PRIVATE KEY-----',
  'synthetic-not-a-real-key',
  '-----END ' + 'PRIVATE KEY-----',
  '',
].join('\n');

test('read-only scope is exact and does not grant write access', () => {
  assert.equal(
    GOOGLE_SHEETS_READONLY_SCOPE,
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  );
  assert.equal(GOOGLE_SHEETS_READONLY_SCOPE.includes('drive'), false);
});

test('client adapter unwraps the Google JWT token response and trims the token', async () => {
  let calls = 0;
  const provider = createGoogleSheetsAccessTokenProviderFromClient({
    async getAccessToken() {
      calls += 1;
      return { token: '  synthetic-access-token  ', res: null };
    },
  });

  assert.equal(await provider.getAccessToken(), 'synthetic-access-token');
  assert.equal(calls, 1);
});

test('client adapter also accepts a direct string token for narrow test/provider compatibility', async () => {
  const provider = createGoogleSheetsAccessTokenProviderFromClient({
    async getAccessToken() {
      return 'synthetic-direct-token';
    },
  });
  assert.equal(await provider.getAccessToken(), 'synthetic-direct-token');
});

test('client adapter fails closed for malformed, null or blank token response', async () => {
  const responses = [
    null,
    '',
    '   ',
    {},
    { token: null },
    { token: '' },
    { token: '   ' },
    { token: 123 },
  ];
  for (const response of responses) {
    const provider = createGoogleSheetsAccessTokenProviderFromClient({
      async getAccessToken() {
        return response;
      },
    });

    await assert.rejects(
      () => provider.getAccessToken(),
      (error) => error instanceof GoogleServiceAccountTokenProviderError
        && error.code === 'INVALID_ACCESS_TOKEN'
        && error.message === 'INVALID_ACCESS_TOKEN',
    );
  }
});

test('client acquisition failure is wrapped without leaking provider error payload', async () => {
  const secretLikePayload = 'synthetic-private-key-fragment';
  const provider = createGoogleSheetsAccessTokenProviderFromClient({
    async getAccessToken() {
      throw new Error(secretLikePayload);
    },
  });

  await assert.rejects(
    () => provider.getAccessToken(),
    (error) => error instanceof GoogleServiceAccountTokenProviderError
      && error.code === 'TOKEN_ACQUISITION_FAILED'
      && !error.message.includes(secretLikePayload)
      && !String(error.stack).includes(secretLikePayload),
  );
});

test('service-account constructor rejects malformed credentials before JWT network use', () => {
  const badCredentials = [
    { clientEmail: '', privateKey: SYNTHETIC_PRIVATE_KEY, code: 'INVALID_SERVICE_ACCOUNT_EMAIL' },
    { clientEmail: ' synthetic@example.invalid', privateKey: SYNTHETIC_PRIVATE_KEY, code: 'INVALID_SERVICE_ACCOUNT_EMAIL' },
    { clientEmail: 'synthetic-without-at', privateKey: SYNTHETIC_PRIVATE_KEY, code: 'INVALID_SERVICE_ACCOUNT_EMAIL' },
    { clientEmail: SYNTHETIC_EMAIL, privateKey: '', code: 'INVALID_SERVICE_ACCOUNT_PRIVATE_KEY' },
    { clientEmail: SYNTHETIC_EMAIL, privateKey: '   ', code: 'INVALID_SERVICE_ACCOUNT_PRIVATE_KEY' },
  ];

  for (const item of badCredentials) {
    assert.throws(
      () => createGoogleServiceAccountSheetsAccessTokenProvider(item),
      (error) => error instanceof GoogleServiceAccountTokenProviderError
        && error.code === item.code
        && !error.message.includes(SYNTHETIC_PRIVATE_KEY),
    );
  }
});

test('valid credential shape creates the existing Sheets access-token provider boundary without reading a token', () => {
  const provider = createGoogleServiceAccountSheetsAccessTokenProvider({
    clientEmail: SYNTHETIC_EMAIL,
    privateKey: SYNTHETIC_PRIVATE_KEY,
  });

  assert.equal(typeof provider.getAccessToken, 'function');
});
