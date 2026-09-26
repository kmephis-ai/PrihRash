import {
  createCanonicalSourceDigest,
  type CanonicalSourceDigest,
} from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsFullSnapshotLease,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import {
  YdbAdapter,
  YdbAdapterError,
  YdbCommitOutcomeUnknownError,
} from '../integration/ydb/adapter.js';
import {
  YdbParameterError,
  type YdbParameterErrorCode,
} from '../integration/ydb/parameters.js';
import {
  createYdbJsV6MetadataDataClient,
  YdbJsV6DataTransportError,
  type YdbJsDataClient,
  type YdbJsV6DataTransportErrorCode,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  InitialBootstrapApplicationError,
  runInitialBootstrapApplication,
  runInitialBootstrapGateCApplication,
  type InitialBootstrapApplicationPhase,
  type InitialBootstrapObservation,
} from '../migration/initialBootstrapApplication.js';
import { InitialBootstrapCandidateError } from '../migration/initialBootstrapCandidate.js';
import { AtomicPromotionError } from '../migration/atomicPromotion.js';
import { ControlledRebuildEvidenceReaderError } from '../migration/initialControlledRebuildEvidenceReader.js';
import { InitialControlledRebuildReconciliationError } from '../migration/initialControlledRebuildReconciliation.js';
import {
  createInitialBootstrapDurableReconciliation,
  InitialBootstrapDurableReconciliationError,
} from '../migration/initialBootstrapDurableReconciliation.js';
import {
  InitialBootstrapIdentityManifestError,
  type InitialBootstrapIdentityManifestErrorCode,
} from '../migration/initialBootstrapIdentityManifest.js';
import {
  InitialBootstrapMetadataExecutorError,
  type InitialBootstrapMetadataExecutorErrorCode,
} from '../migration/initialBootstrapMetadataExecutor.js';
import {
  InitialBootstrapPersistenceError,
  type InitialBootstrapPersistenceErrorCode,
} from '../migration/initialBootstrapPersistence.js';
import { InitialRunCounterRefinementError } from '../migration/initialRunCounterRefinement.js';
import { InitialRunCounterRefinementPersistenceError } from '../migration/initialRunCounterRefinementPersistence.js';
import { InitialSourceLineageError } from '../migration/initialSourceLineage.js';
import { InitialSourceLineagePersistenceError } from '../migration/initialSourceLineagePersistence.js';
import { InitialRevisionEvidenceError } from '../migration/initialSourceRevisionEvidenceExecutor.js';
import {
  InitialSourceRevisionEvidenceRecoveryError,
  waitForInitialSourceRevisionEvidenceReadBudget,
} from '../migration/initialSourceRevisionEvidenceRecovery.js';
import { InitialVerifiedCurrentPlanError } from '../migration/initialVerifiedCurrentPlan.js';
import { InitialVerifiedCurrentPersistenceError } from '../migration/initialVerifiedCurrentPersistence.js';
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
import {
  InitialBootstrapStaleStagingRetirementError,
  type InitialBootstrapStaleStagingRetirementErrorCode,
} from '../migration/initialBootstrapStaleStagingRetirement.js';
import {
  InitialSnapshotProjectionStructuralError,
} from '../migration/initialSnapshotProjection.js';
import {
  MigrationRunLifecycleExecutorError,
  type MigrationRunLifecycleExecutorErrorCode,
} from '../migration/migrationRunLifecycleExecutor.js';
import {
  MigrationRunPersistenceError,
  type MigrationRunPersistenceErrorCode,
} from '../migration/migrationRunPersistence.js';
import {
  MigrationRunStateError,
  type MigrationRunStateErrorCode,
} from '../migration/migrationRunState.js';
import {
  readScheduledSyncAdmissionEvidence,
  ScheduledSyncAdmissionEvidenceError,
  type ScheduledSyncAdmissionEvidenceErrorCode,
} from '../migration/scheduledSyncAdmissionEvidence.js';
import {
  SourceSnapshotSemanticProjectionStructuralError,
} from '../migration/sourceSnapshotSemanticProjection.js';
import {
  planInitialReferenceBootstrap,
  type InitialReferenceBootstrapPlan,
} from '../reference/initialBootstrapReferencePlan.js';
import type {
  InitialReferenceBootstrapObservationRow,
} from '../reference/initialBootstrapReferenceVocabulary.js';
import {
  InitialBootstrapStaleStagingRetirementJobError,
  type InitialBootstrapStaleStagingRetirementJobErrorCode,
} from './initialBootstrapStaleStagingRetirementJob.js';
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
  | 'REFERENCE_FUNCTION_MODULE_LOAD_FAILED'
  | 'REFERENCE_FUNCTION_HANDLER_UNCAUGHT'
  | 'REFERENCE_BOOTSTRAP_RESUME_UNSAFE'
  | 'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE'
  | 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED';

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

