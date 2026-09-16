const BOOTSTRAP_TAG = 'r1-initial-bootstrap';
const FUNCTIONS_ORIGIN = 'https://functions.yandexcloud.net';
const MAX_CAPTURE_BYTES = 64 * 1024;
const INVOKE_TIMEOUT_MS = 180_000;

const SAFE_CONFIG_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID',
});
const SAFE_INVOKE_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_FAILED',
});
const SAFE_INVOKE_FUNCTION_TIMEOUT = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT',
});
const SAFE_INVOKE_OUTPUT_INVALID = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID',
});

const SAFE_HTTP_STATUS = new Map([
  [400, 'HTTP_400'],
  [403, 'HTTP_403'],
  [404, 'HTTP_404'],
  [413, 'HTTP_413'],
  [429, 'HTTP_429'],
  [500, 'HTTP_500'],
  [502, 'HTTP_502'],
  [503, 'HTTP_503'],
  [504, 'HTTP_504'],
]);

const RECOVERY_REASONS = new Set([
  'CLAIM_OUTCOME_UNKNOWN',
  'REVISION_EVIDENCE_OUTCOME_UNKNOWN',
  'COUNTER_REFINEMENT_OUTCOME_UNKNOWN',
  'VALIDATION_TRANSITION_OUTCOME_UNKNOWN',
  'PROMOTION_OUTCOME_UNKNOWN',
  'VALIDATED_RUN_REQUIRES_RECOVERY',
]);
const VALIDATION_BLOCKER_CODES = new Set([
  'RUN_NOT_STAGING',
  'INITIAL_RUN_COUNTERS_INCONSISTENT',
  'PROJECTION_COUNTERS_INCONSISTENT',
  'RUN_ROW_COUNT_MISMATCH',
  'RUN_AMBIGUOUS_COUNT_MISMATCH',
  'INVALID_ROWS_PRESENT',
  'PROJECTION_FAILURES_PRESENT',
  'TRANSACTION_COVERAGE_MISMATCH',
  'INVALID_RECONCILIATION_EVIDENCE',
  'RECONCILIATION_CHECK_NOT_MATCHED',
  'UNEXPLAINED_HIGH_IMPACT_MISMATCH',
]);
const RECONCILIATION_CHECKS = new Set([
  'SOURCE_RECORD_COUNT',
  'TRANSACTION_COUNTS',
  'TOTALS_BY_TYPE',
  'CATEGORY_AGGREGATES',
  'ACCOUNT_AGGREGATES',
  'CLASSIFICATION_COUNTS',
  'LEGACY_PERIOD_CLOSE_COUNT',
  'INVALID_AMBIGUOUS_MISSING_COUNTS',
]);
const FUNCTION_FAILURE_CODES = new Set([
  'INITIAL_BOOTSTRAP_CONFIG_INVALID',
  'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED',
  'INITIAL_BOOTSTRAP_RESULT_INVALID',
  'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
]);
const REFERENCE_AWARE_RUNTIME_CODES = new Set([
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
]);
const APPLICATION_PHASES = new Set([
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
const METADATA_FAILURE_CODES = new Set([
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

const YDB_QUERY_STATUS_CODES = new Set([
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_BAD_REQUEST',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_UNAUTHORIZED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_INTERNAL_ERROR',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_ABORTED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_UNAVAILABLE',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_OVERLOADED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_SCHEME_ERROR',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_GENERIC_ERROR',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_TIMEOUT',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_BAD_SESSION',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_PRECONDITION_FAILED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_ALREADY_EXISTS',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_NOT_FOUND',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_SESSION_EXPIRED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_CANCELLED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_UNDETERMINED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_UNSUPPORTED',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_SESSION_BUSY',
  'YDB_TRANSPORT_QUERY_EXECUTION_YDB_EXTERNAL_ERROR',
]);

const YDB_DATA_FAILURE_CODES = new Set([
  'YDB_TRANSPORT_SDK_SHAPE_INVALID',
  'YDB_TRANSPORT_PARAMETER_VALUE_INVALID',
  'YDB_TRANSPORT_PARAMETER_TYPE_UNSUPPORTED',
  'YDB_TRANSPORT_TIMESTAMP_PRECISION_UNSUPPORTED',
  'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
  'YDB_TRANSPORT_CLIENT_CONFIG_INVALID',
  'YDB_ADAPTER_WRITE_REQUIRES_TRANSACTION',
  'YDB_COMMIT_OUTCOME_UNKNOWN',
]);

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseValidationBlocker(value) {
  const blocker = record(value);
  if (
    blocker === null
    || typeof blocker.code !== 'string'
    || !VALIDATION_BLOCKER_CODES.has(blocker.code)
  ) {
    return null;
  }
  if (blocker.code === 'RECONCILIATION_CHECK_NOT_MATCHED') {
    if (
      !exactKeys(blocker, ['code', 'check'])
      || typeof blocker.check !== 'string'
      || !RECONCILIATION_CHECKS.has(blocker.check)
    ) {
      return null;
    }
    return Object.freeze({ code: blocker.code, check: blocker.check });
  }
  if (!exactKeys(blocker, ['code'])) return null;
  return Object.freeze({ code: blocker.code });
}

function parseExactFunctionResult(stdout) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const result = record(value);
  if (result === null || typeof result.status !== 'string' || typeof result.code !== 'string') return null;

  if (
    result.status === 'PASS'
    && result.code === 'INITIAL_BOOTSTRAP_COMMITTED'
    && exactKeys(result, ['status', 'code'])
  ) {
    return Object.freeze({ status: 'PASS', code: 'INITIAL_BOOTSTRAP_COMMITTED' });
  }
  if (
    result.status === 'NOOP'
    && result.code === 'INITIAL_BOOTSTRAP_BASELINE_EXISTS'
    && exactKeys(result, ['status', 'code'])
  ) {
    return Object.freeze({ status: 'NOOP', code: 'INITIAL_BOOTSTRAP_BASELINE_EXISTS' });
  }
  if (
    result.status === 'STOP'
    && result.code === 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED'
    && exactKeys(result, ['status', 'code'])
  ) {
    return Object.freeze({ status: 'STOP', code: 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED' });
  }
  if (
    result.status === 'STOP'
    && result.code === 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED'
    && exactKeys(result, ['status', 'code', 'recoveryReason'])
    && typeof result.recoveryReason === 'string'
    && RECOVERY_REASONS.has(result.recoveryReason)
  ) {
    return Object.freeze({
      status: 'STOP',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
      recoveryReason: result.recoveryReason,
    });
  }
  if (
    result.status === 'STOP'
    && result.code === 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED'
    && exactKeys(result, ['status', 'code', 'blockers'])
    && Array.isArray(result.blockers)
    && result.blockers.length > 0
    && result.blockers.length <= 32
  ) {
    const blockers = [];
    for (const entry of result.blockers) {
      const blocker = parseValidationBlocker(entry);
      if (blocker === null) return null;
      blockers.push(blocker);
    }
    return Object.freeze({
      status: 'STOP',
      code: 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED',
      blockers: Object.freeze(blockers),
    });
  }
  if (
    result.status === 'FAIL'
    && result.code === 'INITIAL_BOOTSTRAP_RUNTIME_FAILED'
    && (
      exactKeys(result, ['status', 'code', 'runtimeCode', 'applicationPhase', 'metadataFailureCode'])
      || exactKeys(result, ['status', 'code', 'runtimeCode', 'applicationPhase', 'metadataFailureCode', 'ydbDataFailureCode'])
    )
    && typeof result.runtimeCode === 'string'
    && REFERENCE_AWARE_RUNTIME_CODES.has(result.runtimeCode)
    && (result.applicationPhase === null
      || (typeof result.applicationPhase === 'string' && APPLICATION_PHASES.has(result.applicationPhase)))
    && (result.metadataFailureCode === null
      || (typeof result.metadataFailureCode === 'string' && METADATA_FAILURE_CODES.has(result.metadataFailureCode)))
    && (result.ydbDataFailureCode === undefined
      || (typeof result.ydbDataFailureCode === 'string'
        && (YDB_DATA_FAILURE_CODES.has(result.ydbDataFailureCode)
          || YDB_QUERY_STATUS_CODES.has(result.ydbDataFailureCode))))
  ) {
    return Object.freeze({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: result.runtimeCode,
      applicationPhase: result.applicationPhase,
      metadataFailureCode: result.metadataFailureCode,
      ...(result.ydbDataFailureCode === undefined ? {} : { ydbDataFailureCode: result.ydbDataFailureCode }),
    });
  }
  if (
    result.status === 'FAIL'
    && FUNCTION_FAILURE_CODES.has(result.code)
    && exactKeys(result, ['status', 'code'])
  ) {
    return Object.freeze({ status: 'FAIL', code: result.code });
  }
  return null;
}

function safeHttpStatus(status) {
  const exact = SAFE_HTTP_STATUS.get(status);
  if (exact !== undefined) return exact;
  if (status >= 400 && status < 500) return 'HTTP_4XX_OTHER';
  if (status >= 500 && status < 600) return 'HTTP_5XX_OTHER';
  return 'HTTP_OTHER';
}

function safeHttpFailure(response) {
  return Object.freeze({
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
    httpStatus: safeHttpStatus(response.status),
    functionError: response.headers.get('x-function-error')?.toLowerCase() === 'true'
      ? 'PRESENT'
      : 'ABSENT',
  });
}

async function readLimitedUtf8(response) {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return null;
      total += value.byteLength;
      if (total > MAX_CAPTURE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isTransportTimeout(error) {
  return error !== null
    && (typeof error === 'object' || typeof error === 'function')
    && Reflect.get(error, 'name') === 'TimeoutError';
}
function normalizeQueryStatusDiagnostic(result) {
  if (
    result?.code === 'INITIAL_BOOTSTRAP_RUNTIME_FAILED'
    && typeof result.ydbDataFailureCode === 'string'
    && YDB_QUERY_STATUS_CODES.has(result.ydbDataFailureCode)
  ) {
    const status = result.ydbDataFailureCode.slice('YDB_TRANSPORT_QUERY_EXECUTION_YDB_'.length);
    process.stderr.write(`INITIAL_BOOTSTRAP_YDB_QUERY_STATUS_${status}\n`);
    return Object.freeze({
      ...result,
      ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    });
  }
  return result;
}

async function invokeInitialBootstrap(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID;
  const iamToken = environment.YC_IAM_TOKEN;
  if (!nonBlank(functionId) || !nonBlank(iamToken)) return SAFE_CONFIG_FAILURE;

  const url = new URL(`${FUNCTIONS_ORIGIN}/${encodeURIComponent(functionId)}`);
  url.searchParams.set('tag', BOOTSTRAP_TAG);
  url.searchParams.set('integration', 'raw');

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: Object.freeze({ Authorization: `Bearer ${iamToken}` }),
      signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS),
    });
  } catch (error) {
    return isTransportTimeout(error) ? SAFE_INVOKE_FUNCTION_TIMEOUT : SAFE_INVOKE_FAILURE;
  }

  if (response.status !== 200) {
    if (response.body !== null) await response.body.cancel().catch(() => {});
    return safeHttpFailure(response);
  }

  const body = await readLimitedUtf8(response);
  if (body === null) return SAFE_INVOKE_OUTPUT_INVALID;
  return parseExactFunctionResult(body) ?? SAFE_INVOKE_OUTPUT_INVALID;
}

const result = normalizeQueryStatusDiagnostic(await invokeInitialBootstrap());
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
