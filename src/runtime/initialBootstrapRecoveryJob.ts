import { createCanonicalSourceDigest, type CanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import type { AdapterKey } from '../integration/google/sourceSchema.js';
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
import { decodeRawPayloadForSourceClassification } from '../migration/rawPayloadClassificationAdapter.js';
import type { RawPayload, RawPayloadDecodeErrorCode } from '../migration/rawPayloadDecoder.js';
import {
  diagnoseInitialBootstrapStagingDurableRevisionEvidence,
  diagnoseInitialBootstrapStagingExactRevisionEvidence,
  diagnoseInitialBootstrapStagingRevisionEvidence,
  type InitialBootstrapStagingDurableRevisionDiagnostic,
  type InitialBootstrapStagingExactRevisionDiagnostic,
  type InitialBootstrapStagingRevisionDiagnostic,
  type InitialBootstrapStagingRevisionObservation,
} from '../migration/initialBootstrapStagingRevisionDiagnostic.js';
import {
  diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
  type InitialBootstrapStaleStagingRetirementDiagnostic,
} from '../migration/initialBootstrapStaleStagingRetirementDiagnostic.js';
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

export interface InitialBootstrapSourceDecodeFailureEvidence {
  readonly errorCode: RawPayloadDecodeErrorCode;
  readonly field: AdapterKey | 'adapter_schema_version';
}

export type InitialBootstrapSourceDecodeDiagnostic =
  | readonly Readonly<InitialBootstrapSourceDecodeFailureEvidence>[]
  | 'SOURCE_DECODE_DIAGNOSTIC_FAILED';

export interface InitialBootstrapRecoveryJobResult extends InitialBootstrapRecoverySurfaceClassification {
  readonly stagingRevisionEvidence?: InitialBootstrapStagingRevisionDiagnostic;
  readonly stagingDurableRevisionEvidence?: InitialBootstrapStagingDurableRevisionDiagnostic;
  readonly stagingRetirementEvidence?: InitialBootstrapStaleStagingRetirementDiagnostic;
  readonly stagingSourceDecodeEvidence?: InitialBootstrapSourceDecodeDiagnostic;
  readonly stagingExactRevisionEvidence?: InitialBootstrapStagingExactRevisionDiagnostic;
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
  diagnoseStagingExactRevisionEvidence(
    adapter: YdbAdapter,
    sourceSnapshotDigest: string,
    observations: Parameters<typeof diagnoseInitialBootstrapStagingExactRevisionEvidence>[2],
  ): Promise<InitialBootstrapStagingExactRevisionDiagnostic>;
  diagnoseStaleStagingRetirementCurrentState(
    adapter: YdbAdapter,
  ): Promise<InitialBootstrapStaleStagingRetirementDiagnostic>;
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
  diagnoseStagingExactRevisionEvidence: diagnoseInitialBootstrapStagingExactRevisionEvidence,
  diagnoseStaleStagingRetirementCurrentState: diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
});

export function diagnoseInitialBootstrapSourceDecodeEvidence(
  rows: readonly Readonly<{ rawPayload: RawPayload }>[],
): readonly Readonly<InitialBootstrapSourceDecodeFailureEvidence>[] {
  const unique = new Map<string, Readonly<InitialBootstrapSourceDecodeFailureEvidence>>();
  for (const row of rows) {
    const decoded = decodeRawPayloadForSourceClassification(row.rawPayload);
    if (decoded.ok) continue;
    const evidence = Object.freeze({
      errorCode: decoded.errorCode,
      field: decoded.field,
    });
    unique.set(`${evidence.errorCode}@${evidence.field}`, evidence);
  }
  return Object.freeze(
    [...unique.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, evidence]) => evidence),
  );
}

function reconciliationFailed(): Readonly<InitialBootstrapRecoverySurfaceClassification> {
  return Object.freeze({
    verdict: 'RECOVERY_REQUIRED' as const,
    reason: 'REFERENCE_RECONCILIATION_FAILED' as const,
  });
}

export async function executeInitialBootstrapRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  runtime: Readonly<InitialBootstrapRecoveryJobRuntime>,
  surfaceOnly = false,
): Promise<Readonly<InitialBootstrapRecoveryJobResult>> {
  const validated = validateInitialBootstrapRecoveryConfig(config);
  const ydbClient = await runtime.createYdbClient(validated);
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    const before = await runtime.diagnoseSurface(adapter);
    if (surfaceOnly) return before;
    if (before.reason === 'STAGING_RUN_PRESENT') {
      let stagingDurableRevisionEvidence: InitialBootstrapStagingDurableRevisionDiagnostic;
      try {
        stagingDurableRevisionEvidence = await runtime.diagnoseStagingDurableRevisionEvidence(adapter);
      } catch {
        stagingDurableRevisionEvidence = 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED';
      }
      let stagingRetirementEvidence: InitialBootstrapStaleStagingRetirementDiagnostic;
      try {
        stagingRetirementEvidence = await runtime.diagnoseStaleStagingRetirementCurrentState(adapter);
      } catch {
        stagingRetirementEvidence = 'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED';
      }
      let stagingRevisionEvidence: InitialBootstrapStagingRevisionDiagnostic;
      let stagingSourceDecodeEvidence: InitialBootstrapSourceDecodeDiagnostic;
      let stagingExactRevisionEvidence: InitialBootstrapStagingExactRevisionDiagnostic;
      try {
        const digest = runtime.createDigest();
        const source = runtime.createSource(validated, digest);
        const lease = await source.readFullSnapshotObservation();
        const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
        stagingSourceDecodeEvidence = diagnoseInitialBootstrapSourceDecodeEvidence(projected.rows);
        try {
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
        try {
          stagingExactRevisionEvidence = await runtime.diagnoseStagingExactRevisionEvidence(
            adapter,
            lease.snapshotDigest,
            projected.rows.map((row, sourceOrdinal) => Object.freeze({
              sourceOrdinal,
              rowHint: row.rowHint,
              digest: row.digest,
              rawPayload: row.rawPayload,
            })),
          );
        } catch {
          stagingExactRevisionEvidence = 'EXACT_CURRENT_RUN_DIAGNOSTIC_FAILED';
        }
      } catch {
        stagingRevisionEvidence = 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED';
        stagingSourceDecodeEvidence = 'SOURCE_DECODE_DIAGNOSTIC_FAILED';
        stagingExactRevisionEvidence = 'EXACT_CURRENT_RUN_DIAGNOSTIC_FAILED';
      }
      return Object.freeze({
        ...before,
        stagingRevisionEvidence,
        stagingDurableRevisionEvidence,
        stagingRetirementEvidence,
        stagingSourceDecodeEvidence,
        stagingExactRevisionEvidence,
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
  surfaceOnly = false,
): Promise<Readonly<InitialBootstrapRecoveryJobResult>> {
  return executeInitialBootstrapRecoveryJob(config, productionRuntime, surfaceOnly);
}

export function runInitialBootstrapRecoveryJobFromEnvironment(
  environment: InitialBootstrapRecoveryJobEnvironment = process.env,
): Promise<Readonly<InitialBootstrapRecoveryJobResult>> {
  return runInitialBootstrapRecoveryJob(
    readInitialBootstrapRecoveryJobConfig(environment),
    environment.PRIHRASH_R1_RECOVERY_SURFACE_ONLY === '1',
  );
}
