const freezeList = (values) => Object.freeze([...values]);

export const R1_DIAGNOSTIC_KINDS = Object.freeze({
  READINESS: 'readiness',
  INITIAL_BOOTSTRAP: 'initial-bootstrap',
  INITIAL_BOOTSTRAP_RECOVERY: 'initial-bootstrap-recovery',
});

export const READINESS_CODES = freezeList([
  'READINESS_READY',
  'READINESS_CONFIG_INVALID',
  'READINESS_INVOKE_FAILED',
  'READINESS_INVOKE_OUTPUT_INVALID',
  'READINESS_INVOKE_NONZERO_UNCLASSIFIED',
  'READINESS_INVOKE_FUNCTION_TIMEOUT',
  'READINESS_INVOKE_MARKER_AMBIGUOUS',
  'READINESS_RUNTIME_CONFIG_INVALID',
  'READINESS_GOOGLE_SPREADSHEET_ID_INVALID',
  'READINESS_GOOGLE_CREDENTIALS_INVALID',
  'READINESS_GOOGLE_TOKEN_ACQUISITION_FAILED',
  'READINESS_GOOGLE_SHEETS_ACCESS_FAILED',
  'READINESS_GOOGLE_SHEETS_RESPONSE_INVALID',
  'READINESS_GOOGLE_SOURCE_METADATA_MISMATCH',
  'READINESS_GOOGLE_SOURCE_SHEET_MISSING',
  'READINESS_GOOGLE_SOURCE_SCHEMA_MISMATCH',
  'READINESS_GOOGLE_SOURCE_VALUE_UNSUPPORTED',
  'READINESS_GOOGLE_SOURCE_READ_FAILED',
  'READINESS_YDB_CLIENT_CREATE_FAILED',
  'READINESS_YDB_QUERY_HEALTH_READ_FAILED',
  'READINESS_YDB_MIGRATION_TABLE_RESOLUTION_FAILED',
  'READINESS_YDB_MIGRATION_TABLE_ACCESS_DENIED',
  'READINESS_YDB_MIGRATION_TABLE_READ_FAILED',
  'READINESS_YDB_MIGRATION_SCHEMA_READ_FAILED',
  'READINESS_YDB_MIGRATION_EVIDENCE_READ_FAILED',
  'READINESS_YDB_ACCOUNTS_SCHEMA_READ_FAILED',
  'READINESS_YDB_CATEGORIES_SCHEMA_READ_FAILED',
  'READINESS_YDB_INITIAL_BOOTSTRAP_IDENTITY_MANIFEST_SCHEMA_READ_FAILED',
  'READINESS_MALFORMED_SCHEMA_MIGRATION_EVIDENCE',
  'READINESS_MISSING_REQUIRED_SCHEMA_MIGRATION',
  'READINESS_UNEXPECTED_SCHEMA_MIGRATION',
  'READINESS_YDB_CLIENT_CLOSE_FAILED',
  'READINESS_RUNTIME_FAILED',
]);

export const READINESS_TRANSPORT_CLASSES = freezeList([
  'EMPTY',
  'AUTH',
  'NOT_FOUND',
  'RATE_LIMIT',
  'DEADLINE',
  'UNAVAILABLE',
  'INVALID_REQUEST',
  'FAILED_PRECONDITION',
  'INTERNAL',
  'OTHER',
]);

export const INITIAL_BOOTSTRAP_CODES = freezeList([
  'INITIAL_BOOTSTRAP_COMMITTED',
  'INITIAL_BOOTSTRAP_BASELINE_EXISTS',
  'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED',
  'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
  'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED',
  'INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID',
  'INITIAL_BOOTSTRAP_INVOKE_FAILED',
  'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
  'INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT',
  'INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID',
  'INITIAL_BOOTSTRAP_CONFIG_INVALID',
  'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED',
  'INITIAL_BOOTSTRAP_RESULT_INVALID',
  'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
]);

