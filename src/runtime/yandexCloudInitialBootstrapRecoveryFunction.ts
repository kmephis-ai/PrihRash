import type {
  InitialBootstrapRecoverySurfaceReason,
} from '../migration/initialBootstrapResidualSurface.js';
import type {
  InitialBootstrapRecoveryVerdict,
} from '../migration/initialBootstrapRecoveryProbe.js';
import {
  InitialBootstrapRecoveryJobError,
  runInitialBootstrapRecoveryJobFromEnvironment,
  type InitialBootstrapRecoveryJobEnvironment,
  type InitialBootstrapRecoveryJobResult,
} from './initialBootstrapRecoveryJob.js';

export type YandexInitialBootstrapRecoveryFunctionResult =
  | Readonly<{
      status: 'PASS';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED';
      verdict: InitialBootstrapRecoveryVerdict;
      reason: InitialBootstrapRecoverySurfaceReason;
      validatedSourceEvidence?: InitialBootstrapRecoveryJobResult['validatedSourceEvidence'];
      staleValidatedRecoveryGate?: InitialBootstrapRecoveryJobResult['staleValidatedRecoveryGate'];
      stagingRevisionEvidence?: InitialBootstrapRecoveryJobResult['stagingRevisionEvidence'];
      stagingDurableRevisionEvidence?: InitialBootstrapRecoveryJobResult['stagingDurableRevisionEvidence'];
      stagingRetirementEvidence?: InitialBootstrapRecoveryJobResult['stagingRetirementEvidence'];
      stagingSourceDecodeEvidence?: InitialBootstrapRecoveryJobResult['stagingSourceDecodeEvidence'];
      stagingExactRevisionEvidence?: InitialBootstrapRecoveryJobResult['stagingExactRevisionEvidence'];
      stagingControlledPreparationEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationEvidence'];
      stagingControlledPreparationRetryEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationRetryEvidence'];
      stagingControlledPreparationQueryErrorEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationQueryErrorEvidence'];
      stagingControlledPreparationGrpcStatusEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationGrpcStatusEvidence'];
      stagingControlledPreparationPhaseEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationPhaseEvidence'];
      stagingControlledPreparationReferenceReadStageEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationReferenceReadStageEvidence'];
      stagingControlledPreparationReconciliationReadStageEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationReconciliationReadStageEvidence'];
      stagingControlledPreparationMetadataScanCostEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationMetadataScanCostEvidence'];
      stagingControlledPreparationReferenceEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationReferenceEvidence'];
      stagingControlledPreparationRevisionPayloadBatchEvidence?: InitialBootstrapRecoveryJobResult['stagingControlledPreparationRevisionPayloadBatchEvidence'];
    }>
  | Readonly<{
      status: 'FAIL';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID' | 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED';
    }>;

export interface YandexInitialBootstrapRecoveryJob {
  (environment: InitialBootstrapRecoveryJobEnvironment): Promise<Readonly<InitialBootstrapRecoveryJobResult>>;
}

const VALIDATED_SOURCE_EVIDENCE = new Set([
  'AUTHORITATIVE_SNAPSHOT_MATCH',
  'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
  'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
  'AUTHORITATIVE_ROW_COUNT_MISMATCH',
  'AUTHORITATIVE_BINDING_MISMATCH',
  'VALIDATED_METADATA_INVALID',
  'VALIDATED_SOURCE_DIAGNOSTIC_FAILED',
]);

const STALE_VALIDATED_GATE_BLOCKERS = new Set([
  'COMMITTED_BASELINE_PRESENT',
  'VALIDATED_RUN_NOT_UNIQUE',
  'VALIDATED_RUN_METADATA_INVALID',
  'SOURCE_DRIFT_NOT_PROVEN',
  'HISTORICAL_CONTEXT_NOT_PROVEN',
  'CURRENT_STATE_NOT_EMPTY',
  'STAGING_CANDIDATE_NOT_EXACT',
  'SWAP_NOT_PROVEN_NOT_APPLIED',
  'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN',
  'SINGLE_WRITER_EXCLUSION_NOT_PROVEN',
]);

function validStaleValidatedRecoveryGate(
  value: InitialBootstrapRecoveryJobResult['staleValidatedRecoveryGate'],
): boolean {
  return value !== undefined
    && value.status === 'BLOCKED'
    && STALE_VALIDATED_GATE_BLOCKERS.has(value.blocker);
}

