import { createCanonicalSourceDigest, type CanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
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
import { projectGoogleSnapshotForIncrementalMigration } from '../migration/googleSnapshotProjection.js';
import {
  reconcileInitialBootstrapReferenceState,
} from '../migration/initialBootstrapReferenceReconciliation.js';
import {
  diagnoseInitialBootstrapRecoverySurface,
  type InitialBootstrapRecoverySurfaceClassification,
} from '../migration/initialBootstrapResidualSurface.js';

export const INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV = Object.freeze({
  spreadsheetId: 'PRIHRASH_GOOGLE_SPREADSHEET_ID',
  googleServiceAccountEmail: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL',
  googleServiceAccountPrivateKey: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ydbConnectionString: 'PRIHRASH_YDB_CONNECTION_STRING',
});

export type InitialBootstrapRecoveryJobEnvironment = Readonly<Record<string, string | undefined>>;

export interface InitialBootstrapRecoveryJobConfig {
  readonly spreadsheetId: string;
  readonly googleServiceAccountEmail: string;
  readonly googleServiceAccountPrivateKey: string;
  readonly ydbConnectionString: string;
}

export type InitialBootstrapRecoveryJobErrorCode =
  | 'INVALID_SPREADSHEET_ID'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
  | 'INVALID_YDB_CONNECTION_STRING'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class InitialBootstrapRecoveryJobError extends Error {
  readonly code: InitialBootstrapRecoveryJobErrorCode;

  constructor(code: InitialBootstrapRecoveryJobErrorCode) {
    super(code);
    this.name = 'InitialBootstrapRecoveryJobError';
    this.code = code;
  }
}

export interface InitialBootstrapRecoveryJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapRecoveryJobSource {
  readFullSnapshotObservation(): Promise<Readonly<GoogleSheetsFullSnapshotLease>>;
}

export interface InitialBootstrapRecoveryJobRuntime {
  createDigest(): Readonly<CanonicalSourceDigest>;
  createSource(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapRecoveryJobSource>;
  createYdbClient(config: Readonly<InitialBootstrapRecoveryJobConfig>): Promise<Readonly<InitialBootstrapRecoveryJobYdbClient>>;
  diagnoseSurface(adapter: YdbAdapter): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>>;
  reconcileReferenceState(
    adapter: YdbAdapter,
    rows: Parameters<typeof reconcileInitialBootstrapReferenceState>[1],
  ): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>>;
}

function requiredValue(value: unknown, code: InitialBootstrapRecoveryJobErrorCode): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new InitialBootstrapRecoveryJobError(code);
  }
  return value;
}

function requiredSecret(value: unknown, code: InitialBootstrapRecoveryJobErrorCode): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InitialBootstrapRecoveryJobError(code);
  }
  return value;
}

function validateConfig(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
): Readonly<InitialBootstrapRecoveryJobConfig> {
  return Object.freeze({
    spreadsheetId: requiredValue(config.spreadsheetId, 'INVALID_SPREADSHEET_ID'),
    googleServiceAccountEmail: requiredValue(
      config.googleServiceAccountEmail,
      'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL',
    ),
    googleServiceAccountPrivateKey: requiredSecret(
      config.googleServiceAccountPrivateKey,
      'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    ),
    ydbConnectionString: requiredValue(config.ydbConnectionString, 'INVALID_YDB_CONNECTION_STRING'),
  });
}

export function readInitialBootstrapRecoveryJobConfig(
  environment: InitialBootstrapRecoveryJobEnvironment,
): Readonly<InitialBootstrapRecoveryJobConfig> {
  return validateConfig({
    spreadsheetId: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.spreadsheetId] ?? '',
    googleServiceAccountEmail: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.googleServiceAccountEmail] ?? '',
    googleServiceAccountPrivateKey: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.googleServiceAccountPrivateKey] ?? '',
    ydbConnectionString: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.ydbConnectionString] ?? '',
  });
}

const productionRuntime: Readonly<InitialBootstrapRecoveryJobRuntime> = Object.freeze({
  createDigest: createCanonicalSourceDigest,
  createSource(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapRecoveryJobSource> {
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
  createYdbClient(config: Readonly<InitialBootstrapRecoveryJobConfig>): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
  diagnoseSurface: diagnoseInitialBootstrapRecoverySurface,
  reconcileReferenceState: reconcileInitialBootstrapReferenceState,
});

function reconciliationFailed(): Readonly<InitialBootstrapRecoverySurfaceClassification> {
  return Object.freeze({
    verdict: 'RECOVERY_REQUIRED' as const,
    reason: 'REFERENCE_RECONCILIATION_FAILED' as const,
  });
}

export async function executeInitialBootstrapRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  runtime: Readonly<InitialBootstrapRecoveryJobRuntime>,
): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>> {
  const validated = validateConfig(config);
  const ydbClient = await runtime.createYdbClient(validated);
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    const before = await runtime.diagnoseSurface(adapter);
    if (before.reason !== 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN') return before;

    let reconciled: Readonly<InitialBootstrapRecoverySurfaceClassification>;
    try {
      const digest = runtime.createDigest();
      const source = runtime.createSource(validated, digest);
      const lease = await source.readFullSnapshotObservation();
      const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
      reconciled = await runtime.reconcileReferenceState(
        adapter,
        projected.rows.map((row, sourceOrdinal) => Object.freeze({
          sourceOrdinal,
          rawPayload: row.rawPayload,
        })),
      );
    } catch {
      return reconciliationFailed();
    }

    const after = await runtime.diagnoseSurface(adapter);
    if (after.reason !== 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN') return reconciliationFailed();
    return reconciled;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) throw new InitialBootstrapRecoveryJobError('YDB_CLIENT_CLOSE_FAILED');
    }
  }
}

export function runInitialBootstrapRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>> {
  return executeInitialBootstrapRecoveryJob(config, productionRuntime);
}

export function runInitialBootstrapRecoveryJobFromEnvironment(
  environment: InitialBootstrapRecoveryJobEnvironment = process.env,
): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>> {
  return runInitialBootstrapRecoveryJob(readInitialBootstrapRecoveryJobConfig(environment));
}