export const INITIAL_BOOTSTRAP_RUNTIME_CODES = freezeList([
  'REFERENCE_RUNTIME_STATE_INVALID',
  'REFERENCE_SOURCE_READ_FAILED',
  'REFERENCE_YDB_CLIENT_CREATE_FAILED',
  'REFERENCE_RESOLUTION_FAILED',
  'REFERENCE_ADMISSION_READ_FAILED',
  'REFERENCE_APPLICATION_ADMISSION_EVIDENCE_FAILED',
  'REFERENCE_APPLICATION_SEMANTIC_FAILED',
  'REFERENCE_APPLICATION_METADATA_FAILED',
  'REFERENCE_APPLICATION_YDB_DATA_FAILED',
  'REFERENCE_APPLICATION_RUNTIME_FAILED',
  'REFERENCE_FUNCTION_MODULE_LOAD_FAILED',
  'REFERENCE_FUNCTION_HANDLER_UNCAUGHT',
  'REFERENCE_BOOTSTRAP_RESUME_UNSAFE',
  'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE',
  'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
]);

export const INITIAL_BOOTSTRAP_APPLICATION_PHASES = freezeList([
  'ADMISSION_READ',
  'CURRENT_STATE_PREFLIGHT',
  'FRESH_CONTEXT_PREPARATION',
  'FRESH_METADATA_PREPARATION',
  'FRESH_CLAIM_WRITE',
  'RESUME_CONTEXT_READ',
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
]);

export const INITIAL_BOOTSTRAP_METADATA_FAILURE_CODES = freezeList([
  'METADATA_EXECUTOR_METADATA_WRITE_SET_INVALID',
  'METADATA_EXECUTOR_IDENTITY_MANIFEST_WRITE_INVALID',
  'METADATA_EXECUTOR_IN_FLIGHT_RUN_EXISTS',
  'METADATA_EXECUTOR_COMMITTED_BASELINE_EXISTS',
  'METADATA_EXECUTOR_SNAPSHOT_READBACK_MISMATCH',
  'METADATA_EXECUTOR_RUN_READBACK_MISMATCH',
  'METADATA_EXECUTOR_IDENTITY_MANIFEST_READ_FAILED',
  'METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTEXT_READBACK_MISMATCH',
  'METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTENT_READBACK_MISMATCH',
  'METADATA_EXECUTOR_CLAIM_READBACK_MISMATCH',
  'IDENTITY_MANIFEST_RUN_NOT_STAGING',
  'IDENTITY_MANIFEST_PROJECTION_LENGTH_MISMATCH',
  'IDENTITY_MANIFEST_PROJECTION_IDENTITY_MISMATCH',
  'IDENTITY_MANIFEST_INVALID_PROJECTION_OUTCOME',
  'IDENTITY_MANIFEST_INVALID_TRANSACTION_ASSIGNMENT_UUID',
  'IDENTITY_MANIFEST_DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID',
  'IDENTITY_MANIFEST_DUPLICATE_TRANSACTION_ID',
  'IDENTITY_MANIFEST_MISSING_TRANSACTION_ASSIGNMENT',
  'IDENTITY_MANIFEST_UNEXPECTED_TRANSACTION_ASSIGNMENT',
  'IDENTITY_MANIFEST_MALFORMED_ROW_CARDINALITY',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_VALUE_MISSING',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_VALUE_NULL',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_VALUE_BINARY',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_JSON_STRING_INVALID',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_ROOT_TYPE',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_SCHEMA_VERSION',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_ARRAY',
  'IDENTITY_MANIFEST_MALFORMED_BINDINGS_ROOT_KEYS',
  'IDENTITY_MANIFEST_MALFORMED_BINDING_ENTRY',
  'IDENTITY_MANIFEST_MALFORMED_BINDING_SET',
  'IDENTITY_MANIFEST_MALFORMED_BINDING_COUNT',
  'IDENTITY_MANIFEST_MALFORMED_SNAPSHOT_ROW_COUNT',
  'IDENTITY_MANIFEST_MALFORMED_RUN_STATE',
  'IDENTITY_MANIFEST_MALFORMED_MIGRATION_RUN_ID',
  'IDENTITY_MANIFEST_MALFORMED_SOURCE_SNAPSHOT_ID',
  'IDENTITY_MANIFEST_MALFORMED_SOURCE_SNAPSHOT_DIGEST',
  'IDENTITY_MANIFEST_MALFORMED_RUN_SNAPSHOT_DIGEST',
  'IDENTITY_MANIFEST_MALFORMED_SNAPSHOT_DIGEST',
  'IDENTITY_MANIFEST_MANIFEST_NOT_FOUND',
  'IDENTITY_MANIFEST_MANIFEST_EVIDENCE_MISMATCH',
  'IDENTITY_MANIFEST_INVALID_RESUME_OBSERVATION',
  'IDENTITY_MANIFEST_DUPLICATE_RESUME_ORDINAL',
  'IDENTITY_MANIFEST_RUN_NOT_RESUMABLE',
  'BOOTSTRAP_PERSISTENCE_RUN_NOT_STAGING',
  'BOOTSTRAP_PERSISTENCE_SNAPSHOT_RUN_DIGEST_MISMATCH',
  'BOOTSTRAP_PERSISTENCE_SNAPSHOT_ROW_COUNT_MISMATCH',
  'BOOTSTRAP_PERSISTENCE_RUN_COUNTERS_MISMATCH',
  'YDB_PARAMETER_INVALID_UUID',
  'YDB_PARAMETER_INVALID_DATE',
  'YDB_PARAMETER_INVALID_TIMESTAMP',
  'YDB_PARAMETER_UNSAFE_INTEGER',
  'YDB_PARAMETER_INT64_OUT_OF_RANGE',
  'YDB_PARAMETER_UINT64_OUT_OF_RANGE',
  'YDB_PARAMETER_UINT32_OUT_OF_RANGE',
  'YDB_PARAMETER_INVALID_JSON_DOCUMENT',
]);

