import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BOOTSTRAP_TAG = 'r1-initial-bootstrap';
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
const SAFE_INVOKE_NONZERO_UNCLASSIFIED = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED',
});
const SAFE_INVOKE_FUNCTION_TIMEOUT = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT',
});
const YANDEX_FUNCTION_TIMEOUT_MARKER = 'Function execution timeout (504)';
const SAFE_INVOKE_OUTPUT_INVALID = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID',
});

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
  'METADATA_EXECUTOR_IDENTITY_MANIFEST_READBACK_MISMATCH',
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
  'IDENTITY_MANIFEST_MALFORMED_MANIFEST_ROW',
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

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function safeChildEnvironment(environment) {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME',
    'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'YC_IAM_TOKEN',
  ];
  return Object.fromEntries(
    allowed.filter((name) => nonBlank(environment[name])).map((name) => [name, environment[name]]),
  );
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
    && exactKeys(result, ['status', 'code', 'runtimeCode', 'applicationPhase', 'metadataFailureCode'])
    && typeof result.runtimeCode === 'string'
    && REFERENCE_AWARE_RUNTIME_CODES.has(result.runtimeCode)
    && (result.applicationPhase === null
      || (typeof result.applicationPhase === 'string' && APPLICATION_PHASES.has(result.applicationPhase)))
    && (result.metadataFailureCode === null
      || (typeof result.metadataFailureCode === 'string' && METADATA_FAILURE_CODES.has(result.metadataFailureCode)))
  ) {
    return Object.freeze({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: result.runtimeCode,
      applicationPhase: result.applicationPhase,
      metadataFailureCode: result.metadataFailureCode,
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

function parseUniqueExactNonPassFunctionResultFromLines(value) {
  const matches = [];
  for (const line of value.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const result = parseExactFunctionResult(line);
    if (result !== null && result.status !== 'PASS') matches.push(result);
  }
  return matches.length === 1 ? matches[0] : null;
}

function capturedErrorField(error, field) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return '';
  const value = Reflect.get(error, field);
  return typeof value === 'string' ? value : '';
}

function safeCapturedShape(value) {
  if (value.length === 0) return 'EMPTY';
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'TEXT';

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return 'TEXT';
  }

  if (parsed === null) return 'JSON_NULL';
  if (Array.isArray(parsed)) return 'JSON_ARRAY';
  if (typeof parsed === 'object') return 'JSON_OBJECT';
  if (typeof parsed === 'string') return 'JSON_STRING';
  if (typeof parsed === 'number') return 'JSON_NUMBER';
  if (typeof parsed === 'boolean') return 'JSON_BOOLEAN';
  return 'TEXT';
}

function safeTransportClass(stderr) {
  if (stderr.length === 0) return 'EMPTY';
  const normalized = stderr.toLowerCase();
  const rules = [
    [/(permission(?:[_ ]?denied)|unauthenticated|unauthorized|authentication failed|access denied)/, 'AUTH'],
    [/(not(?:[_ ]?found)|does not exist)/, 'NOT_FOUND'],
    [/(resource(?:[_ ]?exhausted)|too many requests|rate limit|\b429\b)/, 'RATE_LIMIT'],
    [/(deadline(?:[_ ]?exceeded)|context deadline|timed out|timeout|\b504\b)/, 'DEADLINE'],
    [/(unavailable|service unavailable|connection refused|connection reset|network is unreachable|temporary failure|\b503\b)/, 'UNAVAILABLE'],
    [/(invalid(?:[_ ]?argument)|unknown flag|usage:)/, 'INVALID_REQUEST'],
    [/(failed(?:[_ ]?precondition))/, 'FAILED_PRECONDITION'],
    [/(internal error|\binternal\b)/, 'INTERNAL'],
  ];
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? 'OTHER';
}

function safeNonzeroUnclassified(stdout, stderr, environment) {
  if (environment.GITHUB_ACTIONS !== 'true') return SAFE_INVOKE_NONZERO_UNCLASSIFIED;
  return Object.freeze({
    ...SAFE_INVOKE_NONZERO_UNCLASSIFIED,
    outputShape: `STDOUT_${safeCapturedShape(stdout)}__STDERR_${safeCapturedShape(stderr)}`,
    transportClass: safeTransportClass(stderr),
  });
}

function safeInvokeFailure(error, environment) {
  const stdout = capturedErrorField(error, 'stdout');
  const stderr = capturedErrorField(error, 'stderr');
  const exactResult = parseExactFunctionResult(stdout);
  if (exactResult !== null && exactResult.status !== 'PASS') return exactResult;

  const captured = `${stdout}\n${stderr}`;
  if (captured.includes(YANDEX_FUNCTION_TIMEOUT_MARKER)) return SAFE_INVOKE_FUNCTION_TIMEOUT;

  const stderrExactResult = parseUniqueExactNonPassFunctionResultFromLines(stderr);
  if (stderrExactResult !== null) return stderrExactResult;

  if (
    error !== null
    && (typeof error === 'object' || typeof error === 'function')
    && typeof Reflect.get(error, 'code') === 'number'
  ) {
    return safeNonzeroUnclassified(stdout, stderr, environment);
  }
  return SAFE_INVOKE_FAILURE;
}

async function invokeInitialBootstrap(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID;
  const ycBinary = environment.PRIHRASH_YC_BIN ?? 'yc';
  if (!nonBlank(functionId) || !nonBlank(ycBinary)) return SAFE_CONFIG_FAILURE;

  try {
    const { stdout } = await execFileAsync(
      ycBinary,
      ['serverless', 'function', 'invoke', '--id', functionId, '--tag', BOOTSTRAP_TAG, '--retry', '0', '--no-user-output'],
      {
        encoding: 'utf8',
        env: safeChildEnvironment(environment),
        timeout: INVOKE_TIMEOUT_MS,
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );
    return parseExactFunctionResult(stdout) ?? SAFE_INVOKE_OUTPUT_INVALID;
  } catch (error) {
    return safeInvokeFailure(error, environment);
  }
}

const result = await invokeInitialBootstrap();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
