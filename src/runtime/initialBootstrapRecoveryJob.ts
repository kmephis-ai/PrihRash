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
  diagnoseInitialBootstrapStagingDurableRevisionEvidence,
  diagnoseInitialBootstrapStagingRevisionEvidence,
  type InitialBootstrapStagingDurableRevisionDiagnostic,
  type InitialBootstrapStagingRevisionDiagnostic,
  type InitialBootstrapStagingRevisionObservation,
} from '../migration/initialBootstrapStagingRevisionDiagnostic.js';
import {
  reconcileInitialBootstrapReferenceState,
} from '../migration/initialBootstrapReferenceReconciliation.js';
import {
  diagnoseInitialBootstrapRecoverySurface,
  type InitialBootstrapRecoverySurfaceClassification,
} from '../migration/initialBootstrapResidualSurface.js';
import {
  InitialBootstrapRecoveryJobError,
  readInitialBootstrapRecoveryJobConfig,
  validateInitialBootstrapRecoveryConfig,
  type InitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobEnvironment,
} from './initialBootstrapRecoveryConfig.js';

export {
  INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV,
  InitialBootstrapRecoveryJobError,
  readInitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobEnvironment,
  type InitialBootstrapRecoveryJobErrorCode,
} from './initialBootstrapRecoveryConfig.js';

export interface InitialBootstrapRecoveryJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapRecoveryJobSource {
  readFullSnapshotObservation(): Promise<Readonly<GoogleSheetsFullSnapshotLease>>;
}

export interface InitialBootstrapRecoveryJobResult extends InitialBootstrapRecoverySurfaceClassification {
  readonly stagingRevisionEvidence?: InitialBootstrapStagingRevisionDiagnostic;
  readonly stagingDurableRevisionEvidence?: InitialBootstrapStagingDurableRevisionDiagnostic;
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
  diagnoseStagingRevisionEvidence(
    adapter: YdbAdapter,
    sourceSnapshotDigest: string,
    observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
  ): Promise<InitialBootstrapStagingRevisionDiagnostic>;
  diagnoseStagingDurableRevisionEvidence(
    adapter: YdbAdapter,
  ): Promise<InitialBootstrapStagingDurableRevisionDiagnostic>;
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
  diagnoseStagingRevisionEvidence: diagnoseInitialBootstrapStagingRevisionEvidence,
  diagnoseStagingDurableRevisionEvidence: diagnoseInitialBootstrapStagingDurableRevisionEvidence,
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
): Promise<Readonly<InitialBootstrapRecoveryJobResult>> {
  const validated = validateInitialBootstrapRecoveryConfig(config);
  const ydbClient = await runtime.createYdbClient(validated);
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    const before = await runtime.diagnoseSurface(adapter);
    if (before.reason === 'STAGING_RUN_PRESENT') {
      let stagingDurableRevisionEvidence: InitialBootstrapStagingDurableRevisionDiagnostic;
      try {
        stagingDurableRevisionEvidence = await runtime.diagnoseStagingDurableRevisionEvidence(adapter);
      } catch {
        stagingDurableRevisionEvidence = 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED';
      }
      let stagingRevisionEvidence: InitialBootstrapStagingRevisionDiagnostic;
      try {
        const digest = runtime.createDigest();
        const source = runtime.createSource(validated, digest);
        const lease = await source.readFullSnapshotObservation();
        const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
        stagingRevisionEvidence = await runtime.diagnoseStagingRevisionEvidence(
          adapter,
          lease.snapshotDigest,
          projected.rows.map((row, sourceOrdinal) => Object.freeze({
            sourceOrdinal,
            rowHint: row.rowHint,
            digest: row.digest,
          })),
        );
      } catch {
        stagingRevisionEvidence = 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED';
      }
      return Object.freeze({
        ...before,
        stagingRevisionEvidence,
        stagingDurableRevisionEvidence,
      });
    }
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
