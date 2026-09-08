export interface YandexOwnerIdentityConfig {
  readonly clientId: string;
  readonly ownerPsuid: string;
}

export type YandexOwnerIdentityDenialCode =
  | 'AUTH_CONFIG_INVALID'
  | 'AUTH_IDENTITY_INVALID'
  | 'OWNER_IDENTITY_FORBIDDEN';

export type YandexOwnerIdentityAuthorization =
  | Readonly<{ status: 'AUTHORIZED'; role: 'OWNER' }>
  | Readonly<{ status: 'DENIED'; code: YandexOwnerIdentityDenialCode }>;

const AUTHORIZED_OWNER = Object.freeze({ status: 'AUTHORIZED', role: 'OWNER' } as const);
const INVALID_CONFIG = Object.freeze({ status: 'DENIED', code: 'AUTH_CONFIG_INVALID' } as const);
const INVALID_IDENTITY = Object.freeze({ status: 'DENIED', code: 'AUTH_IDENTITY_INVALID' } as const);
const FORBIDDEN = Object.freeze({ status: 'DENIED', code: 'OWNER_IDENTITY_FORBIDDEN' } as const);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_IDENTITY_LENGTH = 512;

function isOpaqueIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTITY_LENGTH
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function authorizeYandexOwnerIdentity(
  config: Readonly<YandexOwnerIdentityConfig>,
  providerUserInfo: unknown,
): YandexOwnerIdentityAuthorization {
  if (!isOpaqueIdentity(config.clientId) || !isOpaqueIdentity(config.ownerPsuid)) {
    return INVALID_CONFIG;
  }
  if (!isRecord(providerUserInfo)) {
    return INVALID_IDENTITY;
  }

  const clientId = providerUserInfo.client_id;
  const psuid = providerUserInfo.psuid;
  if (!isOpaqueIdentity(clientId) || !isOpaqueIdentity(psuid)) {
    return INVALID_IDENTITY;
  }

  if (clientId !== config.clientId || psuid !== config.ownerPsuid) {
    return FORBIDDEN;
  }
  return AUTHORIZED_OWNER;
}
