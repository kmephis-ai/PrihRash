import { createCanonicalSourceDigest, type CanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import type { AdapterKey } from '../integration/google/sourceSchema.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsFullSnapshotLease,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import { YdbSchemeAdapter, type YdbSchemeTransport } from '../integration/ydb/scheme.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import { projectGoogleSnapshotForIncrementalMigration } from '../migration/googleSnapshotProjection.js';
import {
  diagnoseValidatedControlledRebuildState,
  type InitialValidatedControlledRebuildRecoveryReason,
} from '../migration/initialControlledRebuildValidatedRecoveryDiagnostic.js';
import { decodeRawPayloadForSourceClassification } from '../migration/rawPayloadClassificationAdapter.js';
import type { RawPayload, RawPayloadDecodeErrorCode } from '../migration/rawPayloadDecoder.js';
import {
  diagnoseInitialValidatedSourceEvidence,
  type InitialValidatedSourceDiagnostic,
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
  evaluateInitialStaleValidatedRecoveryGate,
  type InitialStaleValidatedRecoveryGateResult,
} from '../migration/initialStaleValidatedRecoveryGate.js';
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
  createSchemeTransport(): Promise<YdbSchemeTransport>;
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
  readonly validatedSourceEvidence?: InitialValidatedSourceDiagnostic;
  readonly staleValidatedRecoveryGate?: InitialStaleValidatedRecoveryGateResult;
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
  diagnoseValidatedSourceEvidence(
    adapter: YdbAdapter,
    sourceSnapshotDigest: string,
    observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
  ): Promise<InitialValidatedSourceDiagnostic>;
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
  diagnoseValidatedControlledRebuildState(
    adapter: YdbAdapter,
    scheme: YdbSchemeAdapter,
  ): Promise<InitialValidatedControlledRebuildRecoveryReason>;
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
  diagnoseValidatedSourceEvidence: diagnoseInitialValidatedSourceEvidence,
  diagnoseStagingRevisionEvidence: diagnoseInitialBootstrapStagingRevisionEvidence,
  diagnoseStagingDurableRevisionEvidence: diagnoseInitialBootstrapStagingDurableRevisionEvidence,
  diagnoseStagingExactRevisionEvidence: diagnoseInitialBootstrapStagingExactRevisionEvidence,
  diagnoseStaleStagingRetirementCurrentState: diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
  diagnoseValidatedControlledRebuildState,
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
    if (before.reason === 'VALIDATED_RUN_PRESENT') {
      try {
        const schemeTransport = await ydbClient.createSchemeTransport();
        const reason = await runtime.diagnoseValidatedControlledRebuildState(
          adapter,
          new YdbSchemeAdapter(schemeTransport),
        );
        if (reason !== 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY') {
          return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason });
        }
        let validatedSourceEvidence: InitialValidatedSourceDiagnostic;
        try {
          const digest = runtime.createDigest();
          const lease = await runtime.createSource(validated, digest).readFullSnapshotObservation();
          const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
          validatedSourceEvidence = await runtime.diagnoseValidatedSourceEvidence(
            adapter, lease.snapshotDigest,
            projected.rows.map((row, sourceOrdinal) => Object.freeze({
              sourceOrdinal, rowHint: row.rowHint, digest: row.digest,
            })),
          );
        } catch {
          validatedSourceEvidence = 'VALIDATED_SOURCE_DIAGNOSTIC_FAILED';
        }
        const staleValidatedRecoveryGate = evaluateInitialStaleValidatedRecoveryGate({
          committedBaselinePresent: false,
          uniqueValidatedRun: true,
          validatedRunMetadataValid: validatedSourceEvidence !== 'VALIDATED_METADATA_INVALID'
            && validatedSourceEvidence !== 'VALIDATED_SOURCE_DIAGNOSTIC_FAILED',
          sourceEvidence: validatedSourceEvidence,
          historicalContextProven: false,
          currentStateEmpty: true,
          stagingCandidateExact: false,
          swapProvenNotApplied: false,
          inFlightProviderMutationAbsent: false,
          singleWriterExclusive: false,
        });
        return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason, validatedSourceEvidence, staleValidatedRecoveryGate });
      } catch {
        return Object.freeze({
          verdict: 'RECOVERY_REQUIRED' as const,
          reason: 'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED' as const,
        });
      }
    }
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
