const BOOTSTRAP_TAG = 'r1-initial-bootstrap';
const FUNCTIONS_ORIGIN = 'https://functions.yandexcloud.net';
const MAX_CAPTURE_BYTES = 64 * 1024;
const INVOKE_TIMEOUT_MS = 180_000;

const SAFE_CONFIG_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID',
});
const SAFE_INVOKE_TRANSPORT_FAILED = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_TRANSPORT_FAILED',
});
const SAFE_INVOKE_TRANSPORT_TIMEOUT = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_TRANSPORT_TIMEOUT',
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
  'REFERENCE_BOOTSTRAP_RESUME_UNSAFE',
  'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE',
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
    && exactKeys(result, ['status', 'code', 'runtimeCode'])
    && typeof result.runtimeCode === 'string'
    && REFERENCE_AWARE_RUNTIME_CODES.has(result.runtimeCode)
  ) {
    return Object.freeze({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: result.runtimeCode,
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
    return isTransportTimeout(error) ? SAFE_INVOKE_TRANSPORT_TIMEOUT : SAFE_INVOKE_TRANSPORT_FAILED;
  }

  if (response.status !== 200) {
    if (response.body !== null) await response.body.cancel().catch(() => {});
    return safeHttpFailure(response);
  }

  const body = await readLimitedUtf8(response);
  if (body === null) return SAFE_INVOKE_OUTPUT_INVALID;
  return parseExactFunctionResult(body) ?? SAFE_INVOKE_OUTPUT_INVALID;
}

const result = await invokeInitialBootstrap();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
