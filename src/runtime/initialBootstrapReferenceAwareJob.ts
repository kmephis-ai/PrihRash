import {
  createCanonicalSourceDigest,
  type CanonicalSourceDigest,
} from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsFullSnapshotLease,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter } from '../integration/ydb/adapter.js';
import { YdbParameterError } from '../integration/ydb/parameters.js';
import {
  createYdbJsV6MetadataDataClient,
  YdbJsV6DataTransportError,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  InitialBootstrapApplicationError,
  runInitialBootstrapApplication,
} from '../migration/initialBootstrapApplication.js';
import { InitialBootstrapCandidateError } from '../migration/initialBootstrapCandidate.js';
import {
  createInitialBootstrapDurableReconciliation,
  InitialBootstrapDurableReconciliationError,
} from '../migration/initialBootstrapDurableReconciliation.js';
import { InitialBootstrapIdentityManifestError } from '../migration/initialBootstrapIdentityManifest.js';
import { InitialBootstrapMetadataExecutorError } from '../migration/initialBootstrapMetadataExecutor.js';
import {
  reconcileInitialBootstrapReferenceState,
} from '../migration/initialBootstrapReferenceReconciliation.js';
import {
  diagnoseInitialBootstrapRecoverySurface,
  type InitialBootstrapRecoverySurfaceClassification,
} from '../migration/initialBootstrapResidualSurface.js';
import {
  parseInitialBootstrapPrivateHistoricalEvidence,
} from '../migration/initialBootstrapPrivateEvidence.js';
import {
  createNodeInitialBootstrapRuntimePrimitives,
  InitialBootstrapRuntimePrimitiveError,
  type InitialBootstrapRuntimePrimitives,
} from '../migration/initialBootstrapRuntimePrimitives.js';
import { InitialBootstrapError } from '../migration/initialSnapshot.js';
import { projectGoogleSnapshotForIncrementalMigration } from '../migration/googleSnapshotProjection.js';
import { MigrationRunStateError } from '../migration/migrationRunState.js';
import {
  readScheduledSyncAdmissionEvidence,
  ScheduledSyncAdmissionEvidenceError,
} from '../migration/scheduledSyncAdmissionEvidence.js';
import {
  planInitialReferenceBootstrap,
  type InitialReferenceBootstrapPlan,
} from '../reference/initialBootstrapReferencePlan.js';
import type {
  InitialReferenceBootstrapObservationRow,
} from '../reference/initialBootstrapReferenceVocabulary.js';
import { createInitialBootstrapReferenceClaimAdapter } from './initialBootstrapReferenceClaimAdapter.js';
import {
  executeInitialBootstrapJob,
  readInitialBootstrapJobConfig,
  type InitialBootstrapJobConfig,
  type InitialBootstrapJobEnvironment,
  type InitialBootstrapJobRuntime,
} from './initialBootstrapJob.js';

export type InitialBootstrapReferenceAwareRuntimeErrorCode =
  | 'REFERENCE_RUNTIME_STATE_INVALID'
  | 'REFERENCE_SOURCE_READ_FAILED'
  | 'REFERENCE_YDB_CLIENT_CREATE_FAILED'
  | 'REFERENCE_RESOLUTION_FAILED'
  | 'REFERENCE_ADMISSION_READ_FAILED'
  | 'REFERENCE_APPLICATION_ADMISSION_EVIDENCE_FAILED'
  | 'REFERENCE_APPLICATION_SEMANTIC_FAILED'
  | 'REFERENCE_APPLICATION_METADATA_FAILED'
  | 'REFERENCE_APPLICATION_YDB_DATA_FAILED'
  | 'REFERENCE_APPLICATION_RUNTIME_FAILED'
  | 'REFERENCE_BOOTSTRAP_RESUME_UNSAFE'
  | 'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE';

