import {
  beginYandexOwnerLogin,
  completeYandexOwnerLogin,
  revokeOwnerSession,
  type OAuthClock,
  type OAuthRandomSource,
  type OwnerSessionIssuer,
  type OwnerSessionRevoker,
  type YandexOwnerOAuthConfig,
  type YandexOwnerOAuthProvider,
  type YandexOwnerOAuthSafeErrorCode,
  type YandexOwnerOAuthTransactionStore,
} from './yandexOwnerOAuthFlow.js';

export const YANDEX_AUTH_START_PATH = '/auth/yandex/start' as const;
export const YANDEX_AUTH_CALLBACK_PATH = '/auth/yandex/callback' as const;
export const OWNER_LOGOUT_PATH = '/auth/logout' as const;
export const OWNER_SESSION_COOKIE_NAME = '__Host-prihrash_session' as const;

const CACHE_CONTROL_NO_STORE = 'no-store';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_SESSION_HANDLE_LENGTH = 2048;

export interface YandexOwnerAuthTransportConfig extends YandexOwnerOAuthConfig {
  readonly appOrigin: string;
}

export interface ApiGatewayV2AuthEvent {
  readonly version: '2.0';
  readonly rawPath: string;
  readonly headers?: Readonly<Record<string, string>> | null;
  readonly queryStringParameters?: Readonly<Record<string, string>> | null;
  readonly cookies?: readonly string[] | null;
  readonly requestContext: Readonly<{
    http: Readonly<{
      method: string;
      path?: string;
    }>;
    apiGateway: Readonly<Record<string, unknown>>;
  }>;
}

export interface ApiGatewayV2AuthResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly isBase64Encoded: false;
}

export interface YandexOwnerAuthTransportDependencies {
  readonly transactionStore: YandexOwnerOAuthTransactionStore;
  readonly provider: YandexOwnerOAuthProvider;
  readonly sessionIssuer: OwnerSessionIssuer;
  readonly sessionRevoker: OwnerSessionRevoker;
  readonly clock?: OAuthClock;
  readonly random?: OAuthRandomSource;
}

export type YandexOwnerAuthTransportSafeErrorCode =
  | YandexOwnerOAuthSafeErrorCode
  | 'AUTH_TRANSPORT_INVALID'
  | 'AUTH_ORIGIN_FORBIDDEN';

const TRANSPORT_INVALID = 'AUTH_TRANSPORT_INVALID' as const;
const ORIGIN_FORBIDDEN = 'AUTH_ORIGIN_FORBIDDEN' as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isHttpsOrigin(value: unknown): value is string {
  if (!isOpaqueString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.origin === value
      && url.pathname === '/'
      && url.search === ''
      && url.hash === ''
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
}

function hasValidTransportConfig(config: Readonly<YandexOwnerAuthTransportConfig>): boolean {
  return isHttpsOrigin(config.appOrigin)
    && config.redirectUri === `${config.appOrigin}${YANDEX_AUTH_CALLBACK_PATH}`;
}

function headerValue(
  headers: Readonly<Record<string, string>> | null | undefined,
  name: string,
): string | null {
  if (headers === null || headers === undefined) return null;
  const lowerName = name.toLowerCase();
  let found: string | null = null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    if (found !== null) return null;
    found = value;
  }
  return found;
}

function parseEvent(value: unknown): ApiGatewayV2AuthEvent | null {
  if (!isRecord(value) || value.version !== '2.0' || typeof value.rawPath !== 'string') return null;
  if (
    !isRecord(value.requestContext)
    || !isRecord(value.requestContext.http)
    || !isRecord(value.requestContext.apiGateway)
  ) return null;
  if (typeof value.requestContext.http.method !== 'string') return null;

  if (
    value.headers !== undefined
    && value.headers !== null
    && (!isRecord(value.headers) || Object.values(value.headers).some((entry) => typeof entry !== 'string'))
  ) {
    return null;
  }
  if (
    value.queryStringParameters !== undefined
    && value.queryStringParameters !== null
    && (!isRecord(value.queryStringParameters)
      || Object.values(value.queryStringParameters).some((entry) => typeof entry !== 'string'))
  ) {
    return null;
  }
  if (
    value.cookies !== undefined
    && value.cookies !== null
    && (!Array.isArray(value.cookies) || value.cookies.some((entry) => typeof entry !== 'string'))
  ) {
    return null;
  }

  return value as unknown as ApiGatewayV2AuthEvent;
}

