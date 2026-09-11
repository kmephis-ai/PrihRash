import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BOOTSTRAP_TAG = 'r1-schema-bootstrap';
const MAX_CAPTURE_BYTES = 64 * 1024;
const INVOKE_TIMEOUT_MS = 90_000;
const SAFE_READY = Object.freeze({
  ydbSchema: 'READY',
  appliedMigrationVersions: [1, 2],
});
const SAFE_PASS = Object.freeze({ status: 'PASS', code: 'SCHEMA_BOOTSTRAP_READY' });
const SAFE_CONFIG_FAILURE = Object.freeze({ status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_CONFIG_INVALID' });
const SAFE_INVOKE_FAILURE = Object.freeze({ status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_FAILED' });
const SAFE_INVOKE_OUTPUT_INVALID = Object.freeze({ status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_OUTPUT_INVALID' });
const SAFE_INVOKE_NONZERO_UNCLASSIFIED = Object.freeze({ status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED' });
const SAFE_INVOKE_MARKER_AMBIGUOUS = Object.freeze({ status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_MARKER_AMBIGUOUS' });
const SAFE_FAILURE_CODE_BY_MARKER = Object.freeze({
  CONFIG_INVALID: 'SCHEMA_BOOTSTRAP_RUNTIME_CONFIG_INVALID',
  MIGRATION_BUNDLE_INVALID: 'SCHEMA_BOOTSTRAP_MIGRATION_BUNDLE_INVALID',
  YDB_CLIENT_CREATE_FAILED: 'SCHEMA_BOOTSTRAP_YDB_CLIENT_CREATE_FAILED',
  YDB_HEALTH_READ_FAILED: 'SCHEMA_BOOTSTRAP_YDB_HEALTH_READ_FAILED',
  YDB_ACCESS_DENIED: 'SCHEMA_BOOTSTRAP_YDB_ACCESS_DENIED',
  YDB_PREFLIGHT_READ_FAILED: 'SCHEMA_BOOTSTRAP_YDB_PREFLIGHT_READ_FAILED',
  PARTIAL_SCHEMA_STATE: 'SCHEMA_BOOTSTRAP_PARTIAL_SCHEMA_STATE',
  UNEXPECTED_MIGRATION_EVIDENCE: 'SCHEMA_BOOTSTRAP_UNEXPECTED_MIGRATION_EVIDENCE',
  MIGRATION_001_APPLY_FAILED: 'SCHEMA_BOOTSTRAP_MIGRATION_001_APPLY_FAILED',
  MIGRATION_001_EVIDENCE_FAILED: 'SCHEMA_BOOTSTRAP_MIGRATION_001_EVIDENCE_FAILED',
  MIGRATION_002_APPLY_FAILED: 'SCHEMA_BOOTSTRAP_MIGRATION_002_APPLY_FAILED',
  MIGRATION_002_EVIDENCE_FAILED: 'SCHEMA_BOOTSTRAP_MIGRATION_002_EVIDENCE_FAILED',
  FINAL_READBACK_FAILED: 'SCHEMA_BOOTSTRAP_FINAL_READBACK_FAILED',
  YDB_CLIENT_CLOSE_FAILED: 'SCHEMA_BOOTSTRAP_YDB_CLIENT_CLOSE_FAILED',
});

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

function exactReadyEvidence(stdout) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return false;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(Object.keys(SAFE_READY).sort())) return false;
  return value.ydbSchema === 'READY'
    && Array.isArray(value.appliedMigrationVersions)
    && value.appliedMigrationVersions.length === 2
    && value.appliedMigrationVersions[0] === 1
    && value.appliedMigrationVersions[1] === 2;
}

function capturedErrorField(error, field) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return '';
  const value = Reflect.get(error, field);
  return typeof value === 'string' ? value : '';
}

function safeInvokeFailure(error) {
  const captured = `${capturedErrorField(error, 'stdout')}\n${capturedErrorField(error, 'stderr')}`;
  const matches = Object.entries(SAFE_FAILURE_CODE_BY_MARKER)
    .filter(([marker]) => captured.includes(marker));
  if (matches.length === 1) return Object.freeze({ status: 'FAIL', code: matches[0][1] });
  if (matches.length > 1) return SAFE_INVOKE_MARKER_AMBIGUOUS;
  if (
    error !== null
    && (typeof error === 'object' || typeof error === 'function')
    && typeof Reflect.get(error, 'code') === 'number'
  ) {
    return SAFE_INVOKE_NONZERO_UNCLASSIFIED;
  }
  return SAFE_INVOKE_FAILURE;
}

async function invokeBootstrap(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_SCHEMA_BOOTSTRAP_FUNCTION_ID;
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
        BOOTSTRAP_TAG,
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
    return exactReadyEvidence(stdout) ? SAFE_PASS : SAFE_INVOKE_OUTPUT_INVALID;
  } catch (error) {
    return safeInvokeFailure(error);
  }
}

const result = await invokeBootstrap();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
