import { createHash, randomBytes as secureRandomBytes, timingSafeEqual } from 'node:crypto';

import {
  authorizeYandexOwnerIdentity,
  type YandexOwnerIdentityConfig,
  type YandexOwnerIdentityDenialCode,
} from './yandexOwnerIdentity.js';

export const YANDEX_OAUTH_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize' as const;
export const YANDEX_OWNER_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
export const OWNER_SESSION_MIN_TTL_SECONDS = 5 * 60;
export const OWNER_SESSION_MAX_TTL_SECONDS = 60 * 60;

const GENERATED_SECRET_BYTES = 32;
const GENERATED_BASE64URL_LENGTH = 43;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_OPAQUE_VALUE_LENGTH = 4096;

export interface YandexOwnerOAuthConfig extends YandexOwnerIdentityConfig {
  readonly redirectUri: string;
  readonly sessionTtlSeconds: number;
}

export interface YandexOwnerOAuthTransaction {
  readonly state: string;
  readonly codeVerifier: string;
  readonly createdAtMs: number;
}

export interface YandexOwnerOAuthTransactionStore {
  create(transaction: Readonly<YandexOwnerOAuthTransaction>): Promise<void>;
  consume(state: string): Promise<Readonly<YandexOwnerOAuthTransaction> | null>;
}

export interface YandexOwnerOAuthProvider {
  exchangeAuthorizationCode(input: Readonly<{
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  }>): Promise<string>;
  fetchUserInfo(accessToken: string): Promise<unknown>;
}

export interface OwnerSessionIssuer {
  issue(input: Readonly<{
    role: 'OWNER';
    issuedAtMs: number;
    expiresAtMs: number;
  }>): Promise<string>;
}

export interface OwnerSessionRevoker {
  revoke(sessionHandle: string): Promise<void>;
}

export interface OwnerSessionVerification {
  readonly role: 'OWNER';
  readonly expiresAtMs: number;
}

export interface OwnerSessionVerifier {
  verify(sessionHandle: string, nowMs: number): Promise<Readonly<OwnerSessionVerification> | null>;
}

export interface OAuthClock {
  nowMs(): number;
}

export interface OAuthRandomSource {
  randomBytes(size: number): Uint8Array;
}

export type YandexOwnerOAuthSafeErrorCode =
  | YandexOwnerIdentityDenialCode
  | 'AUTH_CALLBACK_INVALID'
  | 'AUTH_FLOW_INVALID'
  | 'AUTH_FLOW_RUNTIME_FAILED'
  | 'AUTH_FLOW_STORE_FAILED'
  | 'AUTH_PROVIDER_DENIED'
  | 'AUTH_PROVIDER_FAILED'
  | 'AUTH_SESSION_ISSUE_FAILED'
  | 'AUTH_SESSION_INVALID'
  | 'AUTH_SESSION_REVOKE_FAILED';

export type BeginYandexOwnerLoginResult =
  | Readonly<{ status: 'REDIRECT'; authorizationUrl: string }>
  | Readonly<{
    status: 'DENIED';
    code: 'AUTH_CONFIG_INVALID' | 'AUTH_FLOW_RUNTIME_FAILED' | 'AUTH_FLOW_STORE_FAILED';
  }>;

export type CompleteYandexOwnerLoginResult =
  | Readonly<{
    status: 'AUTHENTICATED';
    role: 'OWNER';
    sessionHandle: string;
    expiresAtMs: number;
  }>
  | Readonly<{ status: 'DENIED'; code: YandexOwnerOAuthSafeErrorCode }>;

export type RevokeOwnerSessionResult =
  | Readonly<{ status: 'REVOKED' }>
  | Readonly<{
    status: 'DENIED';
    code: 'AUTH_SESSION_INVALID' | 'AUTH_SESSION_REVOKE_FAILED';
  }>;

