export const YANDEX_YDB_DATABASES_API = 'https://ydb.api.cloud.yandex.net/ydb/v1/databases' as const;

export type YdbResourceLimitsDatabaseDiscovery = 'SINGLE' | 'NONE' | 'AMBIGUOUS' | 'READ_FAILED';
export type YdbResourceLimitsMode = 'SERVERLESS' | 'DEDICATED' | 'UNKNOWN';
export type YdbResourceLimitsFailureStage =
  | 'NONE'
  | 'TARGET_CONFIG_INVALID'
  | 'TRANSPORT_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_5XX'
  | 'UNEXPECTED_STATUS'
  | 'MALFORMED_JSON'
  | 'IDENTITY_MISMATCH'
  | 'LIMITS_MALFORMED';

export interface YdbResourceLimitsEvidence {
  readonly status: 'PASS';
  readonly code: 'YDB_RESOURCE_LIMITS_CLASSIFIED';
  readonly databaseDiscovery: YdbResourceLimitsDatabaseDiscovery;
  readonly failureStage: YdbResourceLimitsFailureStage;
  readonly mode: YdbResourceLimitsMode;
  readonly enableThrottlingRcuLimit: boolean | null;
  readonly throttlingRcuLimit: number | null;
  readonly provisionedRcuLimit: number | null;
}

export interface YandexFunctionServiceAccountContext {
  readonly token?: unknown;
}

export interface YdbResourceLimitsEnvironment {
  readonly PRIHRASH_YC_FOLDER_ID?: string;
  readonly PRIHRASH_YDB_CONNECTION_STRING?: string;
}

export interface YdbResourceLimitsFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function emptyEvidence(
  databaseDiscovery: YdbResourceLimitsDatabaseDiscovery,
  failureStage: YdbResourceLimitsFailureStage,
): Readonly<YdbResourceLimitsEvidence> {
  return Object.freeze({
    status: 'PASS' as const,
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED' as const,
    databaseDiscovery,
    failureStage,
    mode: 'UNKNOWN' as const,
    enableThrottlingRcuLimit: null,
    throttlingRcuLimit: null,
    provisionedRcuLimit: null,
  });
}

function parseNonnegativeSafeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function classifySingleDatabase(database: unknown): Readonly<YdbResourceLimitsEvidence> {
  const value = record(database);
  if (value === null) return emptyEvidence('READ_FAILED', 'MALFORMED_JSON');

  const serverless = record(value.serverlessDatabase);
  const dedicated = record(value.dedicatedDatabase);
  if (serverless !== null && dedicated !== null) return emptyEvidence('READ_FAILED', 'LIMITS_MALFORMED');

  if (serverless !== null) {
    const enabled = serverless.enableThrottlingRcuLimit;
    const throttling = parseNonnegativeSafeInteger(serverless.throttlingRcuLimit);
    const provisioned = parseNonnegativeSafeInteger(serverless.provisionedRcuLimit);
    if (typeof enabled !== 'boolean' || throttling === null || provisioned === null) {
      return emptyEvidence('READ_FAILED', 'LIMITS_MALFORMED');
    }
    return Object.freeze({
      status: 'PASS' as const,
      code: 'YDB_RESOURCE_LIMITS_CLASSIFIED' as const,
      databaseDiscovery: 'SINGLE' as const,
      failureStage: 'NONE' as const,
      mode: 'SERVERLESS' as const,
      enableThrottlingRcuLimit: enabled,
      throttlingRcuLimit: throttling,
      provisionedRcuLimit: provisioned,
    });
  }

  if (dedicated !== null) {
    return Object.freeze({
      status: 'PASS' as const,
      code: 'YDB_RESOURCE_LIMITS_CLASSIFIED' as const,
      databaseDiscovery: 'SINGLE' as const,
      failureStage: 'NONE' as const,
      mode: 'DEDICATED' as const,
      enableThrottlingRcuLimit: null,
      throttlingRcuLimit: null,
      provisionedRcuLimit: null,
    });
  }

  return Object.freeze({
    status: 'PASS' as const,
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED' as const,
    databaseDiscovery: 'SINGLE' as const,
    failureStage: 'NONE' as const,
    mode: 'UNKNOWN' as const,
    enableThrottlingRcuLimit: null,
    throttlingRcuLimit: null,
    provisionedRcuLimit: null,
  });
}

function providerPathSegment(value: string): boolean {
  return /^[a-z0-9-]+$/u.test(value);
}

export function parseYdbDatabaseIdFromConnectionString(
  connectionString: unknown,
): string | null {
  if (!nonBlank(connectionString)) return null;

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'grpcs:'
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.hash.length > 0
  ) {
    return null;
  }

  const databaseValues = parsed.searchParams.getAll('database');
  if (databaseValues.length !== 1) return null;
  const databasePath = databaseValues[0];
  if (!nonBlank(databasePath)) return null;

  const segments = databasePath.split('/');
  if (segments.length !== 4 || segments[0] !== '') return null;
  const region = segments[1];
  const providerScope = segments[2];
  const databaseId = segments[3];
  if (
    !nonBlank(region)
    || !providerPathSegment(region)
    || !nonBlank(providerScope)
    || !providerPathSegment(providerScope)
    || !nonBlank(databaseId)
    || !providerPathSegment(databaseId)
  ) {
    return null;
  }
  return databaseId;
}

export async function readYdbResourceLimitsWithRuntimeServiceAccount(
  environment: YdbResourceLimitsEnvironment,
  context: YandexFunctionServiceAccountContext | unknown,
  fetchImpl: YdbResourceLimitsFetch = (input, init) => fetch(input, init),
): Promise<Readonly<YdbResourceLimitsEvidence>> {
  const folderId = environment.PRIHRASH_YC_FOLDER_ID;
  const databaseId = parseYdbDatabaseIdFromConnectionString(
    environment.PRIHRASH_YDB_CONNECTION_STRING,
  );
  const contextRecord = record(context);
  const token = contextRecord === null ? null : record(contextRecord.token);
  const accessToken = token?.access_token;
  if (databaseId === null || !nonBlank(folderId) || !nonBlank(accessToken)) {
    return emptyEvidence('READ_FAILED', 'TARGET_CONFIG_INVALID');
  }

  const url = new URL(`${YANDEX_YDB_DATABASES_API}/${encodeURIComponent(databaseId)}`);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: Object.freeze({
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      }),
      redirect: 'error',
    });
  } catch {
    return emptyEvidence('READ_FAILED', 'TRANSPORT_FAILED');
  }
  if (!response.ok) {
    if (response.status === 401) return emptyEvidence('READ_FAILED', 'UNAUTHORIZED');
    if (response.status === 403) return emptyEvidence('READ_FAILED', 'FORBIDDEN');
    if (response.status === 404) return emptyEvidence('READ_FAILED', 'NOT_FOUND');
    if (response.status === 429) return emptyEvidence('READ_FAILED', 'RATE_LIMITED');
    if (response.status >= 500 && response.status <= 599) return emptyEvidence('READ_FAILED', 'PROVIDER_5XX');
    return emptyEvidence('READ_FAILED', 'UNEXPECTED_STATUS');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return emptyEvidence('READ_FAILED', 'MALFORMED_JSON');
  }
  const database = record(payload);
  if (
    database === null
    || database.id !== databaseId
    || database.folderId !== folderId
  ) {
    return emptyEvidence('READ_FAILED', 'IDENTITY_MISMATCH');
  }
  return classifySingleDatabase(database);
}