export type InitialBootstrapMetadataFailureCode =
  | `METADATA_EXECUTOR_${InitialBootstrapMetadataExecutorErrorCode}`
  | `IDENTITY_MANIFEST_${InitialBootstrapIdentityManifestErrorCode}`
  | `BOOTSTRAP_PERSISTENCE_${InitialBootstrapPersistenceErrorCode}`
  | `MIGRATION_RUN_LIFECYCLE_${MigrationRunLifecycleExecutorErrorCode}`
  | `MIGRATION_RUN_PERSISTENCE_${MigrationRunPersistenceErrorCode}`
  | `YDB_PARAMETER_${YdbParameterErrorCode}`;

export type InitialBootstrapYdbDataFailureCode =
  | `YDB_TRANSPORT_${YdbJsV6DataTransportErrorCode}`
  | 'YDB_ADAPTER_WRITE_REQUIRES_TRANSACTION'
  | 'YDB_COMMIT_OUTCOME_UNKNOWN';

export type InitialBootstrapStaleRetirementFailureCode =
  | InitialBootstrapStaleStagingRetirementErrorCode
  | `JOB_${InitialBootstrapStaleStagingRetirementJobErrorCode}`
  | `ADMISSION_${ScheduledSyncAdmissionEvidenceErrorCode}`
  | `MIGRATION_RUN_STATE_${MigrationRunStateErrorCode}`;

export class InitialBootstrapReferenceAwareRuntimeError extends Error {
  readonly code: InitialBootstrapReferenceAwareRuntimeErrorCode;
  readonly applicationPhase: InitialBootstrapApplicationPhase | null;
  readonly metadataFailureCode: InitialBootstrapMetadataFailureCode | null;
  readonly ydbDataFailureCode: InitialBootstrapYdbDataFailureCode | null;
  readonly staleRetirementFailureCode: InitialBootstrapStaleRetirementFailureCode | null;

  constructor(
    code: InitialBootstrapReferenceAwareRuntimeErrorCode,
    applicationPhase: InitialBootstrapApplicationPhase | null = null,
    metadataFailureCode: InitialBootstrapMetadataFailureCode | null = null,
    ydbDataFailureCode: InitialBootstrapYdbDataFailureCode | null = null,
    staleRetirementFailureCode: InitialBootstrapStaleRetirementFailureCode | null = null,
  ) {
    super(code);
    this.name = 'InitialBootstrapReferenceAwareRuntimeError';
    this.code = code;
    this.applicationPhase = applicationPhase;
    this.metadataFailureCode = metadataFailureCode;
    this.ydbDataFailureCode = ydbDataFailureCode;
    this.staleRetirementFailureCode = staleRetirementFailureCode;
  }
}

export function classifyInitialBootstrapMetadataFailureCode(
  error: unknown,
): InitialBootstrapMetadataFailureCode | null {
  if (error instanceof InitialBootstrapMetadataExecutorError) {
    return `METADATA_EXECUTOR_${error.code}`;
  }
  if (error instanceof InitialBootstrapIdentityManifestError) {
    return `IDENTITY_MANIFEST_${error.code}`;
  }
  if (error instanceof InitialBootstrapPersistenceError) {
    return `BOOTSTRAP_PERSISTENCE_${error.code}`;
  }
  if (error instanceof MigrationRunLifecycleExecutorError) {
    return `MIGRATION_RUN_LIFECYCLE_${error.code}`;
  }
  if (error instanceof MigrationRunPersistenceError) {
    return `MIGRATION_RUN_PERSISTENCE_${error.code}`;
  }
  if (error instanceof YdbParameterError) {
    return `YDB_PARAMETER_${error.code}`;
  }
  return null;
}