const STAGING_REVISION_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingRevisionEvidence']>>([
  'NO_REVISION_EVIDENCE',
  'PARTIAL_CURRENT_RUN_ONLY',
  'COMPLETE_CURRENT_RUN_ONLY',
  'CROSS_RUN_PK_COLLISION',
  'STAGING_MANIFEST_CARDINALITY_MISMATCH',
  'STAGING_MANIFEST_STRUCTURE_MISMATCH',
  'STAGING_DURABLE_METADATA_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
  'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
  'AUTHORITATIVE_ROW_COUNT_MISMATCH',
  'AUTHORITATIVE_BINDING_MISMATCH',
  'REVISION_ROW_MALFORMED',
  'REVISION_ROW_DUPLICATE',
  'REVISION_ROW_UNEXPECTED_SOURCE',
  'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH',
  'REVISION_EVIDENCE_DIAGNOSTIC_FAILED',
]);

const STAGING_DURABLE_REVISION_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingDurableRevisionEvidence']>>([
  'NO_REVISION_EVIDENCE',
  'PARTIAL_CURRENT_RUN_ONLY',
  'COMPLETE_CURRENT_RUN_ONLY',
  'CROSS_RUN_PK_COLLISION',
  'STAGING_MANIFEST_CARDINALITY_MISMATCH',
  'STAGING_MANIFEST_STRUCTURE_MISMATCH',
  'STAGING_DURABLE_METADATA_MISMATCH',
  'REVISION_ROW_MALFORMED',
  'REVISION_ROW_DUPLICATE',
  'REVISION_ROW_UNEXPECTED_SOURCE',
  'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH',
  'REVISION_EVIDENCE_DIAGNOSTIC_FAILED',
]);

const STAGING_RETIREMENT_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingRetirementEvidence']>>([
  'STALE_STAGING_CURRENT_STATE_EMPTY',
  'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
  'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED',
]);

