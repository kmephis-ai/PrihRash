import type { YandexOwnerOAuthProvider } from './yandexOwnerOAuthFlow.js';

export const YANDEX_OAUTH_TOKEN_URL = 'https://oauth.yandex.ru/token' as const;
export const YANDEX_ID_USER_INFO_URL = 'https://login.yandex.ru/info?format=json' as const;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_OAUTH_VALUE_LENGTH = 8192;

export interface YandexOAuthHttpResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type YandexOAuthFetch = (
  input: string,
  init: Readonly<RequestInit>,
) => Promise<YandexOAuthHttpResponse>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueString(value: unknown, maxLength = MAX_OAUTH_VALUE_LENGTH): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isCodeVerifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 43
    && value.length <= 128
    && /^[A-Za-z0-9._~-]+$/u.test(value);
}

function isHttpsRedirectUri(value: unknown): value is string {
  if (!isOpaqueString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

function providerFailure(): Error {
  return new Error('YANDEX_OAUTH_PROVIDER_FAILED');
}

async function readJson(response: YandexOAuthHttpResponse): Promise<unknown> {
  if (!response.ok) throw providerFailure();
  try {
    return await response.json();
  } catch {
    throw providerFailure();
  }
}

export function createYandexOAuthHttpProvider(
  fetchImpl: YandexOAuthFetch = (input, init) => fetch(input, init),
): Readonly<YandexOwnerOAuthProvider> {
  return Object.freeze({
    async exchangeAuthorizationCode(input: Readonly<{
      clientId: string;
      redirectUri: string;
      code: string;
      codeVerifier: string;
    }>): Promise<string> {
      if (
        !isOpaqueString(input.clientId, 512)
        || !isHttpsRedirectUri(input.redirectUri)
        || !isOpaqueString(input.code, 2048)
        || !isCodeVerifier(input.codeVerifier)
      ) {
        throw providerFailure();
      }

      const body = new URLSearchParams();
      body.set('grant_type', 'authorization_code');
      body.set('code', input.code);
      body.set('client_id', input.clientId);
      body.set('code_verifier', input.codeVerifier);

      let response: YandexOAuthHttpResponse;
      try {
        response = await fetchImpl(YANDEX_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: Object.freeze({
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
          body: body.toString(),
          cache: 'no-store',
          redirect: 'error',
        });
      } catch {
        throw providerFailure();
      }

      const payload = await readJson(response);
      if (!isRecord(payload) || !isOpaqueString(payload.access_token)) throw providerFailure();
      return payload.access_token;
    },

    async fetchUserInfo(accessToken: string): Promise<unknown> {
      if (!isOpaqueString(accessToken)) throw providerFailure();

      let response: YandexOAuthHttpResponse;
      try {
        response = await fetchImpl(YANDEX_ID_USER_INFO_URL, {
          method: 'GET',
          headers: Object.freeze({
            Accept: 'application/json',
            Authorization: `OAuth ${accessToken}`,
          }),
          cache: 'no-store',
          redirect: 'error',
        });
      } catch {
        throw providerFailure();
      }

      const payload = await readJson(response);
      if (!isRecord(payload)) throw providerFailure();
      return payload;
    },
  });
}