export function classifyInitialBootstrapStaleRetirementFailureCode(
  error: unknown,
): InitialBootstrapStaleRetirementFailureCode | null {
  if (error instanceof InitialBootstrapStaleStagingRetirementError) return error.code;
  if (error instanceof InitialBootstrapStaleStagingRetirementJobError) {
    return `JOB_${error.code}`;
  }
  if (error instanceof ScheduledSyncAdmissionEvidenceError) {
    return `ADMISSION_${error.code}`;
  }
  if (error instanceof MigrationRunStateError) {
    return `MIGRATION_RUN_STATE_${error.code}`;
  }
  return null;
}

export function classifyInitialBootstrapYdbDataFailureCode(
  error: unknown,
): InitialBootstrapYdbDataFailureCode | null {
  if (error instanceof YdbJsV6DataTransportError) {
    return `YDB_TRANSPORT_${error.code}`;
  }
  if (error instanceof YdbAdapterError) {
    return error.code === 'WRITE_REQUIRES_TRANSACTION'
      ? 'YDB_ADAPTER_WRITE_REQUIRES_TRANSACTION'
      : 'YDB_COMMIT_OUTCOME_UNKNOWN';
  }
  if (error instanceof YdbCommitOutcomeUnknownError) {
    return 'YDB_COMMIT_OUTCOME_UNKNOWN';
  }
  return null;
}

function classifyGenericApplicationPhase(
  phase: InitialBootstrapApplicationPhase | null,
): InitialBootstrapReferenceAwareRuntimeErrorCode {
  switch (phase) {
    case 'FRESH_CONTEXT_PREPARATION':
    case 'RESUME_CONTEXT_PREPARATION':
    case 'REVISION_EVIDENCE_PREPARATION':
    case 'LINEAGE_PREPARATION':
    case 'COUNTER_REFINEMENT_PREPARATION':
    case 'VALIDATION_EVALUATION':
    case 'CURRENT_PLAN_PREPARATION':
      return 'REFERENCE_APPLICATION_SEMANTIC_FAILED';
    case 'FRESH_METADATA_PREPARATION':
    case 'CURRENT_WRITE_PREPARATION':
    case 'VALIDATION_WRITE_PREPARATION':
      return 'REFERENCE_APPLICATION_METADATA_FAILED';
    case 'ADMISSION_READ':
    case 'CURRENT_STATE_PREFLIGHT':
    case 'FRESH_CLAIM_WRITE':
    case 'RESUME_CONTEXT_READ':
    case 'RESUME_IDENTITY_MANIFEST_READ':
    case 'RESUME_SNAPSHOT_READ':
    case 'REVISION_EVIDENCE_WRITE':
    case 'COUNTER_REFINEMENT_WRITE':
    case 'RECONCILIATION_READ':
    case 'PRE_PROMOTION_PREFLIGHT':
    case 'VALIDATION_TRANSITION_WRITE':
    case 'PROMOTION_WRITE':
      return 'REFERENCE_APPLICATION_YDB_DATA_FAILED';
    default:
      return 'REFERENCE_APPLICATION_RUNTIME_FAILED';
  }
}

function classifyApplicationRuntimeError(
  error: unknown,
  phase: InitialBootstrapApplicationPhase | null,
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
    || error instanceof ControlledRebuildEvidenceReaderError
    || error instanceof InitialSnapshotProjectionStructuralError
    || error instanceof SourceSnapshotSemanticProjectionStructuralError
    || error instanceof InitialControlledRebuildReconciliationError
    || error instanceof InitialSourceLineageError
    || error instanceof InitialSourceRevisionEvidenceRecoveryError
    || error instanceof InitialRevisionEvidenceError
    || error instanceof InitialRunCounterRefinementError
    || error instanceof InitialVerifiedCurrentPlanError
    || error instanceof AtomicPromotionError
  ) {
    return 'REFERENCE_APPLICATION_SEMANTIC_FAILED';
  }
  if (
    error instanceof InitialBootstrapMetadataExecutorError
    || error instanceof InitialBootstrapIdentityManifestError
    || error instanceof InitialBootstrapPersistenceError
    || error instanceof InitialSourceLineagePersistenceError
    || error instanceof InitialRunCounterRefinementPersistenceError
    || error instanceof InitialVerifiedCurrentPersistenceError
    || error instanceof MigrationRunLifecycleExecutorError
    || error instanceof MigrationRunPersistenceError
    || error instanceof YdbParameterError
  ) {
    return 'REFERENCE_APPLICATION_METADATA_FAILED';
  }
  if (
    error instanceof YdbJsV6DataTransportError
    || error instanceof YdbAdapterError
    || error instanceof YdbCommitOutcomeUnknownError
  ) {
    return 'REFERENCE_APPLICATION_YDB_DATA_FAILED';
  }
  if (error instanceof InitialBootstrapRuntimePrimitiveError) {
    return 'REFERENCE_RUNTIME_STATE_INVALID';
  }
  return classifyGenericApplicationPhase(phase);
}