const STAGING_EXACT_REVISION_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingExactRevisionEvidence']>>([
  'EXACT_CURRENT_RUN_MATCH',
  'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN',
  'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH',
  'EXACT_CURRENT_RUN_REVISION_MALFORMED',
  'EXACT_CURRENT_RUN_REVISION_DUPLICATE',
  'EXACT_CURRENT_RUN_REVISION_UNEXPECTED_SOURCE',
  'EXACT_CURRENT_RUN_MIGRATION_RUN_MISMATCH',
  'EXACT_CURRENT_RUN_OBSERVED_AT_MISMATCH',
  'EXACT_CURRENT_RUN_ROW_HINT_MISMATCH',
  'EXACT_CURRENT_RUN_ROW_DIGEST_MISMATCH',
  'EXACT_CURRENT_RUN_CHANGE_CLASS_MISMATCH',
  'EXACT_CURRENT_RUN_RAW_PAYLOAD_MALFORMED',
  'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  'EXACT_CURRENT_RUN_DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationEvidence']>>([
  'READY',
  'BASELINE_EXISTS',
  'VALIDATION_BLOCKED',
  'YDB_QUERY_TIMEOUT',
  'YDB_DATA_SDK_SHAPE_INVALID',
  'YDB_DATA_PARAMETER_VALUE_INVALID',
  'YDB_DATA_PARAMETER_TYPE_UNSUPPORTED',
  'YDB_DATA_TIMESTAMP_PRECISION_UNSUPPORTED',
  'YDB_DATA_QUERY_EXECUTION_FAILED',
  'YDB_DATA_QUERY_EXECUTION_YDB_BAD_REQUEST',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNAUTHORIZED',
  'YDB_DATA_QUERY_EXECUTION_YDB_INTERNAL_ERROR',
  'YDB_DATA_QUERY_EXECUTION_YDB_ABORTED',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNAVAILABLE',
  'YDB_DATA_QUERY_EXECUTION_YDB_OVERLOADED',
  'YDB_DATA_QUERY_EXECUTION_YDB_SCHEME_ERROR',
  'YDB_DATA_QUERY_EXECUTION_YDB_GENERIC_ERROR',
  'YDB_DATA_QUERY_EXECUTION_YDB_BAD_SESSION',
  'YDB_DATA_QUERY_EXECUTION_YDB_PRECONDITION_FAILED',
  'YDB_DATA_QUERY_EXECUTION_YDB_ALREADY_EXISTS',
  'YDB_DATA_QUERY_EXECUTION_YDB_NOT_FOUND',
  'YDB_DATA_QUERY_EXECUTION_YDB_SESSION_EXPIRED',
  'YDB_DATA_QUERY_EXECUTION_YDB_CANCELLED',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNDETERMINED',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNSUPPORTED',
  'YDB_DATA_QUERY_EXECUTION_YDB_SESSION_BUSY',
  'YDB_DATA_QUERY_EXECUTION_YDB_EXTERNAL_ERROR',
  'YDB_DATA_CLIENT_CONFIG_INVALID',
  'DURABLE_RECONCILIATION_FAILURE',
  'REVISION_EVIDENCE_FAILURE',
  'PRIVATE_EVIDENCE_FAILURE',
  'APPLICATION_MULTIPLE_INCOMPLETE_RUNS',
  'APPLICATION_BOOTSTRAP_OBSERVATION_INVALID',
  'APPLICATION_RESUME_RUN_COUNTERS_MISMATCH',
  'APPLICATION_RESUME_COUNTER_REFINEMENT_CONFLICT',
  'APPLICATION_SNAPSHOT_EVIDENCE_MISSING',
  'APPLICATION_SNAPSHOT_EVIDENCE_AMBIGUOUS',
  'APPLICATION_SNAPSHOT_EVIDENCE_MISMATCH',
  'APPLICATION_CURRENT_STATE_NOT_EMPTY',
  'APPLICATION_PROMOTION_PREFLIGHT_DRIFT',
  'APPLICATION_CONTROLLED_CONTINUATION_RUN_MISSING',
  'APPLICATION_CONTROLLED_CONTINUATION_RUN_STATE_INVALID',
  'APPLICATION_CONTROLLED_CONTINUATION_ROUTE_NOT_REQUIRED',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationRetryEvidence']>>([
  'UNOBSERVED',
  'NO_RETRY',
  'RETRIED',
  'NON_RETRYABLE',
  'EXHAUSTED',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_QUERY_ERROR_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationQueryErrorEvidence']>>([
  'UNOBSERVED',
  'ABORT_TIMEOUT',
  'YDB_STATUS',
  'GRPC_STATUS',
  'CLIENT_ERROR',
  'OTHER',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_GRPC_STATUS_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationGrpcStatusEvidence']>>([
  'UNOBSERVED',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
  'NON_GRPC',
  'UNRECOGNIZED',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_PHASE_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationPhaseEvidence']>>([
  'UNOBSERVED',
  'ADMISSION_READ',
  'CURRENT_STATE_PREFLIGHT',
  'FRESH_CONTEXT_PREPARATION',
  'FRESH_METADATA_PREPARATION',
  'FRESH_CLAIM_WRITE',
  'RESUME_CONTEXT_READ',
  'RESUME_IDENTITY_MANIFEST_READ',
  'RESUME_SNAPSHOT_READ',
  'RESUME_CONTEXT_PREPARATION',
  'REVISION_EVIDENCE_PREPARATION',
  'REVISION_EVIDENCE_WRITE',
  'LINEAGE_PREPARATION',
  'COUNTER_REFINEMENT_PREPARATION',
  'COUNTER_REFINEMENT_WRITE',
  'RECONCILIATION_READ',
  'VALIDATION_EVALUATION',
  'CURRENT_PLAN_PREPARATION',
  'CURRENT_WRITE_PREPARATION',
  'PRE_PROMOTION_PREFLIGHT',
  'VALIDATION_WRITE_PREPARATION',
  'VALIDATION_TRANSITION_WRITE',
  'PROMOTION_WRITE',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_REFERENCE_READ_STAGE_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationReferenceReadStageEvidence']>>([
  'UNOBSERVED',
  'REFERENCE_SNAPSHOT_READ',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_RECONCILIATION_READ_STAGE_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationReconciliationReadStageEvidence']>>([
  'UNOBSERVED',
  'REVISION_METADATA_SCAN',
  'REVISION_PAYLOAD_BATCH',
  'REVISION_COLLISION_READ',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_METADATA_SCAN_COST_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationMetadataScanCostEvidence']>>([
  'UNOBSERVED',
  'LT_10_RU',
  'GE_10_LT_3000_RU',
  'GE_3000_RU',
  'STATS_UNAVAILABLE',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_REVISION_PAYLOAD_BATCH_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationRevisionPayloadBatchEvidence']>>([
  'UNOBSERVED',
  'NO_PAYLOAD_BATCH',
  'ALL_BATCHES_WITHIN_64_KIB',
  'SINGLE_REVISION_EXCEEDS_64_KIB',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_REFERENCE_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingControlledPreparationReferenceEvidence']>>([
  'UNOBSERVED',
  'REFERENCE_SNAPSHOT_VALIDATED',
  'REFERENCE_READ_FAILED',
  'REFERENCE_READER_MALFORMED_ACCOUNT_REFERENCE_EVIDENCE',
  'REFERENCE_READER_MALFORMED_CATEGORY_REFERENCE_EVIDENCE',
  'REFERENCE_READER_MALFORMED_VIKA_MEMBER_EVIDENCE',
  'REFERENCE_READER_REFERENCE_SNAPSHOT_KIND_MISSING',
  'REFERENCE_READER_REFERENCE_SNAPSHOT_KIND_UNKNOWN',
  'REFERENCE_READER_VIKA_MEMBER_NOT_FOUND',
  'REFERENCE_READER_DUPLICATE_VIKA_MEMBER_EVIDENCE',
  'REFERENCE_RESOLVER_INVALID_ACCOUNT_ID',
  'REFERENCE_RESOLVER_INVALID_CATEGORY_ID',
  'REFERENCE_RESOLVER_INVALID_VIKA_MEMBER_ID',
  'REFERENCE_RESOLVER_INVALID_ACCOUNT_CURRENCY',
  'REFERENCE_RESOLVER_DUPLICATE_ACCOUNT_SOURCE_KEY',
  'REFERENCE_RESOLVER_DUPLICATE_ACCOUNT_TARGET_ID',
  'REFERENCE_RESOLVER_DUPLICATE_CATEGORY_SOURCE_KEY',
  'REFERENCE_RESOLVER_DUPLICATE_CATEGORY_TARGET_ID',
  'DIAGNOSTIC_FAILED',
]);