export function isInitialBootstrapResidualReferenceRecoveryAuthorized(
  before: Readonly<InitialBootstrapRecoverySurfaceClassification>,
  reconciled: Readonly<InitialBootstrapRecoverySurfaceClassification>,
  after: Readonly<InitialBootstrapRecoverySurfaceClassification>,
  plannedWriteCount: number,
): boolean {
  return Number.isSafeInteger(plannedWriteCount)
    && plannedWriteCount === 0
    && before.verdict === 'RECOVERY_REQUIRED'
    && before.reason === 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN'
    && reconciled.verdict === 'RECOVERY_REQUIRED'
    && reconciled.reason === 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE'
    && after.verdict === 'RECOVERY_REQUIRED'
    && after.reason === 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN';
}

function isUnsafeNoRunRecoverySurface(
  surface: Readonly<InitialBootstrapRecoverySurfaceClassification>,
): boolean {
  return surface.reason === 'READ_FAILED'
    || surface.reason === 'RESIDUAL_METADATA_STATE_WITHOUT_RUN'
    || surface.reason === 'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN'
    || surface.reason === 'RESIDUAL_MIXED_STATE_WITHOUT_RUN';
}

export class InitialBootstrapReferenceAwareRuntimeError extends Error {
  readonly code: InitialBootstrapReferenceAwareRuntimeErrorCode;

  constructor(code: InitialBootstrapReferenceAwareRuntimeErrorCode) {
    super(code);
    this.name = 'InitialBootstrapReferenceAwareRuntimeError';
    this.code = code;
  }
}

function classifyApplicationRuntimeError(
  error: unknown,
): InitialBootstrapReferenceAwareRuntimeErrorCode {
  if (error instanceof ScheduledSyncAdmissionEvidenceError) {
    return 'REFERENCE_APPLICATION_ADMISSION_EVIDENCE_FAILED';
  }
  if (
    error instanceof InitialBootstrapApplicationError
    || error instanceof InitialBootstrapCandidateError
    || error instanceof InitialBootstrapError
    || error instanceof MigrationRunStateError
    || error instanceof InitialBootstrapDurableReconciliationError
  ) {
    return 'REFERENCE_APPLICATION_SEMANTIC_FAILED';
  }
  if (
    error instanceof InitialBootstrapMetadataExecutorError
    || error instanceof InitialBootstrapIdentityManifestError
    || error instanceof YdbParameterError
  ) {
    return 'REFERENCE_APPLICATION_METADATA_FAILED';
  }
  if (error instanceof YdbJsV6DataTransportError) {
    return 'REFERENCE_APPLICATION_YDB_DATA_FAILED';
  }
  if (error instanceof InitialBootstrapRuntimePrimitiveError) {
    return 'REFERENCE_RUNTIME_STATE_INVALID';
  }
  return 'REFERENCE_APPLICATION_RUNTIME_FAILED';
}

async function runApplicationSafely(
  observation: Parameters<typeof runInitialBootstrapApplication>[0],
  dependencies: Parameters<typeof runInitialBootstrapApplication>[1],
) {
  try {
    return await runInitialBootstrapApplication(observation, dependencies);
  } catch (error) {
    throw new InitialBootstrapReferenceAwareRuntimeError(classifyApplicationRuntimeError(error));
  }
}