function baseHeaders(extra: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return Object.freeze({
    'Cache-Control': CACHE_CONTROL_NO_STORE,
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
}

function response(
  statusCode: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Readonly<ApiGatewayV2AuthResponse> {
  return Object.freeze({
    statusCode,
    headers: baseHeaders(headers),
    body,
    isBase64Encoded: false as const,
  });
}

function safeErrorStatus(code: YandexOwnerAuthTransportSafeErrorCode): number {
  switch (code) {
    case 'AUTH_ORIGIN_FORBIDDEN':
    case 'OWNER_IDENTITY_FORBIDDEN':
      return 403;
    case 'AUTH_PROVIDER_DENIED':
      return 401;
    case 'AUTH_CALLBACK_INVALID':
    case 'AUTH_FLOW_INVALID':
    case 'AUTH_IDENTITY_INVALID':
    case 'AUTH_SESSION_INVALID':
    case 'AUTH_TRANSPORT_INVALID':
      return 400;
    case 'AUTH_CONFIG_INVALID':
    case 'AUTH_FLOW_RUNTIME_FAILED':
    case 'AUTH_FLOW_STORE_FAILED':
    case 'AUTH_PROVIDER_FAILED':
    case 'AUTH_SESSION_ISSUE_FAILED':
    case 'AUTH_SESSION_REVOKE_FAILED':
      return 503;
  }
}

function errorResponse(code: YandexOwnerAuthTransportSafeErrorCode): Readonly<ApiGatewayV2AuthResponse> {
  return response(
    safeErrorStatus(code),
    JSON.stringify({ status: 'DENIED', code }),
    Object.freeze({ 'Content-Type': 'application/json; charset=utf-8' }),
  );
}

function encodeSessionHandle(sessionHandle: string): string | null {
  if (!isOpaqueString(sessionHandle, MAX_SESSION_HANDLE_LENGTH)) return null;
  const encoded = Buffer.from(sessionHandle, 'utf8').toString('base64url');
  return encoded.length > 0 && BASE64URL_PATTERN.test(encoded) ? encoded : null;
}

function decodeSessionHandle(encoded: string): string | null {
  if (!BASE64URL_PATTERN.test(encoded) || encoded.length === 0 || encoded.length > 4096) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) return null;
  return isOpaqueString(decoded, MAX_SESSION_HANDLE_LENGTH) ? decoded : null;
}

function sessionCookie(sessionHandle: string, maxAgeSeconds: number): string | null {
  const encoded = encodeSessionHandle(sessionHandle);
  if (encoded === null || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) return null;
  return `${OWNER_SESSION_COOKIE_NAME}=${encoded}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function expiredSessionCookie(): string {
  return `${OWNER_SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function callbackPayload(event: ApiGatewayV2AuthEvent): Readonly<Record<string, string>> {
  const query = event.queryStringParameters ?? {};
  const payload: Record<string, string> = {};
  for (const key of ['state', 'code', 'error'] as const) {
    const value = query[key];
    if (value !== undefined) payload[key] = value;
  }
  return Object.freeze(payload);
}

function sessionHandleFromCookies(cookies: readonly string[] | null | undefined): string | null {
  if (cookies === null || cookies === undefined) return null;
  let encoded: string | null = null;
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator <= 0) continue;
    if (cookie.slice(0, separator) !== OWNER_SESSION_COOKIE_NAME) continue;
    if (encoded !== null) return null;
    encoded = cookie.slice(separator + 1);
  }
  return encoded === null ? null : decodeSessionHandle(encoded);
}

function maxAgeFromExpiry(expiresAtMs: number, nowMs: number, configuredTtlSeconds: number): number | null {
  if (!Number.isSafeInteger(expiresAtMs) || !Number.isSafeInteger(nowMs)) return null;
  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) return null;
  const seconds = Math.floor(remainingMs / 1000);
  if (seconds <= 0 || seconds > configuredTtlSeconds) return null;
  return seconds;
}

export async function handleYandexOwnerAuthRequest(
  config: Readonly<YandexOwnerAuthTransportConfig>,
  eventInput: unknown,
  dependencies: Readonly<YandexOwnerAuthTransportDependencies>,
): Promise<Readonly<ApiGatewayV2AuthResponse>> {
  if (!hasValidTransportConfig(config)) return errorResponse('AUTH_CONFIG_INVALID');
  const event = parseEvent(eventInput);
  if (event === null) return errorResponse(TRANSPORT_INVALID);

  const method = event.requestContext.http.method.toUpperCase();

  if (event.rawPath === YANDEX_AUTH_START_PATH && method === 'GET') {
    const result = await beginYandexOwnerLogin(config, dependencies.transactionStore, {
      ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      ...(dependencies.random === undefined ? {} : { random: dependencies.random }),
    });
    if (result.status === 'DENIED') return errorResponse(result.code);
    return response(302, '', Object.freeze({ Location: result.authorizationUrl }));
  }

  if (event.rawPath === YANDEX_AUTH_CALLBACK_PATH && method === 'GET') {
    const result = await completeYandexOwnerLogin(config, callbackPayload(event), {
      transactionStore: dependencies.transactionStore,
      provider: dependencies.provider,
      sessionIssuer: dependencies.sessionIssuer,
      ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
    });
    if (result.status === 'DENIED') return errorResponse(result.code);

    const nowMs = dependencies.clock?.nowMs() ?? Date.now();
    const maxAge = maxAgeFromExpiry(result.expiresAtMs, nowMs, config.sessionTtlSeconds);
    const cookie = maxAge === null ? null : sessionCookie(result.sessionHandle, maxAge);
    if (cookie === null) {
      try {
        await dependencies.sessionRevoker.revoke(result.sessionHandle);
      } catch {
        // The outward contract remains value-free; durable storage must also expire sessions by TTL.
      }
      return errorResponse('AUTH_SESSION_ISSUE_FAILED');
    }

    return response(303, '', Object.freeze({
      Location: '/',
      'Set-Cookie': cookie,
    }));
  }

  if (event.rawPath === OWNER_LOGOUT_PATH && method === 'POST') {
    const origin = headerValue(event.headers, 'origin');
    if (origin === null || origin !== config.appOrigin) return errorResponse(ORIGIN_FORBIDDEN);

    const sessionHandle = sessionHandleFromCookies(event.cookies);
    if (sessionHandle === null) return errorResponse('AUTH_SESSION_INVALID');
    const result = await revokeOwnerSession(sessionHandle, dependencies.sessionRevoker);
    if (result.status === 'DENIED') return errorResponse(result.code);

    return response(204, '', Object.freeze({ 'Set-Cookie': expiredSessionCookie() }));
  }

  return errorResponse(TRANSPORT_INVALID);
}