export const INITIAL_BOOTSTRAP_YDB_DATA_FAILURE_CODES = freezeList([
  'YDB_TRANSPORT_SDK_SHAPE_INVALID',
  'YDB_TRANSPORT_PARAMETER_VALUE_INVALID',
  'YDB_TRANSPORT_PARAMETER_TYPE_UNSUPPORTED',
  'YDB_TRANSPORT_TIMESTAMP_PRECISION_UNSUPPORTED',
  'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
  'YDB_TRANSPORT_CLIENT_CONFIG_INVALID',
  'YDB_ADAPTER_WRITE_REQUIRES_TRANSACTION',
  'YDB_COMMIT_OUTCOME_UNKNOWN',
]);

export const INITIAL_BOOTSTRAP_HTTP_STATUSES = freezeList([
  'HTTP_400',
  'HTTP_403',
  'HTTP_404',
  'HTTP_413',
  'HTTP_429',
  'HTTP_500',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
  'HTTP_4XX_OTHER',
  'HTTP_5XX_OTHER',
  'HTTP_OTHER',
]);

export const INITIAL_BOOTSTRAP_FUNCTION_ERROR_STATES = freezeList(['PRESENT', 'ABSENT']);

export const INITIAL_BOOTSTRAP_RECOVERY_VERDICTS = freezeList([
  'APPLIED',
  'NOT_APPLIED',
  'RECOVERY_REQUIRED',
]);

export const INITIAL_BOOTSTRAP_RECOVERY_REASONS = freezeList([
  'EMPTY_DURABLE_STATE',
  'COMMITTED_DURABLE_STATE',
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
  'FAILED_RUN_PRESENT',
  'COMMITTED_ROWS_SEEN_MISSING',
  'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID',
  'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID',
  'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH',
  'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH',
]);

const readinessCodeSet = new Set(READINESS_CODES);
const readinessTransportClassSet = new Set(READINESS_TRANSPORT_CLASSES);
const initialBootstrapCodeSet = new Set(INITIAL_BOOTSTRAP_CODES);
const runtimeCodeSet = new Set(INITIAL_BOOTSTRAP_RUNTIME_CODES);
const applicationPhaseSet = new Set(INITIAL_BOOTSTRAP_APPLICATION_PHASES);
const metadataFailureCodeSet = new Set(INITIAL_BOOTSTRAP_METADATA_FAILURE_CODES);
const ydbDataFailureCodeSet = new Set(INITIAL_BOOTSTRAP_YDB_DATA_FAILURE_CODES);
const httpStatusSet = new Set(INITIAL_BOOTSTRAP_HTTP_STATUSES);
const functionErrorSet = new Set(INITIAL_BOOTSTRAP_FUNCTION_ERROR_STATES);
const recoveryVerdictSet = new Set(INITIAL_BOOTSTRAP_RECOVERY_VERDICTS);
const recoveryReasonSet = new Set(INITIAL_BOOTSTRAP_RECOVERY_REASONS);

