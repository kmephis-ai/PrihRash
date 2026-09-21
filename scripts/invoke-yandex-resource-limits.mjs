import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RESOURCE_LIMITS_TAG = 'r1-ydb-resource-limits';
const MAX_CAPTURE_BYTES = 16 * 1024;
const INVOKE_TIMEOUT_MS = 30_000;
const SAFE_CONFIG_FAILURE = Object.freeze({ status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_CONFIG_INVALID' });
const SAFE_INVOKE_FAILURE = Object.freeze({ status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_FAILED' });
const SAFE_OUTPUT_INVALID = Object.freeze({ status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_OUTPUT_INVALID' });

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function safeChildEnvironment(environment) {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'YC_IAM_TOKEN'];
  return Object.fromEntries(allowed.filter((name) => nonBlank(environment[name])).map((name) => [name, environment[name]]));
}

function nonnegativeSafeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseProviderOutput(stdout) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return SAFE_OUTPUT_INVALID;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return SAFE_OUTPUT_INVALID;
  const keys = Object.keys(value).sort();
  const expected = ['code', 'databaseDiscovery', 'enableThrottlingRcuLimit', 'failureStage', 'mode', 'provisionedRcuLimit', 'status', 'throttlingRcuLimit'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) return SAFE_OUTPUT_INVALID;
  if (value.status !== 'PASS' || value.code !== 'YDB_RESOURCE_LIMITS_CLASSIFIED') return SAFE_OUTPUT_INVALID;
  if (!['SINGLE', 'NONE', 'AMBIGUOUS', 'READ_FAILED'].includes(value.databaseDiscovery)) return SAFE_OUTPUT_INVALID;
  if (!['NONE', 'TARGET_CONFIG_INVALID', 'TRANSPORT_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'PROVIDER_5XX', 'UNEXPECTED_STATUS', 'MALFORMED_JSON', 'IDENTITY_MISMATCH', 'LIMITS_MALFORMED'].includes(value.failureStage)) return SAFE_OUTPUT_INVALID;
  if (!['SERVERLESS', 'DEDICATED', 'UNKNOWN'].includes(value.mode)) return SAFE_OUTPUT_INVALID;
  if (value.databaseDiscovery === 'READ_FAILED') {
    if (value.failureStage === 'NONE') return SAFE_OUTPUT_INVALID;
  } else if (value.failureStage !== 'NONE') return SAFE_OUTPUT_INVALID;
  if (value.databaseDiscovery === 'SINGLE' && value.mode === 'SERVERLESS') {
    if (typeof value.enableThrottlingRcuLimit !== 'boolean') return SAFE_OUTPUT_INVALID;
    if (!nonnegativeSafeInteger(value.throttlingRcuLimit) || !nonnegativeSafeInteger(value.provisionedRcuLimit)) return SAFE_OUTPUT_INVALID;
  } else if (value.enableThrottlingRcuLimit !== null || value.throttlingRcuLimit !== null || value.provisionedRcuLimit !== null) {
    return SAFE_OUTPUT_INVALID;
  }
  return Object.freeze({ ...value });
}

async function invoke(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_READINESS_FUNCTION_ID;
  const ycBinary = environment.PRIHRASH_YC_BIN ?? 'yc';
  if (!nonBlank(functionId) || !nonBlank(ycBinary)) return SAFE_CONFIG_FAILURE;
  try {
    const { stdout } = await execFileAsync(
      ycBinary,
      ['serverless', 'function', 'invoke', '--id', functionId, '--tag', RESOURCE_LIMITS_TAG, '--retry', '0', '--no-user-output'],
      {
        encoding: 'utf8',
        env: safeChildEnvironment(environment),
        timeout: INVOKE_TIMEOUT_MS,
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );
    return parseProviderOutput(stdout);
  } catch {
    return SAFE_INVOKE_FAILURE;
  }
}

const result = await invoke();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
