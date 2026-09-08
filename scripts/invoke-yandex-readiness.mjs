import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const READINESS_TAG = 'r1-readiness';
const MAX_CAPTURE_BYTES = 64 * 1024;
const INVOKE_TIMEOUT_MS = 30_000;
const SAFE_READY = Object.freeze({
  googleSource: 'READY',
  ydbSchema: 'READY',
  requiredMigrationVersion: 2,
});
const SAFE_PASS = Object.freeze({ status: 'PASS', code: 'READINESS_READY' });
const SAFE_CONFIG_FAILURE = Object.freeze({ status: 'FAIL', code: 'READINESS_CONFIG_INVALID' });
const SAFE_INVOKE_FAILURE = Object.freeze({ status: 'FAIL', code: 'READINESS_INVOKE_FAILED' });

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function safeChildEnvironment(environment) {
  const allowed = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'XDG_CONFIG_HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'YC_IAM_TOKEN',
  ];
  return Object.fromEntries(
    allowed
      .filter((name) => nonBlank(environment[name]))
      .map((name) => [name, environment[name]]),
  );
}

function exactReadinessEvidence(stdout) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return false;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(SAFE_READY).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) return false;
  return value.googleSource === SAFE_READY.googleSource
    && value.ydbSchema === SAFE_READY.ydbSchema
    && value.requiredMigrationVersion === SAFE_READY.requiredMigrationVersion;
}

async function invokeReadiness(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_READINESS_FUNCTION_ID;
  const ycBinary = environment.PRIHRASH_YC_BIN ?? 'yc';
  if (!nonBlank(functionId) || !nonBlank(ycBinary)) return SAFE_CONFIG_FAILURE;

  try {
    const { stdout } = await execFileAsync(
      ycBinary,
      [
        'serverless',
        'function',
        'invoke',
        '--id',
        functionId,
        '--tag',
        READINESS_TAG,
        '--retry',
        '0',
        '--no-user-output',
      ],
      {
        encoding: 'utf8',
        env: safeChildEnvironment(environment),
        timeout: INVOKE_TIMEOUT_MS,
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );
    return exactReadinessEvidence(stdout) ? SAFE_PASS : SAFE_INVOKE_FAILURE;
  } catch {
    return SAFE_INVOKE_FAILURE;
  }
}

const result = await invokeReadiness();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