const READINESS_OUTPUT_SHAPE = /^STDOUT_(EMPTY|TEXT|JSON_OBJECT|JSON_ARRAY|JSON_STRING|JSON_NUMBER|JSON_BOOLEAN|JSON_NULL)__STDERR_(EMPTY|TEXT|JSON_OBJECT|JSON_ARRAY|JSON_STRING|JSON_NUMBER|JSON_BOOLEAN|JSON_NULL)$/;
const INITIAL_BOOTSTRAP_KEYS = freezeList([
  'status',
  'code',
  'runtimeCode',
  'applicationPhase',
  'metadataFailureCode',
  'ydbDataFailureCode',
  'httpStatus',
  'functionError',
]);

function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function nullableMember(value, allowed) {
  return value === null || (typeof value === 'string' && allowed.has(value));
}

function classifyReadiness(value) {
  const diagnostic = record(value);
  if (diagnostic === null || typeof diagnostic.status !== 'string' || typeof diagnostic.code !== 'string') return null;
  if (!readinessCodeSet.has(diagnostic.code)) return null;
  if (diagnostic.code === 'READINESS_READY') {
    if (diagnostic.status !== 'PASS' || !exactKeys(diagnostic, ['status', 'code'])) return null;
    return Object.freeze({ status: diagnostic.status, code: diagnostic.code });
  }
  if (diagnostic.status !== 'FAIL') return null;
  if (diagnostic.code === 'READINESS_INVOKE_NONZERO_UNCLASSIFIED') {
    if (
      !exactKeys(diagnostic, ['status', 'code', 'outputShape', 'transportClass'])
      || typeof diagnostic.outputShape !== 'string'
      || !READINESS_OUTPUT_SHAPE.test(diagnostic.outputShape)
      || typeof diagnostic.transportClass !== 'string'
      || !readinessTransportClassSet.has(diagnostic.transportClass)
    ) return null;
    return Object.freeze({
      status: diagnostic.status,
      code: diagnostic.code,
      outputShape: diagnostic.outputShape,
      transportClass: diagnostic.transportClass,
    });
  }
  if (!exactKeys(diagnostic, ['status', 'code'])) return null;
  return Object.freeze({ status: diagnostic.status, code: diagnostic.code });
}

function validInitialBootstrapStatusCode(status, code) {
  if (!initialBootstrapCodeSet.has(code)) return false;
  if (status === 'PASS') return code === 'INITIAL_BOOTSTRAP_COMMITTED';
  if (status === 'NOOP') return code === 'INITIAL_BOOTSTRAP_BASELINE_EXISTS';
  if (status === 'STOP') {
    return code === 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED'
      || code === 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED'
      || code === 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED';
  }
  if (status !== 'FAIL') return false;
  return ![
    'INITIAL_BOOTSTRAP_COMMITTED',
    'INITIAL_BOOTSTRAP_BASELINE_EXISTS',
    'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED',
    'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
    'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED',
  ].includes(code);
}

