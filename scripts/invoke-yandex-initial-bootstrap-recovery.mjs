import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RECOVERY_TAG = 'r1-initial-bootstrap-recovery';
const MAX_CAPTURE_BYTES = 16 * 1024;
const INVOKE_TIMEOUT_MS = 180_000;

const SAFE_CONFIG_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKER_CONFIG_INVALID',
});
const SAFE_INVOKE_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED',
});
const SAFE_OUTPUT_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_OUTPUT_INVALID',
});
const VERDICTS = new Set(['APPLIED', 'NOT_APPLIED', 'RECOVERY_REQUIRED']);
const REASONS = new Set([
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
const FUNCTION_FAILURE_CODES = new Set([
  'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID',
  'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
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

function validPair(verdict, reason) {
  if (verdict === 'APPLIED') return reason === 'COMMITTED_DURABLE_STATE';
  if (verdict === 'NOT_APPLIED') return reason === 'EMPTY_DURABLE_STATE';
  return verdict === 'RECOVERY_REQUIRED'
    && reason !== 'COMMITTED_DURABLE_STATE'
    && reason !== 'EMPTY_DURABLE_STATE';
}

function parseExactResult(stdout) {
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
    && result.code === 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED'
    && exactKeys(result, ['status', 'code', 'verdict', 'reason'])
    && typeof result.verdict === 'string'
    && VERDICTS.has(result.verdict)
    && typeof result.reason === 'string'
    && REASONS.has(result.reason)
    && validPair(result.verdict, result.reason)
  ) {
    return Object.freeze({
      status: 'PASS',
      code: result.code,
      verdict: result.verdict,
      reason: result.reason,
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

async function invokeRecovery(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID;
  const ycBinary = environment.PRIHRASH_YC_BIN ?? 'yc';
  if (!nonBlank(functionId) || !nonBlank(ycBinary)) return SAFE_CONFIG_FAILURE;

  try {
    const { stdout } = await execFileAsync(
      ycBinary,
      ['serverless', 'function', 'invoke', '--id', functionId, '--tag', RECOVERY_TAG, '--retry', '0', '--no-user-output'],
      {
        encoding: 'utf8',
        env: safeChildEnvironment(environment),
        timeout: INVOKE_TIMEOUT_MS,
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );
    return parseExactResult(stdout) ?? SAFE_OUTPUT_FAILURE;
  } catch {
    return SAFE_INVOKE_FAILURE;
  }
}

const result = await invokeRecovery();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
