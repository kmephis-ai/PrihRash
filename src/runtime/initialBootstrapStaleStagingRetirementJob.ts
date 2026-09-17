import {
  createCanonicalSourceDigest,
  type CanonicalSourceDigest,
} from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsFullSnapshotLease,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  retireInitialBootstrapStaleStagingRun,
} from '../migration/initialBootstrapStaleStagingRetirement.js';
import {
  readInitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobEnvironment,
} from './initialBootstrapRecoveryConfig.js';

export type InitialBootstrapStaleStagingRetirementJobEnvironment =
  InitialBootstrapRecoveryJobEnvironment;

export type InitialBootstrapStaleStagingRetirementJobErrorCode =
  | 'CONFIG_INVALID'
  | 'SOURCE_READ_FAILED'
  | 'YDB_CLIENT_CREATE_FAILED'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class InitialBootstrapStaleStagingRetirementJobError extends Error {
  readonly code: InitialBootstrapStaleStagingRetirementJobErrorCode;

  constructor(code: InitialBootstrapStaleStagingRetirementJobErrorCode) {
    super(code);
    this.name = 'InitialBootstrapStaleStagingRetirementJobError';
    this.code = code;
  }
}

export const INITIAL_BOOTSTRAP_STALE_STAGING_TRANSACTION_TIMEOUT_MS = 25_000 as const;

export interface InitialBootstrapStaleStagingRetirementJobSource {
  readFullSnapshotObservation(): Promise<Readonly<GoogleSheetsFullSnapshotLease>>;
}

export interface InitialBootstrapStaleStagingRetirementJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapStaleStagingRetirementJobRuntime {
  createDigest(): Readonly<CanonicalSourceDigest>;
  createSource(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapStaleStagingRetirementJobSource>;
  createYdbClient(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
  ): Promise<Readonly<InitialBootstrapStaleStagingRetirementJobYdbClient>>;
  now(): string;
  retire(adapter: YdbAdapter, authoritativeSnapshotDigest: string, finishedAt: string): Promise<unknown>;
}

const productionRuntime: Readonly<InitialBootstrapStaleStagingRetirementJobRuntime> = Object.freeze({
  createDigest: createCanonicalSourceDigest,
  createSource(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapStaleStagingRetirementJobSource> {
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
  createYdbClient(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
  ): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
      transactionTimeoutMs: INITIAL_BOOTSTRAP_STALE_STAGING_TRANSACTION_TIMEOUT_MS,
    });
  },
  now(): string {
    return new Date().toISOString();
  },
  retire: retireInitialBootstrapStaleStagingRun,
});

export async function executeInitialBootstrapStaleStagingRetirementJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  runtime: Readonly<InitialBootstrapStaleStagingRetirementJobRuntime>,
): Promise<void> {
  let lease: Readonly<GoogleSheetsFullSnapshotLease>;
  try {
    const digest = runtime.createDigest();
    const source = runtime.createSource(config, digest);
    lease = await source.readFullSnapshotObservation();
  } catch {
    throw new InitialBootstrapStaleStagingRetirementJobError('SOURCE_READ_FAILED');
  }

  let ydbClient: Readonly<InitialBootstrapStaleStagingRetirementJobYdbClient>;
  try {
    ydbClient = await runtime.createYdbClient(config);
  } catch {
    throw new InitialBootstrapStaleStagingRetirementJobError('YDB_CLIENT_CREATE_FAILED');
  }
  let primaryError: unknown = null;

  try {
    await runtime.retire(
      new YdbAdapter(ydbClient.transport),
      lease.snapshotDigest,
      runtime.now(),
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) {
        throw new InitialBootstrapStaleStagingRetirementJobError('YDB_CLIENT_CLOSE_FAILED');
      }
    }
  }
}

export function runInitialBootstrapStaleStagingRetirementJobFromEnvironment(
  environment: InitialBootstrapStaleStagingRetirementJobEnvironment = process.env,
): Promise<void> {
  let config: Readonly<InitialBootstrapRecoveryJobConfig>;
  try {
    config = readInitialBootstrapRecoveryJobConfig(environment);
  } catch {
    throw new InitialBootstrapStaleStagingRetirementJobError('CONFIG_INVALID');
  }
  return executeInitialBootstrapStaleStagingRetirementJob(config, productionRuntime);
}