const INVALID_CONFIG = Object.freeze({ status: 'DENIED', code: 'AUTH_CONFIG_INVALID' } as const);
const FLOW_RUNTIME_FAILED = Object.freeze({ status: 'DENIED', code: 'AUTH_FLOW_RUNTIME_FAILED' } as const);
const FLOW_STORE_FAILED = Object.freeze({ status: 'DENIED', code: 'AUTH_FLOW_STORE_FAILED' } as const);
const CALLBACK_INVALID = Object.freeze({ status: 'DENIED', code: 'AUTH_CALLBACK_INVALID' } as const);
const FLOW_INVALID = Object.freeze({ status: 'DENIED', code: 'AUTH_FLOW_INVALID' } as const);
const PROVIDER_DENIED = Object.freeze({ status: 'DENIED', code: 'AUTH_PROVIDER_DENIED' } as const);
const PROVIDER_FAILED = Object.freeze({ status: 'DENIED', code: 'AUTH_PROVIDER_FAILED' } as const);
const SESSION_ISSUE_FAILED = Object.freeze({ status: 'DENIED', code: 'AUTH_SESSION_ISSUE_FAILED' } as const);
const SESSION_INVALID = Object.freeze({ status: 'DENIED', code: 'AUTH_SESSION_INVALID' } as const);
const SESSION_REVOKE_FAILED = Object.freeze({ status: 'DENIED', code: 'AUTH_SESSION_REVOKE_FAILED' } as const);
const REVOKED = Object.freeze({ status: 'REVOKED' } as const);