const SOURCE_DECODE_ERROR_CODES = new Set([
  'INVALID_PAYLOAD_SCHEMA',
  'UNRECOGNIZED_FINANCIAL_OPERATION_TYPE',
  'INVALID_DATE_CELL',
  'INVALID_DATE_SERIAL',
  'INVALID_AMOUNT_CELL',
  'INVALID_AMOUNT_DECIMAL',
  'INVALID_AMOUNT_SCALE',
  'AMOUNT_OUT_OF_RANGE',
  'INVALID_TEXT_CELL',
]);

const SOURCE_DECODE_FIELDS = new Set([
  'adapter_schema_version',
  'date',
  'operation_type',
  'expense_account',
  'expense_category',
  'description',
  'expense_amount',
  'income_account',
  'income_category',
  'income_amount',
  'vika_flag',
  'note',
]);

function validSourceDecodeEvidence(
  value: InitialBootstrapRecoveryJobResult['stagingSourceDecodeEvidence'],
): boolean {
  if (value === 'SOURCE_DECODE_DIAGNOSTIC_FAILED') return true;
  if (!Array.isArray(value)) return false;
  const tokens: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(',') !== 'errorCode,field') return false;
    if (typeof candidate.errorCode !== 'string' || !SOURCE_DECODE_ERROR_CODES.has(candidate.errorCode)) {
      return false;
    }
    if (typeof candidate.field !== 'string' || !SOURCE_DECODE_FIELDS.has(candidate.field)) return false;
    tokens.push(`${candidate.errorCode}@${candidate.field}`);
  }
  if (new Set(tokens).size !== tokens.length) return false;
  return tokens.every((token, index) => index === 0 || tokens[index - 1]! < token);
}

const RECOVERY_REQUIRED_REASONS = new Set<InitialBootstrapRecoverySurfaceReason>([
  'READ_FAILED',
  'RUN_STATE_COUNT_INCONSISTENT',
  'RESIDUAL_STATE_WITHOUT_RUN',
  'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN',
  'RESIDUAL_METADATA_STATE_WITHOUT_RUN',
  'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN',
  'RESIDUAL_MIXED_STATE_WITHOUT_RUN',
  'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  'RESIDUAL_REFERENCE_STATE_MISMATCH',
  'REFERENCE_RECONCILIATION_FAILED',
  'MULTIPLE_MIGRATION_RUNS',
  'STAGING_RUN_PRESENT',
  'VALIDATED_RUN_PRESENT',
  'VALIDATED_CURRENT_EMPTY_STAGING_ABSENT',
  'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY',
  'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
  'VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT',
  'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT',
  'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS',
  'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED',
  'FAILED_RUN_PRESENT',
  'STALE_STAGING_RETIRED',
  'COMMITTED_ROWS_SEEN_MISSING',
  'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID',
  'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID',
  'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH',
  'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH',
]);