type InitialBootstrapApplicationRunner = typeof runInitialBootstrapApplication;

async function runApplicationSafely(
  observation: Parameters<InitialBootstrapApplicationRunner>[0],
  dependencies: Parameters<InitialBootstrapApplicationRunner>[1],
  runApplication: InitialBootstrapApplicationRunner,
) {
  let phase: InitialBootstrapApplicationPhase | null = null;
  const observedDependencies = Object.freeze({
    ...dependencies,
    observePhase(nextPhase: InitialBootstrapApplicationPhase) {
      phase = nextPhase;
    },
  });
  try {
    return await runApplication(observation, observedDependencies);
  } catch (error) {
    throw new InitialBootstrapReferenceAwareRuntimeError(
      classifyApplicationRuntimeError(error, phase),
      phase,
      classifyInitialBootstrapMetadataFailureCode(error),
      classifyInitialBootstrapYdbDataFailureCode(error),
    );
  }
}

function createReferenceAwareRuntime(
  runApplication: InitialBootstrapApplicationRunner,
): Readonly<InitialBootstrapJobRuntime> {
  let primitives: Readonly<InitialBootstrapRuntimePrimitives> | null = null;
  let referenceRows: readonly Readonly<InitialReferenceBootstrapObservationRow>[] | null = null;
  let referencePlan: Readonly<InitialReferenceBootstrapPlan> | null = null;

  function releaseReferencePlanningState(): void {
    primitives = null;
    referenceRows = null;
    referencePlan = null;
  }

  const runtime: InitialBootstrapJobRuntime = {
    createDigest(): Readonly<CanonicalSourceDigest> {
      return createCanonicalSourceDigest();
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
            return await reader.readFullSnapshotObservation();
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
    async readReferenceResolver(
      adapter: YdbAdapter,
      observation: Readonly<InitialBootstrapObservation>,
    ) {
      if (primitives === null) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_RUNTIME_STATE_INVALID');
      }
      try {
        const plannedRows = Object.freeze(observation.rows.map((row, sourceOrdinal) => Object.freeze({
          sourceOrdinal,
          rawPayload: row.rawPayload,
        })));
        referenceRows = plannedRows;
        referencePlan = await planInitialReferenceBootstrap(
          adapter,
          plannedRows,
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
        undefined,
        undefined,
        waitForInitialSourceRevisionEvidenceReadBudget,
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
        releaseReferencePlanningState();
        return runApplicationSafely(observation, dependencies, runApplication);
      }
      if (isUnsafeNoRunRecoverySurface(recoverySurface)) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE');
      }
      if (referencePlan.writes.length === 0) {
        releaseReferencePlanningState();
        return runApplicationSafely(observation, dependencies, runApplication);
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
      }), runApplication);
    },
  };
  return Object.freeze(runtime);
}

export function runInitialBootstrapReferenceAwareJob(
  config: Readonly<InitialBootstrapJobConfig>,
) {
  return executeInitialBootstrapJob(
    config,
    createReferenceAwareRuntime(runInitialBootstrapApplication),
  );
}

export function runInitialBootstrapReferenceAwareJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
) {
  return runInitialBootstrapReferenceAwareJob(readInitialBootstrapJobConfig(environment));
}

export function runInitialBootstrapGateCReferenceAwareJob(
  config: Readonly<InitialBootstrapJobConfig>,
) {
  return executeInitialBootstrapJob(
    config,
    createReferenceAwareRuntime(runInitialBootstrapGateCApplication),
  );
}

export function runInitialBootstrapGateCReferenceAwareJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
) {
  return runInitialBootstrapGateCReferenceAwareJob(readInitialBootstrapJobConfig(environment));
}
