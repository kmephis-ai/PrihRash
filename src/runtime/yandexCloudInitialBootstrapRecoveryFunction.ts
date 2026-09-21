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
  if (value.reason === 'STAGING_RUN_PRESENT' && surfaceOnly) {
    if (diagnostic !== undefined || durableDiagnostic !== undefined || retirementDiagnostic !== undefined
      || sourceDecodeDiagnostic !== undefined || exactRevisionDiagnostic !== undefined
      || controlledPreparationDiagnostic !== undefined) return false;
  } else if (value.reason === 'STAGING_RUN_PRESENT' && controlledPreparationOnly) {
    if (
      diagnostic !== undefined
      || durableDiagnostic !== undefined
      || retirementDiagnostic !== undefined
      || sourceDecodeDiagnostic !== undefined
      || exactRevisionDiagnostic !== undefined
      || controlledPreparationDiagnostic === undefined
      || !STAGING_CONTROLLED_PREPARATION_EVIDENCE.has(controlledPreparationDiagnostic)
    ) return false;
  } else if (value.reason === 'STAGING_RUN_PRESENT') {
    if (diagnostic === undefined || !STAGING_REVISION_EVIDENCE.has(diagnostic)) return false;
    if (durableDiagnostic === undefined || !STAGING_DURABLE_REVISION_EVIDENCE.has(durableDiagnostic)) return false;
    if (retirementDiagnostic === undefined || !STAGING_RETIREMENT_EVIDENCE.has(retirementDiagnostic)) return false;
    if (sourceDecodeDiagnostic === undefined || !validSourceDecodeEvidence(sourceDecodeDiagnostic)) return false;
    if (exactRevisionDiagnostic === undefined || !STAGING_EXACT_REVISION_EVIDENCE.has(exactRevisionDiagnostic)) return false;
    if (controlledPreparationDiagnostic !== undefined) return false;
  } else if (
    diagnostic !== undefined
    || durableDiagnostic !== undefined
    || retirementDiagnostic !== undefined
    || sourceDecodeDiagnostic !== undefined
    || exactRevisionDiagnostic !== undefined
    || controlledPreparationDiagnostic !== undefined
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
