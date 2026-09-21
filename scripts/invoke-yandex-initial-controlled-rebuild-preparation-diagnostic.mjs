const DIAGNOSTIC_TAG = 'r1-initial-controlled-rebuild-preparation-diagnostic';
const FUNCTIONS_ORIGIN = 'https://functions.yandexcloud.net';
const MAX_CAPTURE_BYTES = 64 * 1024;
const INVOKE_TIMEOUT_MS = 630_000;

const PREPARATION_BOOTSTRAP_PHASES = new Set([
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
const YDB_TRANSPORT_ERROR_CODES = new Set([
  'SDK_SHAPE_INVALID',
  'PARAMETER_VALUE_INVALID',
  'PARAMETER_TYPE_UNSUPPORTED',
  'TIMESTAMP_PRECISION_UNSUPPORTED',
  'QUERY_EXECUTION_FAILED',
  'QUERY_EXECUTION_YDB_BAD_REQUEST',
  'QUERY_EXECUTION_YDB_UNAUTHORIZED',
  'QUERY_EXECUTION_YDB_INTERNAL_ERROR',
  'QUERY_EXECUTION_YDB_ABORTED',
  'QUERY_EXECUTION_YDB_UNAVAILABLE',
  'QUERY_EXECUTION_YDB_OVERLOADED',
  'QUERY_EXECUTION_YDB_SCHEME_ERROR',
  'QUERY_EXECUTION_YDB_GENERIC_ERROR',
  'QUERY_EXECUTION_YDB_TIMEOUT',
  'QUERY_EXECUTION_YDB_BAD_SESSION',
  'QUERY_EXECUTION_YDB_PRECONDITION_FAILED',
  'QUERY_EXECUTION_YDB_ALREADY_EXISTS',
  'QUERY_EXECUTION_YDB_NOT_FOUND',
  'QUERY_EXECUTION_YDB_SESSION_EXPIRED',
  'QUERY_EXECUTION_YDB_CANCELLED',
  'QUERY_EXECUTION_YDB_UNDETERMINED',
  'QUERY_EXECUTION_YDB_UNSUPPORTED',
  'QUERY_EXECUTION_YDB_SESSION_BUSY',
  'QUERY_EXECUTION_YDB_EXTERNAL_ERROR',
  'CLIENT_CONFIG_INVALID',
]);
const DURABLE_RECONCILIATION_ERROR_CODES = new Set([
  'DURABLE_REVISION_EVIDENCE_INCOMPLETE',
  'DURABLE_RAW_PAYLOAD_INVALID',
  'EXPECTED_RECONCILIATION_NOT_AVAILABLE',
  'INVALID_EXPECTED_REVISION',
  'MIXED_EXPECTED_RUN',
  'MALFORMED_EXISTING_REVISION',
  'DUPLICATE_EXISTING_REVISION',
  'EXTRA_EXISTING_REVISION',
  'EXISTING_REVISION_MISMATCH',
  'UNSUPPORTED_TRANSACTION_TYPE',
  'INVALID_TRANSACTION_SHAPE',
  'INVALID_TRANSACTION_AMOUNT',
  'INVALID_SOURCE_CLASSIFICATION',
]);
const RUNTIME_JOB_CODES = new Set([
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
const SAFE_HTTP_STATUS = new Map([
  [400, 'HTTP_400'], [403, 'HTTP_403'], [404, 'HTTP_404'], [413, 'HTTP_413'], [429, 'HTTP_429'],
  [500, 'HTTP_500'], [502, 'HTTP_502'], [503, 'HTTP_503'], [504, 'HTTP_504'],
]);

const SAFE_CONFIG_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_INVOKER_CONFIG_INVALID',
});
const SAFE_INVOKE_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_INVOKE_FAILED',
});
const SAFE_INVOKE_TIMEOUT = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_INVOKE_TIMEOUT',
});
const SAFE_OUTPUT_INVALID = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_OUTPUT_INVALID',
});

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function validBootstrapPhase(value) {
  return value === null || (typeof value === 'string' && PREPARATION_BOOTSTRAP_PHASES.has(value));
}
function validPreparationFailure(result) {
  if (
    result.status !== 'FAIL'
    || result.code !== 'INITIAL_CONTROLLED_REBUILD_PREPARATION_FAILED'
    || !exactKeys(result, ['status', 'code', 'category', 'errorCode', 'bootstrapPhase'])
    || !validBootstrapPhase(result.bootstrapPhase)
  ) return false;
  if (result.category === 'YDB_TRANSPORT') {
    return typeof result.errorCode === 'string' && YDB_TRANSPORT_ERROR_CODES.has(result.errorCode);
  }
  if (result.category === 'DURABLE_RECONCILIATION') {
    return typeof result.errorCode === 'string' && DURABLE_RECONCILIATION_ERROR_CODES.has(result.errorCode);
  }
  return result.category === 'UNKNOWN' && result.errorCode === null;
}
function validRuntimeFailure(result) {
  if (
    result.status !== 'FAIL'
    || result.code !== 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED'
    || typeof result.jobCode !== 'string'
    || !RUNTIME_JOB_CODES.has(result.jobCode)
    || (result.phase !== null && result.phase !== 'PREPARATION')
  ) return false;
  if (
    exactKeys(result, ['status', 'code', 'jobCode', 'phase'])
    && (result.jobCode === 'MODULE_LOAD_FAILED' || result.jobCode === 'HANDLER_UNCAUGHT')
  ) return result.phase === null;
  return exactKeys(result, ['status', 'code', 'jobCode', 'phase', 'bootstrapPhase'])
    && validBootstrapPhase(result.bootstrapPhase);
}
function parseExactFunctionResult(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout.trim()); } catch { return null; }
  const result = record(parsed);
  if (result === null || typeof result.status !== 'string' || typeof result.code !== 'string') return null;
  if (
    result.status === 'PASS'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_READY'
    && exactKeys(result, ['status', 'code'])
  ) return Object.freeze({ status: result.status, code: result.code });
  if (
    result.status === 'NOOP'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS'
    && exactKeys(result, ['status', 'code'])
  ) return Object.freeze({ status: result.status, code: result.code });
  if (
    result.status === 'STOP'
    && result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_VALIDATION_BLOCKED'
    && exactKeys(result, ['status', 'code'])
  ) return Object.freeze({ status: result.status, code: result.code });
  if (validPreparationFailure(result) || validRuntimeFailure(result)) {
    return Object.freeze({ ...result });
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
      if (size > MAX_CAPTURE_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
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
function isTimeout(error) {
  return error !== null && typeof error === 'object' && Reflect.get(error, 'name') === 'TimeoutError';
}
function safeHttpFailure(response) {
  return Object.freeze({
    status: 'FAIL',
    code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_HTTP_FAILED',
    httpStatus: SAFE_HTTP_STATUS.get(response.status) ?? 'HTTP_OTHER',
    functionError: response.headers.has('x-function-error') ? 'PRESENT' : 'ABSENT',
  });
}

async function invoke(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_CONTROLLED_REBUILD_FUNCTION_ID;
  const iamToken = environment.YC_IAM_TOKEN;
  if (!nonBlank(functionId) || !nonBlank(iamToken)) return SAFE_CONFIG_FAILURE;

  const url = new URL(`${FUNCTIONS_ORIGIN}/${encodeURIComponent(functionId)}`);
  url.searchParams.set('tag', DIAGNOSTIC_TAG);
  url.searchParams.set('integration', 'raw');

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: Object.freeze({ Authorization: `Bearer ${iamToken}` }),
      signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS),
    });
  } catch (error) {
    return isTimeout(error) ? SAFE_INVOKE_TIMEOUT : SAFE_INVOKE_FAILURE;
  }

  if (response.status !== 200) {
    if (response.body !== null) await response.body.cancel().catch(() => {});
    return safeHttpFailure(response);
  }
  const body = await readLimitedUtf8(response);
  return body === null ? SAFE_OUTPUT_INVALID : (parseExactFunctionResult(body) ?? SAFE_OUTPUT_INVALID);
}

const result = await invoke();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (
  result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_INVOKER_CONFIG_INVALID'
  || result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_INVOKE_FAILED'
  || result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_INVOKE_TIMEOUT'
  || result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_OUTPUT_INVALID'
  || result.code === 'INITIAL_CONTROLLED_REBUILD_PREPARATION_DIAGNOSTIC_HTTP_FAILED'
) process.exitCode = 2;
