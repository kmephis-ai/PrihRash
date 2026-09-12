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
import type { ReferenceResolver } from '../normalization/types.js';
import { readYdbReferenceResolverSnapshot } from '../reference/ydbReferenceEvidenceReader.js';
import {
  runInitialBootstrapApplication,
  type InitialBootstrapApplicationDependencies,
  type InitialBootstrapApplicationResult,
  type InitialBootstrapObservation,
} from '../migration/initialBootstrapApplication.js';
import {
  createInitialBootstrapDurableReconciliation,
  type InitialBootstrapDurableReconciliation,
} from '../migration/initialBootstrapDurableReconciliation.js';
import {
  parseInitialBootstrapPrivateHistoricalEvidence,
  type InitialBootstrapPrivateHistoricalEvidence,
} from '../migration/initialBootstrapPrivateEvidence.js';
import {
  createNodeInitialBootstrapRuntimePrimitives,
  type InitialBootstrapRuntimePrimitives,
} from '../migration/initialBootstrapRuntimePrimitives.js';
import { projectGoogleSnapshotForIncrementalMigration } from '../migration/googleSnapshotProjection.js';
import type { InitialSnapshotProjectionContext } from '../migration/initialSnapshotProjection.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  type InitialReconciliationEvidence,
} from '../migration/initialValidationGate.js';

export const INITIAL_BOOTSTRAP_JOB_ENV = Object.freeze({
  spreadsheetId: 'PRIHRASH_GOOGLE_SPREADSHEET_ID',
  googleServiceAccountEmail: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL',
  googleServiceAccountPrivateKey: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ydbConnectionString: 'PRIHRASH_YDB_CONNECTION_STRING',
  privateHistoricalEvidence: 'PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE',
});

export interface InitialBootstrapJobConfig {
  readonly spreadsheetId: string;
  readonly googleServiceAccountEmail: string;
  readonly googleServiceAccountPrivateKey: string;
  readonly ydbConnectionString: string;
  readonly privateHistoricalEvidence: string;
}

export type InitialBootstrapJobEnvironment = Readonly<Record<string, string | undefined>>;

export type InitialBootstrapJobErrorCode =
  | 'INVALID_SPREADSHEET_ID'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
  | 'INVALID_YDB_CONNECTION_STRING'
  | 'INVALID_PRIVATE_HISTORICAL_EVIDENCE'
  | 'COMMITTED_RECONCILIATION_MISMATCH'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class InitialBootstrapJobError extends Error {
  readonly code: InitialBootstrapJobErrorCode;

  constructor(code: InitialBootstrapJobErrorCode) {
    super(code);
    this.name = 'InitialBootstrapJobError';
    this.code = code;
  }
}

export interface InitialBootstrapJobSource {
  readFullSnapshotObservation(): Promise<Readonly<GoogleSheetsFullSnapshotLease>>;
}

export interface InitialBootstrapJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapJobRuntime {
  createDigest(): Readonly<CanonicalSourceDigest>;
  parseHistoricalEvidence(serialized: string): Readonly<InitialBootstrapPrivateHistoricalEvidence>;
  createSource(
    config: Readonly<InitialBootstrapJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapJobSource>;
  createRuntimePrimitives(): Readonly<InitialBootstrapRuntimePrimitives>;
  createYdbClient(config: Readonly<InitialBootstrapJobConfig>): Promise<Readonly<InitialBootstrapJobYdbClient>>;
  readReferenceResolver(adapter: YdbAdapter): Promise<Readonly<ReferenceResolver>>;
  createReconciliation(
    adapter: YdbAdapter,
    projectionContext: Readonly<InitialSnapshotProjectionContext>,
    historicalEvidence: Readonly<InitialBootstrapPrivateHistoricalEvidence>,
  ): Readonly<InitialBootstrapDurableReconciliation>;
  runApplication(
    observation: Readonly<InitialBootstrapObservation>,
    dependencies: Readonly<InitialBootstrapApplicationDependencies>,
  ): Promise<InitialBootstrapApplicationResult>;
}

function requiredValue(value: unknown, code: InitialBootstrapJobErrorCode): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new InitialBootstrapJobError(code);
  }
  return value;
}

function requiredSecret(value: unknown, code: InitialBootstrapJobErrorCode): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InitialBootstrapJobError(code);
  }
  return value;
}

function validateConfig(config: Readonly<InitialBootstrapJobConfig>): Readonly<InitialBootstrapJobConfig> {
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
    ydbConnectionString: requiredValue(
      config.ydbConnectionString,
      'INVALID_YDB_CONNECTION_STRING',
    ),
    privateHistoricalEvidence: requiredSecret(
      config.privateHistoricalEvidence,
      'INVALID_PRIVATE_HISTORICAL_EVIDENCE',
    ),
  });
}

