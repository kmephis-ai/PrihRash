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
    && FUNCTION_FAILURE_CODES.has(result.code)
    && exactKeys(result, ['status', 'code'])
  ) {
    return Object.freeze({ status: 'FAIL', code: result.code });
  }
  return null;
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
  } catch {
    return SAFE_INVOKE_FAILURE;
  }
}

const result = await invokeInitialBootstrap();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