function validClassification(
  value: Readonly<InitialBootstrapRecoveryJobResult>,
  surfaceOnly = false,
  controlledPreparationOnly = false,
): boolean {
  if (value.reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY' && !surfaceOnly) {
    if (value.validatedSourceEvidence === undefined || !VALIDATED_SOURCE_EVIDENCE.has(value.validatedSourceEvidence)) return false;
    if (!validStaleValidatedRecoveryGate(value.staleValidatedRecoveryGate)) return false;
  } else if (value.validatedSourceEvidence !== undefined || value.staleValidatedRecoveryGate !== undefined) return false;
  const diagnostic = value.stagingRevisionEvidence;
  const durableDiagnostic = value.stagingDurableRevisionEvidence;
  const retirementDiagnostic = value.stagingRetirementEvidence;
  const sourceDecodeDiagnostic = value.stagingSourceDecodeEvidence;
  const exactRevisionDiagnostic = value.stagingExactRevisionEvidence;
  const controlledPreparationDiagnostic = value.stagingControlledPreparationEvidence;
  const controlledPreparationRetryDiagnostic = value.stagingControlledPreparationRetryEvidence;
  const controlledPreparationQueryErrorDiagnostic = value.stagingControlledPreparationQueryErrorEvidence;
  const controlledPreparationGrpcStatusDiagnostic = value.stagingControlledPreparationGrpcStatusEvidence;
  const controlledPreparationPhaseDiagnostic = value.stagingControlledPreparationPhaseEvidence;
  const controlledPreparationReferenceReadStageDiagnostic =
    value.stagingControlledPreparationReferenceReadStageEvidence;
  const controlledPreparationReconciliationReadStageDiagnostic =
    value.stagingControlledPreparationReconciliationReadStageEvidence;
  const controlledPreparationMetadataScanCostDiagnostic =
    value.stagingControlledPreparationMetadataScanCostEvidence;
  const controlledPreparationRevisionPayloadBatchDiagnostic =
    value.stagingControlledPreparationRevisionPayloadBatchEvidence;
  const controlledPreparationReferenceDiagnostic =
    value.stagingControlledPreparationReferenceEvidence;
  if (value.reason === 'STAGING_RUN_PRESENT' && surfaceOnly) {
    if (diagnostic !== undefined || durableDiagnostic !== undefined || retirementDiagnostic !== undefined
      || sourceDecodeDiagnostic !== undefined || exactRevisionDiagnostic !== undefined
      || controlledPreparationDiagnostic !== undefined
      || controlledPreparationRetryDiagnostic !== undefined
      || controlledPreparationQueryErrorDiagnostic !== undefined
      || controlledPreparationGrpcStatusDiagnostic !== undefined
      || controlledPreparationPhaseDiagnostic !== undefined
      || controlledPreparationReferenceReadStageDiagnostic !== undefined
      || controlledPreparationReconciliationReadStageDiagnostic !== undefined
      || controlledPreparationMetadataScanCostDiagnostic !== undefined
      || controlledPreparationReferenceDiagnostic !== undefined
      || controlledPreparationRevisionPayloadBatchDiagnostic !== undefined) return false;
  } else if (value.reason === 'STAGING_RUN_PRESENT' && controlledPreparationOnly) {
    if (
      diagnostic !== undefined
      || durableDiagnostic !== undefined
      || retirementDiagnostic !== undefined
      || sourceDecodeDiagnostic !== undefined
      || exactRevisionDiagnostic !== undefined
      || controlledPreparationDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_EVIDENCE.has(controlledPreparationDiagnostic)
      || controlledPreparationRetryDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE.has(controlledPreparationRetryDiagnostic)
      || controlledPreparationQueryErrorDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_QUERY_ERROR_EVIDENCE.has(controlledPreparationQueryErrorDiagnostic)
      || controlledPreparationGrpcStatusDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_GRPC_STATUS_EVIDENCE.has(controlledPreparationGrpcStatusDiagnostic)
      || controlledPreparationPhaseDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_PHASE_EVIDENCE.has(controlledPreparationPhaseDiagnostic)
      || controlledPreparationReferenceReadStageDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_REFERENCE_READ_STAGE_EVIDENCE.has(
        controlledPreparationReferenceReadStageDiagnostic,
      )
      || controlledPreparationReconciliationReadStageDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_RECONCILIATION_READ_STAGE_EVIDENCE.has(
        controlledPreparationReconciliationReadStageDiagnostic,
      )
      || controlledPreparationMetadataScanCostDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_METADATA_SCAN_COST_EVIDENCE.has(
        controlledPreparationMetadataScanCostDiagnostic,
      )
      || controlledPreparationRevisionPayloadBatchDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_REVISION_PAYLOAD_BATCH_EVIDENCE.has(
        controlledPreparationRevisionPayloadBatchDiagnostic,
      )
      || controlledPreparationReferenceDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_REFERENCE_EVIDENCE.has(
        controlledPreparationReferenceDiagnostic,
      )
    ) return false;
  } else if (value.reason === 'STAGING_RUN_PRESENT') {
    if (diagnostic === undefined || !STAGING_REVISION_EVIDENCE.has(diagnostic)) return false;
    if (durableDiagnostic === undefined || !STAGING_DURABLE_REVISION_EVIDENCE.has(durableDiagnostic)) return false;
    if (retirementDiagnostic === undefined || !STAGING_RETIREMENT_EVIDENCE.has(retirementDiagnostic)) return false;
    if (sourceDecodeDiagnostic === undefined || !validSourceDecodeEvidence(sourceDecodeDiagnostic)) return false;
    if (exactRevisionDiagnostic === undefined || !STAGING_EXACT_REVISION_EVIDENCE.has(exactRevisionDiagnostic)) return false;
    if (
      controlledPreparationDiagnostic !== undefined
      || controlledPreparationRetryDiagnostic !== undefined
      || controlledPreparationQueryErrorDiagnostic !== undefined
      || controlledPreparationGrpcStatusDiagnostic !== undefined
      || controlledPreparationPhaseDiagnostic !== undefined
      || controlledPreparationReferenceReadStageDiagnostic !== undefined
      || controlledPreparationReconciliationReadStageDiagnostic !== undefined
      || controlledPreparationMetadataScanCostDiagnostic !== undefined
      || controlledPreparationReferenceDiagnostic !== undefined
      || controlledPreparationRevisionPayloadBatchDiagnostic !== undefined
    ) return false;
  } else if (
    diagnostic !== undefined
    || durableDiagnostic !== undefined
    || retirementDiagnostic !== undefined
    || sourceDecodeDiagnostic !== undefined
    || exactRevisionDiagnostic !== undefined
    || controlledPreparationDiagnostic !== undefined
    || controlledPreparationRetryDiagnostic !== undefined
    || controlledPreparationQueryErrorDiagnostic !== undefined
    || controlledPreparationGrpcStatusDiagnostic !== undefined
    || controlledPreparationPhaseDiagnostic !== undefined
    || controlledPreparationReferenceReadStageDiagnostic !== undefined
    || controlledPreparationReconciliationReadStageDiagnostic !== undefined
    || controlledPreparationMetadataScanCostDiagnostic !== undefined
    || controlledPreparationReferenceDiagnostic !== undefined
    || controlledPreparationRevisionPayloadBatchDiagnostic !== undefined
  ) {
    return false;
  }
  if (value.verdict === 'APPLIED') return value.reason === 'COMMITTED_DURABLE_STATE';
  if (value.verdict === 'NOT_APPLIED') return value.reason === 'EMPTY_DURABLE_STATE';
  return value.verdict === 'RECOVERY_REQUIRED' && RECOVERY_REQUIRED_REASONS.has(value.reason);
}

