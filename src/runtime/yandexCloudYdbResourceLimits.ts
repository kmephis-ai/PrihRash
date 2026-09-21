export const YANDEX_YDB_DATABASES_API = 'https://ydb.api.cloud.yandex.net/ydb/v1/databases' as const;

export type YdbResourceLimitsDatabaseDiscovery = 'SINGLE' | 'NONE' | 'AMBIGUOUS' | 'READ_FAILED';
export type YdbResourceLimitsMode = 'SERVERLESS' | 'DEDICATED' | 'UNKNOWN';

export interface YdbResourceLimitsEvidence {
  readonly status: 'PASS';
  readonly code: 'YDB_RESOURCE_LIMITS_CLASSIFIED';
  readonly databaseDiscovery: YdbResourceLimitsDatabaseDiscovery;
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

function emptyEvidence(databaseDiscovery: YdbResourceLimitsDatabaseDiscovery): Readonly<YdbResourceLimitsEvidence> {
  return Object.freeze({
    status: 'PASS' as const,
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED' as const,
    databaseDiscovery,
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
  if (value === null) return emptyEvidence('READ_FAILED');

  const serverless = record(value.serverlessDatabase);
  const dedicated = record(value.dedicatedDatabase);
  if (serverless !== null && dedicated !== null) return emptyEvidence('READ_FAILED');

  if (serverless !== null) {
    const enabled = serverless.enableThrottlingRcuLimit;
    const throttling = parseNonnegativeSafeInteger(serverless.throttlingRcuLimit);
    const provisioned = parseNonnegativeSafeInteger(serverless.provisionedRcuLimit);
    if (typeof enabled !== 'boolean' || throttling === null || provisioned === null) {
      return emptyEvidence('READ_FAILED');
    }
    return Object.freeze({
      status: 'PASS' as const,
      code: 'YDB_RESOURCE_LIMITS_CLASSIFIED' as const,
      databaseDiscovery: 'SINGLE' as const,
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
    mode: 'UNKNOWN' as const,
    enableThrottlingRcuLimit: null,
    throttlingRcuLimit: null,
    provisionedRcuLimit: null,
  });
}

export async function readYdbResourceLimitsWithRuntimeServiceAccount(
  environment: YdbResourceLimitsEnvironment,
  context: YandexFunctionServiceAccountContext | unknown,
  fetchImpl: YdbResourceLimitsFetch = (input, init) => fetch(input, init),
): Promise<Readonly<YdbResourceLimitsEvidence>> {
  const folderId = environment.PRIHRASH_YC_FOLDER_ID;
  const contextRecord = record(context);
  const token = contextRecord === null ? null : record(contextRecord.token);
  const accessToken = token?.access_token;
  if (!nonBlank(folderId) || !nonBlank(accessToken)) return emptyEvidence('READ_FAILED');

  const url = new URL(YANDEX_YDB_DATABASES_API);
  url.searchParams.set('folderId', folderId);
  url.searchParams.set('pageSize', '2');

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
    return emptyEvidence('READ_FAILED');
  }
  if (!response.ok) return emptyEvidence('READ_FAILED');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return emptyEvidence('READ_FAILED');
  }
  const body = record(payload);
  if (body === null || !Array.isArray(body.databases)) return emptyEvidence('READ_FAILED');

  const nextPageToken = body.nextPageToken;
  if (nextPageToken !== undefined && typeof nextPageToken !== 'string') return emptyEvidence('READ_FAILED');
  if (typeof nextPageToken === 'string' && nextPageToken.length > 0) return emptyEvidence('AMBIGUOUS');
  if (body.databases.length === 0) return emptyEvidence('NONE');
  if (body.databases.length !== 1) return emptyEvidence('AMBIGUOUS');
  return classifySingleDatabase(body.databases[0]);
}
