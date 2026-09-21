const CONTROLLED_REBUILD_TAG = 'r1-initial-controlled-rebuild';
const PREPARATION_DIAGNOSTIC_TAG = 'r1-initial-controlled-rebuild-preparation-diagnostic';
const ALLOWED_TAGS = new Set([CONTROLLED_REBUILD_TAG, PREPARATION_DIAGNOSTIC_TAG]);
const FUNCTIONS_ORIGIN = 'https://functions.yandexcloud.net';
const MAX_CAPTURE_BYTES = 64 * 1024;
const INVOKE_TIMEOUT_MS = 630_000;
const ASYNC_ACCEPT_TIMEOUT_MS = 60_000;

const RECOVERY_REASONS = new Set([
  'VALIDATION_TRANSITION_OUTCOME_UNKNOWN',
  'SETUP_STATE_AMBIGUOUS',
  'SETUP_OUTCOME_NOT_APPLIED',
  'SETUP_OUTCOME_AMBIGUOUS',
  'STAGING_MATERIALIZATION_INCOMPLETE',
  'SWAP_OUTCOME_NOT_APPLIED',
  'SWAP_OUTCOME_AMBIGUOUS',
  'COMMIT_MARKER_PENDING',
  'COMMIT_MARKER_OUTCOME_AMBIGUOUS',
  'POST_SWAP_VERIFICATION_MISMATCH',
  'POST_COMMIT_VERIFICATION_MISMATCH',
]);
const PHASES = new Set([
  'PREPARATION',
  'VALIDATION_TRANSITION',
  'SETUP_EVIDENCE',
  'SETUP_MUTATION',
  'STAGING_MATERIALIZATION',
  'STAGING_RECONCILIATION',
  'SWAP_DISCRIMINATION',
  'SWAP_MUTATION',
  'POST_SWAP_VERIFICATION',
  'COMMIT_MARKER',
  'POST_COMMIT_VERIFICATION',
]);
const BOOTSTRAP_PHASES = new Set([
  'ADMISSION_READ',
  'RESUME_CONTEXT_READ',
  'RESUME_IDENTITY_MANIFEST_READ',
  'RESUME_SNAPSHOT_READ',
  'RESUME_CONTEXT_PREPARATION',
  'LINEAGE_PREPARATION',
  'RECONCILIATION_READ',
  'VALIDATION_EVALUATION',
  'CURRENT_PLAN_PREPARATION',
  'CURRENT_WRITE_PREPARATION',
]);
const PREPARATION_FAILURE_CODES = new Set([
  'YDB_SDK_SHAPE_INVALID',
  'YDB_PARAMETER_VALUE_INVALID',
  'YDB_PARAMETER_TYPE_UNSUPPORTED',
  'YDB_TIMESTAMP_PRECISION_UNSUPPORTED',
  'YDB_QUERY_EXECUTION_FAILED',
  'YDB_QUERY_EXECUTION_YDB_BAD_REQUEST',
  'YDB_QUERY_EXECUTION_YDB_UNAUTHORIZED',
  'YDB_QUERY_EXECUTION_YDB_INTERNAL_ERROR',
  'YDB_QUERY_EXECUTION_YDB_ABORTED',
  'YDB_QUERY_EXECUTION_YDB_UNAVAILABLE',
  'YDB_QUERY_EXECUTION_YDB_OVERLOADED',
  'YDB_QUERY_EXECUTION_YDB_SCHEME_ERROR',
  'YDB_QUERY_EXECUTION_YDB_GENERIC_ERROR',
  'YDB_QUERY_EXECUTION_YDB_TIMEOUT',
  'YDB_QUERY_EXECUTION_YDB_BAD_SESSION',
  'YDB_QUERY_EXECUTION_YDB_PRECONDITION_FAILED',
  'YDB_QUERY_EXECUTION_YDB_ALREADY_EXISTS',
  'YDB_QUERY_EXECUTION_YDB_NOT_FOUND',
  'YDB_QUERY_EXECUTION_YDB_SESSION_EXPIRED',
  'YDB_QUERY_EXECUTION_YDB_CANCELLED',
  'YDB_QUERY_EXECUTION_YDB_UNDETERMINED',
  'YDB_QUERY_EXECUTION_YDB_UNSUPPORTED',
  'YDB_QUERY_EXECUTION_YDB_SESSION_BUSY',
  'YDB_QUERY_EXECUTION_YDB_EXTERNAL_ERROR',
  'YDB_CLIENT_CONFIG_INVALID',
  'DURABLE_RECONCILIATION_DURABLE_REVISION_EVIDENCE_INCOMPLETE',
  'DURABLE_RECONCILIATION_DURABLE_RAW_PAYLOAD_INVALID',
  'DURABLE_RECONCILIATION_EXPECTED_RECONCILIATION_NOT_AVAILABLE',
  'REVISION_EVIDENCE_INVALID_EXPECTED_REVISION',
  'REVISION_EVIDENCE_MIXED_EXPECTED_RUN',
  'REVISION_EVIDENCE_MALFORMED_EXISTING_REVISION',
  'REVISION_EVIDENCE_DUPLICATE_EXISTING_REVISION',
  'REVISION_EVIDENCE_EXTRA_EXISTING_REVISION',
  'REVISION_EVIDENCE_EXISTING_REVISION_MISMATCH',
  'CONTROLLED_RECONCILIATION_UNSUPPORTED_TRANSACTION_TYPE',
  'CONTROLLED_RECONCILIATION_INVALID_TRANSACTION_SHAPE',
  'CONTROLLED_RECONCILIATION_INVALID_TRANSACTION_AMOUNT',
  'CONTROLLED_RECONCILIATION_INVALID_SOURCE_CLASSIFICATION',
  'PROJECTION_INVALID_SOURCE_ORDINAL',
  'PROJECTION_DUPLICATE_SOURCE_ORDINAL',
  'PROJECTION_DUPLICATE_SOURCE_RECORD_ID',
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
  'UNKNOWN',
]);
const JOB_CODES = new Set([
  'SOURCE_READ_FAILED',
  'YDB_CLIENT_CREATE_FAILED',
  'SCHEME_CLIENT_CREATE_FAILED',
  'REFERENCE_READ_FAILED',
  'APPLICATION_FAILED',
  'POST_COMMIT_RECONCILIATION_MISMATCH',
  'YDB_CLIENT_CLOSE_FAILED',
  'CONFIG_INVALID',
  'UNCAUGHT',
  'MODULE_LOAD_FAILED',
  'HANDLER_UNCAUGHT',
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
const SAFE_HTTP_STATUS = new Map([
  [400, 'HTTP_400'], [403, 'HTTP_403'], [404, 'HTTP_404'], [413, 'HTTP_413'], [429, 'HTTP_429'],
  [500, 'HTTP_500'], [502, 'HTTP_502'], [503, 'HTTP_503'], [504, 'HTTP_504'],
]);

const SAFE_CONFIG_FAILURE = Object.freeze({ status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKER_CONFIG_INVALID' });
const SAFE_INVOKE_FAILURE = Object.freeze({ status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKE_FAILED' });
const SAFE_INVOKE_TIMEOUT = Object.freeze({ status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKE_FUNCTION_TIMEOUT' });
const SAFE_OUTPUT_INVALID = Object.freeze({ status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKE_OUTPUT_INVALID' });
const SAFE_ASYNC_ACCEPTED = Object.freeze({ status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_ASYNC_ACCEPTED' });

function nonBlank(value) { return typeof value === 'string' && value.length > 0 && value === value.trim(); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function validationBlocker(value) {
  const item = record(value);
  if (item === null || typeof item.code !== 'string' || !VALIDATION_BLOCKER_CODES.has(item.code)) return null;
  if (item.code === 'RECONCILIATION_CHECK_NOT_MATCHED') {
    if (!exactKeys(item, ['code', 'check']) || typeof item.check !== 'string' || !RECONCILIATION_CHECKS.has(item.check)) return null;
    return Object.freeze({ code: item.code, check: item.check });
  }
  return exactKeys(item, ['code']) ? Object.freeze({ code: item.code }) : null;
}
function parseExactFunctionResult(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout.trim()); } catch { return null; }
  const result = record(parsed);
  if (result === null || typeof result.status !== 'string' || typeof result.code !== 'string') return null;
  if (result.status === 'PASS' && result.code === 'INITIAL_CONTROLLED_REBUILD_COMMITTED' && exactKeys(result, ['status', 'code'])) {
    return Object.freeze({ status: result.status, code: result.code });
  }
  if (result.status === 'PASS' && result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_READY' && exactKeys(result, ['status', 'code'])) {
    return Object.freeze({ status: result.status, code: result.code });
  }
  if (result.status === 'NOOP' && result.code === 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' && exactKeys(result, ['status', 'code'])) {
    return Object.freeze({ status: result.status, code: result.code });
  }
  if (
    result.status === 'STOP'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED'
    && exactKeys(result, ['status', 'code', 'recoveryReason'])
    && typeof result.recoveryReason === 'string'
    && RECOVERY_REASONS.has(result.recoveryReason)
  ) return Object.freeze({ status: result.status, code: result.code, recoveryReason: result.recoveryReason });
  if (
    result.status === 'STOP'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED'
    && exactKeys(result, ['status', 'code', 'blockers'])
    && Array.isArray(result.blockers)
    && result.blockers.length > 0
    && result.blockers.length <= 32
  ) {
    const blockers = result.blockers.map(validationBlocker);
    if (blockers.some((value) => value === null)) return null;
    return Object.freeze({ status: result.status, code: result.code, blockers: Object.freeze(blockers) });
  }
  if (
    result.status === 'FAIL'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_FAILED'
    && exactKeys(result, ['status', 'code', 'bootstrapPhase', 'failureCode'])
    && (result.bootstrapPhase === null || (typeof result.bootstrapPhase === 'string' && BOOTSTRAP_PHASES.has(result.bootstrapPhase)))
    && typeof result.failureCode === 'string'
    && PREPARATION_FAILURE_CODES.has(result.failureCode)
  ) {
    return Object.freeze({
      status: result.status,
      code: result.code,
      bootstrapPhase: result.bootstrapPhase,
      failureCode: result.failureCode,
    });
  }
  if (
    result.status === 'FAIL'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED'
    && typeof result.jobCode === 'string'
    && JOB_CODES.has(result.jobCode)
    && (result.phase === null || (typeof result.phase === 'string' && PHASES.has(result.phase)))
  ) {
    if (
      exactKeys(result, ['status', 'code', 'jobCode', 'phase'])
      && (result.jobCode === 'MODULE_LOAD_FAILED' || result.jobCode === 'HANDLER_UNCAUGHT')
      && result.phase === null
    ) {
      return Object.freeze({ status: result.status, code: result.code, jobCode: result.jobCode, phase: result.phase });
    }
    if (
      exactKeys(result, ['status', 'code', 'jobCode', 'phase', 'bootstrapPhase'])
      && (
        result.bootstrapPhase === null
        || (
          result.jobCode === 'APPLICATION_FAILED'
          && result.phase === 'PREPARATION'
          && typeof result.bootstrapPhase === 'string'
          && BOOTSTRAP_PHASES.has(result.bootstrapPhase)
        )
      )
    ) {
      return Object.freeze({
        status: result.status,
        code: result.code,
        jobCode: result.jobCode,
        phase: result.phase,
        bootstrapPhase: result.bootstrapPhase,
      });
    }
  }
  return null;
}

async function readLimitedUtf8(response) {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CAPTURE_BYTES) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}
function isTimeout(error) { return error !== null && typeof error === 'object' && Reflect.get(error, 'name') === 'TimeoutError'; }
function safeHttpFailure(response, includeFunctionError = false) {
  const result = {
    status: 'FAIL',
    code: 'INITIAL_CONTROLLED_REBUILD_HTTP_FAILED',
    httpStatus: SAFE_HTTP_STATUS.get(response.status) ?? 'HTTP_OTHER',
  };
  if (includeFunctionError) {
    result.functionError = response.headers.has('x-function-error') ? 'PRESENT' : 'ABSENT';
  }
  return Object.freeze(result);
}

async function invoke(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_CONTROLLED_REBUILD_FUNCTION_ID;
  const iamToken = environment.YC_IAM_TOKEN;
  const mode = environment.PRIHRASH_INITIAL_CONTROLLED_REBUILD_INVOKE_MODE ?? 'sync';
  const tag = environment.PRIHRASH_INITIAL_CONTROLLED_REBUILD_TAG ?? CONTROLLED_REBUILD_TAG;
  if (
    !nonBlank(functionId)
    || !nonBlank(iamToken)
    || (mode !== 'sync' && mode !== 'async')
    || !ALLOWED_TAGS.has(tag)
  ) return SAFE_CONFIG_FAILURE;

  const url = new URL(`${FUNCTIONS_ORIGIN}/${encodeURIComponent(functionId)}`);
  url.searchParams.set('tag', tag);
  url.searchParams.set('integration', mode === 'async' ? 'async' : 'raw');
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: Object.freeze({ Authorization: `Bearer ${iamToken}` }),
      signal: AbortSignal.timeout(mode === 'async' ? ASYNC_ACCEPT_TIMEOUT_MS : INVOKE_TIMEOUT_MS),
    });
  } catch (error) {
    return isTimeout(error) ? SAFE_INVOKE_TIMEOUT : SAFE_INVOKE_FAILURE;
  }

  if (mode === 'async') {
    if (response.body !== null) await response.body.cancel().catch(() => {});
    return response.status === 202 ? SAFE_ASYNC_ACCEPTED : safeHttpFailure(response);
  }

  if (response.status !== 200) {
    if (response.body !== null) await response.body.cancel().catch(() => {});
    return safeHttpFailure(response, true);
  }
  const body = await readLimitedUtf8(response);
  return body === null ? SAFE_OUTPUT_INVALID : (parseExactFunctionResult(body) ?? SAFE_OUTPUT_INVALID);
}

const result = await invoke();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