function classifyInitialBootstrap(value) {
  const diagnostic = record(value);
  if (
    diagnostic === null
    || !exactKeys(diagnostic, INITIAL_BOOTSTRAP_KEYS)
    || typeof diagnostic.status !== 'string'
    || typeof diagnostic.code !== 'string'
    || !validInitialBootstrapStatusCode(diagnostic.status, diagnostic.code)
  ) return null;

  const runtimeFailure = diagnostic.code === 'INITIAL_BOOTSTRAP_RUNTIME_FAILED';
  if (runtimeFailure) {
    if (
      typeof diagnostic.runtimeCode !== 'string'
      || !runtimeCodeSet.has(diagnostic.runtimeCode)
      || !nullableMember(diagnostic.applicationPhase, applicationPhaseSet)
      || !nullableMember(diagnostic.metadataFailureCode, metadataFailureCodeSet)
      || !nullableMember(diagnostic.ydbDataFailureCode, ydbDataFailureCodeSet)
    ) return null;
  } else if (
    diagnostic.runtimeCode !== null
    || diagnostic.applicationPhase !== null
    || diagnostic.metadataFailureCode !== null
    || diagnostic.ydbDataFailureCode !== null
  ) return null;

  const httpFailure = diagnostic.code === 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED';
  if (httpFailure) {
    if (
      typeof diagnostic.httpStatus !== 'string'
      || !httpStatusSet.has(diagnostic.httpStatus)
      || typeof diagnostic.functionError !== 'string'
      || !functionErrorSet.has(diagnostic.functionError)
    ) return null;
  } else if (diagnostic.httpStatus !== null || diagnostic.functionError !== null) return null;

  return Object.freeze(Object.fromEntries(INITIAL_BOOTSTRAP_KEYS.map((key) => [key, diagnostic[key]])));
}

function validRecoveryPair(verdict, reason) {
  if (verdict === 'APPLIED') return reason === 'COMMITTED_DURABLE_STATE';
  if (verdict === 'NOT_APPLIED') return reason === 'EMPTY_DURABLE_STATE';
  return verdict === 'RECOVERY_REQUIRED'
    && reason !== 'COMMITTED_DURABLE_STATE'
    && reason !== 'EMPTY_DURABLE_STATE';
}

function classifyInitialBootstrapRecovery(value) {
  const diagnostic = record(value);
  if (
    diagnostic === null
    || !exactKeys(diagnostic, ['status', 'code', 'verdict', 'reason'])
    || diagnostic.status !== 'PASS'
    || diagnostic.code !== 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED'
    || typeof diagnostic.verdict !== 'string'
    || !recoveryVerdictSet.has(diagnostic.verdict)
    || typeof diagnostic.reason !== 'string'
    || !recoveryReasonSet.has(diagnostic.reason)
    || !validRecoveryPair(diagnostic.verdict, diagnostic.reason)
  ) return null;
  return Object.freeze({
    status: diagnostic.status,
    code: diagnostic.code,
    verdict: diagnostic.verdict,
    reason: diagnostic.reason,
  });
}

export const R1_DIAGNOSTIC_CONTRACT = Object.freeze({
  version: 1,
  kinds: R1_DIAGNOSTIC_KINDS,
  readiness: Object.freeze({
    codes: READINESS_CODES,
    transportClasses: READINESS_TRANSPORT_CLASSES,
  }),
  initialBootstrap: Object.freeze({
    codes: INITIAL_BOOTSTRAP_CODES,
    runtimeCodes: INITIAL_BOOTSTRAP_RUNTIME_CODES,
    applicationPhases: INITIAL_BOOTSTRAP_APPLICATION_PHASES,
    metadataFailureCodes: INITIAL_BOOTSTRAP_METADATA_FAILURE_CODES,
    ydbDataFailureCodes: INITIAL_BOOTSTRAP_YDB_DATA_FAILURE_CODES,
    httpStatuses: INITIAL_BOOTSTRAP_HTTP_STATUSES,
    functionErrorStates: INITIAL_BOOTSTRAP_FUNCTION_ERROR_STATES,
  }),
  initialBootstrapRecovery: Object.freeze({
    verdicts: INITIAL_BOOTSTRAP_RECOVERY_VERDICTS,
    reasons: INITIAL_BOOTSTRAP_RECOVERY_REASONS,
  }),
});

export function classifyR1Diagnostic(kind, value) {
  if (kind === R1_DIAGNOSTIC_KINDS.READINESS) return classifyReadiness(value);
  if (kind === R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP) return classifyInitialBootstrap(value);
  if (kind === R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP_RECOVERY) return classifyInitialBootstrapRecovery(value);
  return null;
}