export async function executeYandexInitialBootstrapRecoveryFunction(
  environment: InitialBootstrapRecoveryJobEnvironment,
  runJob: YandexInitialBootstrapRecoveryJob,
): Promise<Readonly<YandexInitialBootstrapRecoveryFunctionResult>> {
  try {
    const classification = await runJob(environment);
    if (!validClassification(
      classification,
      environment.PRIHRASH_R1_RECOVERY_SURFACE_ONLY === '1',
      environment.PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY === '1',
    )) {
      return Object.freeze({
        status: 'FAIL' as const,
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED' as const,
      });
    }
    return Object.freeze({
      status: 'PASS' as const,
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED' as const,
      verdict: classification.verdict,
      reason: classification.reason,
      ...(classification.validatedSourceEvidence === undefined
        ? {}
        : { validatedSourceEvidence: classification.validatedSourceEvidence }),
      ...(classification.staleValidatedRecoveryGate === undefined
        ? {}
        : { staleValidatedRecoveryGate: classification.staleValidatedRecoveryGate }),
      ...(classification.stagingRevisionEvidence === undefined
        ? {}
        : { stagingRevisionEvidence: classification.stagingRevisionEvidence }),
      ...(classification.stagingDurableRevisionEvidence === undefined
        ? {}
        : { stagingDurableRevisionEvidence: classification.stagingDurableRevisionEvidence }),
      ...(classification.stagingRetirementEvidence === undefined
        ? {}
        : { stagingRetirementEvidence: classification.stagingRetirementEvidence }),
      ...(classification.stagingSourceDecodeEvidence === undefined
        ? {}
        : { stagingSourceDecodeEvidence: classification.stagingSourceDecodeEvidence }),
      ...(classification.stagingExactRevisionEvidence === undefined
        ? {}
        : { stagingExactRevisionEvidence: classification.stagingExactRevisionEvidence }),
      ...(classification.stagingControlledPreparationEvidence === undefined
        ? {}
        : { stagingControlledPreparationEvidence: classification.stagingControlledPreparationEvidence }),
      ...(classification.stagingControlledPreparationRetryEvidence === undefined
        ? {}
        : { stagingControlledPreparationRetryEvidence: classification.stagingControlledPreparationRetryEvidence }),
      ...(classification.stagingControlledPreparationQueryErrorEvidence === undefined
        ? {}
        : { stagingControlledPreparationQueryErrorEvidence: classification.stagingControlledPreparationQueryErrorEvidence }),
      ...(classification.stagingControlledPreparationGrpcStatusEvidence === undefined
        ? {}
        : { stagingControlledPreparationGrpcStatusEvidence: classification.stagingControlledPreparationGrpcStatusEvidence }),
      ...(classification.stagingControlledPreparationPhaseEvidence === undefined
        ? {}
        : { stagingControlledPreparationPhaseEvidence: classification.stagingControlledPreparationPhaseEvidence }),
      ...(classification.stagingControlledPreparationReferenceReadStageEvidence === undefined
        ? {}
        : {
            stagingControlledPreparationReferenceReadStageEvidence:
              classification.stagingControlledPreparationReferenceReadStageEvidence,
          }),
      ...(classification.stagingControlledPreparationReconciliationReadStageEvidence === undefined
        ? {}
        : {
            stagingControlledPreparationReconciliationReadStageEvidence:
              classification.stagingControlledPreparationReconciliationReadStageEvidence,
          }),
      ...(classification.stagingControlledPreparationMetadataScanCostEvidence === undefined
        ? {}
        : {
            stagingControlledPreparationMetadataScanCostEvidence:
              classification.stagingControlledPreparationMetadataScanCostEvidence,
          }),
      ...(classification.stagingControlledPreparationReferenceEvidence === undefined
        ? {}
        : {
            stagingControlledPreparationReferenceEvidence:
              classification.stagingControlledPreparationReferenceEvidence,
          }),
      ...(classification.stagingControlledPreparationRevisionPayloadBatchEvidence === undefined
        ? {}
        : {
            stagingControlledPreparationRevisionPayloadBatchEvidence:
              classification.stagingControlledPreparationRevisionPayloadBatchEvidence,
          }),
    });
  } catch (error) {
    if (
      error instanceof InitialBootstrapRecoveryJobError
      && error.code.startsWith('INVALID_')
    ) {
      return Object.freeze({
        status: 'FAIL' as const,
        code: 'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID' as const,
      });
    }
    return Object.freeze({
      status: 'FAIL' as const,
      code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED' as const,
    });
  }
}

export async function initialBootstrapRecoveryHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexInitialBootstrapRecoveryFunctionResult>> {
  return executeYandexInitialBootstrapRecoveryFunction(
    process.env,
    runInitialBootstrapRecoveryJobFromEnvironment,
  );
}
