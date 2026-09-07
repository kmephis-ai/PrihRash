import { createCanonicalSourceDigest, type CanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsImmutableSnapshot,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  runScheduledSyncApplication,
  type ScheduledSyncApplicationDependencies,
  type ScheduledSyncObservationClock,
} from '../migration/scheduledSyncApplication.js';
import type {
  AuthoritativeFullSnapshotLeaseReader,
  ScheduledSyncInvocationResult,
} from '../migration/scheduledSyncInvocation.js';

export const SCHEDULED_SYNC_JOB_ENV = Object.freeze({
  spreadsheetId: 'PRIHRASH_GOOGLE_SPREADSHEET_ID',
  googleServiceAccountEmail: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL',
  googleServiceAccountPrivateKey: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ydbConnectionString: 'PRIHRASH_YDB_CONNECTION_STRING',
});

export interface ScheduledSyncJobConfig {
  readonly spreadsheetId: string;
  readonly googleServiceAccountEmail: string;
  readonly googleServiceAccountPrivateKey: string;
  readonly ydbConnectionString: string;
}

export type ScheduledSyncJobEnvironment = Readonly<Record<string, string | undefined>>;

export type ScheduledSyncJobErrorCode =
  | 'INVALID_SPREADSHEET_ID'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
  | 'INVALID_YDB_CONNECTION_STRING'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class ScheduledSyncJobError extends Error {
  readonly code: ScheduledSyncJobErrorCode;

  constructor(code: ScheduledSyncJobErrorCode) {
    super(code);
    this.name = 'ScheduledSyncJobError';
    this.code = code;
  }
}

export interface ScheduledSyncJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface ScheduledSyncJobRuntime {
  createDigest(): Readonly<CanonicalSourceDigest>;
  createSource(
    config: Readonly<ScheduledSyncJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): AuthoritativeFullSnapshotLeaseReader<GoogleSheetsImmutableSnapshot>;
  createYdbClient(config: Readonly<ScheduledSyncJobConfig>): Promise<Readonly<ScheduledSyncJobYdbClient>>;
  readonly observationClock: Readonly<ScheduledSyncObservationClock>;
  runApplication(
    dependencies: Readonly<ScheduledSyncApplicationDependencies>,
  ): Promise<Readonly<ScheduledSyncInvocationResult>>;
}

function requiredValue(
  value: unknown,
  code: ScheduledSyncJobErrorCode,
): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new ScheduledSyncJobError(code);
  }
  return value;
}

function validateConfig(config: Readonly<ScheduledSyncJobConfig>): Readonly<ScheduledSyncJobConfig> {
  return Object.freeze({
    spreadsheetId: requiredValue(config.spreadsheetId, 'INVALID_SPREADSHEET_ID'),
    googleServiceAccountEmail: requiredValue(
      config.googleServiceAccountEmail,
      'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL',
    ),
    googleServiceAccountPrivateKey: requiredValue(
      config.googleServiceAccountPrivateKey,
      'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    ),
    ydbConnectionString: requiredValue(
      config.ydbConnectionString,
      'INVALID_YDB_CONNECTION_STRING',
    ),
  });
}

export function readScheduledSyncJobConfig(
  environment: ScheduledSyncJobEnvironment,
): Readonly<ScheduledSyncJobConfig> {
  return validateConfig({
    spreadsheetId: environment[SCHEDULED_SYNC_JOB_ENV.spreadsheetId] ?? '',
    googleServiceAccountEmail: environment[SCHEDULED_SYNC_JOB_ENV.googleServiceAccountEmail] ?? '',
    googleServiceAccountPrivateKey: environment[SCHEDULED_SYNC_JOB_ENV.googleServiceAccountPrivateKey] ?? '',
    ydbConnectionString: environment[SCHEDULED_SYNC_JOB_ENV.ydbConnectionString] ?? '',
  });
}

const productionObservationClock: Readonly<ScheduledSyncObservationClock> = Object.freeze({
  now(): string {
    return new Date().toISOString();
  },
});

const productionRuntime: Readonly<ScheduledSyncJobRuntime> = Object.freeze({
  createDigest: createCanonicalSourceDigest,
  createSource(config, digest) {
    const accessTokenProvider = createGoogleServiceAccountSheetsAccessTokenProvider({
      clientEmail: config.googleServiceAccountEmail,
      privateKey: config.googleServiceAccountPrivateKey,
    });
    return new GoogleSheetsFullSnapshotReader({
      spreadsheetId: config.spreadsheetId,
      fetch: async (input, init) => fetch(input, init),
      accessTokenProvider,
      digest,
    });
  },
  createYdbClient(config): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
  observationClock: productionObservationClock,
  runApplication: runScheduledSyncApplication,
});

export async function executeScheduledSyncJob(
  config: Readonly<ScheduledSyncJobConfig>,
  runtime: Readonly<ScheduledSyncJobRuntime>,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  const validated = validateConfig(config);
  const digest = runtime.createDigest();
  const source = runtime.createSource(validated, digest);
  const ydbClient = await runtime.createYdbClient(validated);
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    return await runtime.runApplication({
      source,
      adapter,
      rowDigest: digest,
      observationClock: runtime.observationClock,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) {
        throw new ScheduledSyncJobError('YDB_CLIENT_CLOSE_FAILED');
      }
    }
  }
}

export function runScheduledSyncJob(
  config: Readonly<ScheduledSyncJobConfig>,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  return executeScheduledSyncJob(config, productionRuntime);
}

export function runScheduledSyncJobFromEnvironment(
  environment: ScheduledSyncJobEnvironment = process.env,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  return runScheduledSyncJob(readScheduledSyncJobConfig(environment));
}