function createReferenceAwareRuntime(): Readonly<InitialBootstrapJobRuntime> {
  let lease: Readonly<GoogleSheetsFullSnapshotLease> | null = null;
  let digest: Readonly<CanonicalSourceDigest> | null = null;
  let primitives: Readonly<InitialBootstrapRuntimePrimitives> | null = null;
  let referenceRows: readonly Readonly<InitialReferenceBootstrapObservationRow>[] | null = null;
  let referencePlan: Readonly<InitialReferenceBootstrapPlan> | null = null;

  const runtime: InitialBootstrapJobRuntime = {
    createDigest(): Readonly<CanonicalSourceDigest> {
      digest = createCanonicalSourceDigest();
      return digest;
    },
    parseHistoricalEvidence: parseInitialBootstrapPrivateHistoricalEvidence,
    createSource(
      config: Readonly<InitialBootstrapJobConfig>,
      receivedDigest: Readonly<CanonicalSourceDigest>,
    ) {
      const accessTokenProvider = createGoogleServiceAccountSheetsAccessTokenProvider({
        clientEmail: config.googleServiceAccountEmail,
        privateKey: config.googleServiceAccountPrivateKey,
      });
      const reader = new GoogleSheetsFullSnapshotReader({
        spreadsheetId: config.spreadsheetId,
        fetch: async (input, init) => fetch(input, init),
        accessTokenProvider,
        digest: receivedDigest,
      });
      return Object.freeze({
        async readFullSnapshotObservation() {
          try {
            lease = await reader.readFullSnapshotObservation();
            return lease;
          } catch {
            throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_SOURCE_READ_FAILED');
          }
        },
      });
    },
    createRuntimePrimitives(): Readonly<InitialBootstrapRuntimePrimitives> {
      primitives = createNodeInitialBootstrapRuntimePrimitives();
      return primitives;
    },
    async createYdbClient(config: Readonly<InitialBootstrapJobConfig>): Promise<Readonly<YdbJsDataClient>> {
      try {
        return await createYdbJsV6MetadataDataClient({
          connectionString: config.ydbConnectionString,
          poolMaxSize: 1,
        });
      } catch {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_YDB_CLIENT_CREATE_FAILED');
      }
    },
    async readReferenceResolver(adapter: YdbAdapter) {
      if (lease === null || digest === null || primitives === null) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_RUNTIME_STATE_INVALID');
      }
      try {
        const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
        referenceRows = Object.freeze(projected.rows.map((row, sourceOrdinal) => Object.freeze({
          sourceOrdinal,
          rawPayload: row.rawPayload,
        })));
        referencePlan = await planInitialReferenceBootstrap(
          adapter,
          referenceRows,
          primitives.referenceIdentityAllocator,
        );
        return referencePlan.resolver;
      } catch {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_RESOLUTION_FAILED');
      }
    },
    createReconciliation(adapter, projectionContext, historicalEvidence) {
      return createInitialBootstrapDurableReconciliation(
        adapter,
        projectionContext,
        historicalEvidence,
      );
    },
    async runApplication(observation, dependencies) {
      if (referencePlan === null || referenceRows === null) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_RUNTIME_STATE_INVALID');
      }

      const recoverySurface = await diagnoseInitialBootstrapRecoverySurface(dependencies.adapter);
      if (recoverySurface.reason === 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN') {
        const reconciled = await reconcileInitialBootstrapReferenceState(
          dependencies.adapter,
          referenceRows,
        );
        const after = await diagnoseInitialBootstrapRecoverySurface(dependencies.adapter);
        if (!isInitialBootstrapResidualReferenceRecoveryAuthorized(
          recoverySurface,
          reconciled,
          after,
          referencePlan.writes.length,
        )) {
          throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE');
        }
        return runApplicationSafely(observation, dependencies);
      }
      if (isUnsafeNoRunRecoverySurface(recoverySurface)) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE');
      }
      if (referencePlan.writes.length === 0) {
        return runApplicationSafely(observation, dependencies);
      }

      let admission;
      try {
        admission = await readScheduledSyncAdmissionEvidence(dependencies.adapter);
      } catch {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_ADMISSION_READ_FAILED');
      }
      if (admission.committedBaselineRun !== null || admission.incompleteRuns.length !== 0) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_BOOTSTRAP_RESUME_UNSAFE');
      }
      const adapter = createInitialBootstrapReferenceClaimAdapter(
        dependencies.adapter,
        referencePlan,
      );
      return runApplicationSafely(observation, Object.freeze({
        ...dependencies,
        adapter,
      }));
    },
  };
  return Object.freeze(runtime);
}

export function runInitialBootstrapReferenceAwareJob(
  config: Readonly<InitialBootstrapJobConfig>,
) {
  return executeInitialBootstrapJob(config, createReferenceAwareRuntime());
}

export function runInitialBootstrapReferenceAwareJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
) {
  return runInitialBootstrapReferenceAwareJob(readInitialBootstrapJobConfig(environment));
}