export function readInitialBootstrapJobConfig(
  environment: InitialBootstrapJobEnvironment,
): Readonly<InitialBootstrapJobConfig> {
  return validateConfig({
    spreadsheetId: environment[INITIAL_BOOTSTRAP_JOB_ENV.spreadsheetId] ?? '',
    googleServiceAccountEmail: environment[INITIAL_BOOTSTRAP_JOB_ENV.googleServiceAccountEmail] ?? '',
    googleServiceAccountPrivateKey: environment[INITIAL_BOOTSTRAP_JOB_ENV.googleServiceAccountPrivateKey] ?? '',
    ydbConnectionString: environment[INITIAL_BOOTSTRAP_JOB_ENV.ydbConnectionString] ?? '',
    privateHistoricalEvidence: environment[INITIAL_BOOTSTRAP_JOB_ENV.privateHistoricalEvidence] ?? '',
  });
}

function buildObservation(
  lease: Readonly<GoogleSheetsFullSnapshotLease>,
  digest: Readonly<CanonicalSourceDigest>,
  historicalEvidence: Readonly<InitialBootstrapPrivateHistoricalEvidence>,
  capturedAt: string,
): Readonly<InitialBootstrapObservation> {
  const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
  historicalEvidence.assertCompatibleRowCount(projected.rows.length);

  return Object.freeze({
    capturedAt,
    snapshotDigest: lease.snapshotDigest,
    rows: Object.freeze(projected.rows.map((row, sourceOrdinal) => Object.freeze({
      rowHint: row.rowHint,
      digest: row.digest,
      rawPayload: row.rawPayload,
      aggregatePeriodMonth: historicalEvidence.aggregatePeriodMonthForSourceOrdinal(sourceOrdinal),
    }))),
  });
}

function assertCommittedReconciliation(evidence: Readonly<InitialReconciliationEvidence>): void {
  if (
    !Number.isSafeInteger(evidence.unexplainedHighImpactMismatchCount)
    || evidence.unexplainedHighImpactMismatchCount !== 0
    || INITIAL_RECONCILIATION_CHECKS.some((check) => evidence.checks[check] !== 'MATCHED')
  ) {
    throw new InitialBootstrapJobError('COMMITTED_RECONCILIATION_MISMATCH');
  }
}

const productionRuntime: Readonly<InitialBootstrapJobRuntime> = Object.freeze({
  createDigest: createCanonicalSourceDigest,
  parseHistoricalEvidence: parseInitialBootstrapPrivateHistoricalEvidence,
  createSource(
    config: Readonly<InitialBootstrapJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapJobSource> {
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
  createRuntimePrimitives: createNodeInitialBootstrapRuntimePrimitives,
  createYdbClient(config: Readonly<InitialBootstrapJobConfig>): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
  readReferenceResolver: readYdbReferenceResolverSnapshot,
  createReconciliation: createInitialBootstrapDurableReconciliation,
  runApplication: runInitialBootstrapApplication,
});

export async function executeInitialBootstrapJob(
  config: Readonly<InitialBootstrapJobConfig>,
  runtime: Readonly<InitialBootstrapJobRuntime>,
): Promise<InitialBootstrapApplicationResult> {
  const validated = validateConfig(config);
  const historicalEvidence = runtime.parseHistoricalEvidence(validated.privateHistoricalEvidence);
  const digest = runtime.createDigest();
  const source = runtime.createSource(validated, digest);
  const primitives = runtime.createRuntimePrimitives();
  const ydbClient = await runtime.createYdbClient(validated);
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    const lease = await source.readFullSnapshotObservation();
    const observation = buildObservation(
      lease,
      digest,
      historicalEvidence,
      primitives.clock.now(),
    );
    const refs = await runtime.readReferenceResolver(adapter);
    const projectionContext: Readonly<InitialSnapshotProjectionContext> = Object.freeze({
      granularityEvidence: historicalEvidence.granularityEvidence,
      refs,
    });
    const reconciliation = runtime.createReconciliation(
      adapter,
      projectionContext,
      historicalEvidence,
    );
    const result = await runtime.runApplication(observation, {
      adapter,
      identityAllocator: primitives.identityAllocator,
      projectionContext,
      reconciliation: reconciliation.port,
      clock: primitives.clock,
    });

    if (result.status === 'COMMITTED') {
      assertCommittedReconciliation(await reconciliation.verifyCommittedCurrent());
    }
    return result;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) {
        throw new InitialBootstrapJobError('YDB_CLIENT_CLOSE_FAILED');
      }
    }
  }
}

export function runInitialBootstrapJob(
  config: Readonly<InitialBootstrapJobConfig>,
): Promise<InitialBootstrapApplicationResult> {
  return executeInitialBootstrapJob(config, productionRuntime);
}

export function runInitialBootstrapJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
): Promise<InitialBootstrapApplicationResult> {
  return runInitialBootstrapJob(readInitialBootstrapJobConfig(environment));
}