const SYSTEM_CLOCK: OAuthClock = Object.freeze({ nowMs: () => Date.now() });
const SYSTEM_RANDOM: OAuthRandomSource = Object.freeze({
  randomBytes: (size: number) => secureRandomBytes(size),
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueString(value: unknown, maxLength = MAX_OPAQUE_VALUE_LENGTH): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function hasValidIdentityConfig(config: Readonly<YandexOwnerIdentityConfig>): boolean {
  return authorizeYandexOwnerIdentity(config, {
    client_id: config.clientId,
    psuid: config.ownerPsuid,
  }).status === 'AUTHORIZED';
}

function isValidRedirectUri(value: unknown): value is string {
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

function isValidSessionTtlSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= OWNER_SESSION_MIN_TTL_SECONDS
    && (value as number) <= OWNER_SESSION_MAX_TTL_SECONDS;
}

function isValidConfig(config: Readonly<YandexOwnerOAuthConfig>): boolean {
  return hasValidIdentityConfig(config)
    && isValidRedirectUri(config.redirectUri)
    && isValidSessionTtlSeconds(config.sessionTtlSeconds);
}

function generatedBase64Url(random: OAuthRandomSource): string {
  const bytes = random.randomBytes(GENERATED_SECRET_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== GENERATED_SECRET_BYTES) {
    throw new Error('AUTH_RANDOM_SOURCE_INVALID');
  }
  const value = Buffer.from(bytes).toString('base64url');
  if (value.length !== GENERATED_BASE64URL_LENGTH || !BASE64URL_PATTERN.test(value)) {
    throw new Error('AUTH_RANDOM_SOURCE_INVALID');
  }
  return value;
}

function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

function isGeneratedState(value: unknown): value is string {
  return typeof value === 'string'
    && value.length === GENERATED_BASE64URL_LENGTH
    && BASE64URL_PATTERN.test(value);
}

function isCodeVerifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 43
    && value.length <= 128
    && /^[A-Za-z0-9._~-]+$/u.test(value);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function isValidStoredTransaction(
  transaction: Readonly<YandexOwnerOAuthTransaction>,
  expectedState: string,
  nowMs: number,
): boolean {
  if (
    !isGeneratedState(transaction.state)
    || !safeEqual(transaction.state, expectedState)
    || !isCodeVerifier(transaction.codeVerifier)
    || !Number.isSafeInteger(transaction.createdAtMs)
  ) {
    return false;
  }
  const ageMs = nowMs - transaction.createdAtMs;
  return ageMs >= 0 && ageMs <= YANDEX_OWNER_OAUTH_TRANSACTION_TTL_MS;
}

function parseCallback(value: unknown): Readonly<{
  state: string;
  code?: string;
  providerError?: string;
}> | null {
  if (!isRecord(value) || !isGeneratedState(value.state)) return null;
  const hasCode = value.code !== undefined;
  const hasError = value.error !== undefined;
  if (hasCode === hasError) return null;

  if (hasCode) {
    if (!isOpaqueString(value.code, 2048)) return null;
    return Object.freeze({ state: value.state, code: value.code });
  }
  if (!isOpaqueString(value.error, 256)) return null;
  return Object.freeze({ state: value.state, providerError: value.error });
}

export async function beginYandexOwnerLogin(
  config: Readonly<YandexOwnerOAuthConfig>,
  transactionStore: YandexOwnerOAuthTransactionStore,
  options: Readonly<{
    clock?: OAuthClock;
    random?: OAuthRandomSource;
  }> = {},
): Promise<BeginYandexOwnerLoginResult> {
  if (!isValidConfig(config)) return INVALID_CONFIG;

  const clock = options.clock ?? SYSTEM_CLOCK;
  const random = options.random ?? SYSTEM_RANDOM;
  let state: string;
  let codeVerifier: string;
  try {
    state = generatedBase64Url(random);
    codeVerifier = generatedBase64Url(random);
  } catch {
    return FLOW_RUNTIME_FAILED;
  }

  const createdAtMs = clock.nowMs();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) return FLOW_RUNTIME_FAILED;
  const transaction = Object.freeze({ state, codeVerifier, createdAtMs });
  try {
    await transactionStore.create(transaction);
  } catch {
    return FLOW_STORE_FAILED;
  }

  const authorizationUrl = new URL(YANDEX_OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');

  return Object.freeze({ status: 'REDIRECT', authorizationUrl: authorizationUrl.toString() });
}

export async function completeYandexOwnerLogin(
  config: Readonly<YandexOwnerOAuthConfig>,
  callback: unknown,
  dependencies: Readonly<{
    transactionStore: YandexOwnerOAuthTransactionStore;
    provider: YandexOwnerOAuthProvider;
    sessionIssuer: OwnerSessionIssuer;
    clock?: OAuthClock;
  }>,
): Promise<CompleteYandexOwnerLoginResult> {
  if (!isValidConfig(config)) return INVALID_CONFIG;
  const parsed = parseCallback(callback);
  if (parsed === null) return CALLBACK_INVALID;

  let transaction: Readonly<YandexOwnerOAuthTransaction> | null;
  try {
    transaction = await dependencies.transactionStore.consume(parsed.state);
  } catch {
    return FLOW_STORE_FAILED;
  }
  if (transaction === null) return FLOW_INVALID;

  const clock = dependencies.clock ?? SYSTEM_CLOCK;
  const callbackNowMs = clock.nowMs();
  if (!Number.isSafeInteger(callbackNowMs) || callbackNowMs < 0) return FLOW_RUNTIME_FAILED;
  if (!isValidStoredTransaction(transaction, parsed.state, callbackNowMs)) return FLOW_INVALID;
  if (parsed.providerError !== undefined) return PROVIDER_DENIED;
  if (parsed.code === undefined) return CALLBACK_INVALID;

  let accessToken: string;
  let providerUserInfo: unknown;
  try {
    accessToken = await dependencies.provider.exchangeAuthorizationCode(Object.freeze({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      code: parsed.code,
      codeVerifier: transaction.codeVerifier,
    }));
    if (!isOpaqueString(accessToken, 8192)) return PROVIDER_FAILED;
    providerUserInfo = await dependencies.provider.fetchUserInfo(accessToken);
  } catch {
    return PROVIDER_FAILED;
  }

  const authorization = authorizeYandexOwnerIdentity(config, providerUserInfo);
  if (authorization.status === 'DENIED') return authorization;

  const issuedAtMs = clock.nowMs();
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) return FLOW_RUNTIME_FAILED;
  const expiresAtMs = issuedAtMs + config.sessionTtlSeconds * 1000;
  if (!Number.isSafeInteger(expiresAtMs)) return FLOW_RUNTIME_FAILED;

  let sessionHandle: string;
  try {
    sessionHandle = await dependencies.sessionIssuer.issue(Object.freeze({
      role: 'OWNER',
      issuedAtMs,
      expiresAtMs,
    }));
  } catch {
    return SESSION_ISSUE_FAILED;
  }
  if (!isOpaqueString(sessionHandle, 2048)) return SESSION_ISSUE_FAILED;

  return Object.freeze({
    status: 'AUTHENTICATED',
    role: 'OWNER',
    sessionHandle,
    expiresAtMs,
  });
}

export async function revokeOwnerSession(
  sessionHandle: unknown,
  revoker: OwnerSessionRevoker,
): Promise<RevokeOwnerSessionResult> {
  if (!isOpaqueString(sessionHandle, 2048)) return SESSION_INVALID;
  try {
    await revoker.revoke(sessionHandle);
  } catch {
    return SESSION_REVOKE_FAILED;
  }
  return REVOKED;
}
