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
const SAFE_PROBE_FAILURE_CODE_BY_MARKER = Object.freeze({
  CONFIG_INVALID: 'READINESS_RUNTIME_CONFIG_INVALID',
  GOOGLE_SPREADSHEET_ID_INVALID: 'READINESS_GOOGLE_SPREADSHEET_ID_INVALID',
  GOOGLE_CREDENTIALS_INVALID: 'READINESS_GOOGLE_CREDENTIALS_INVALID',
  GOOGLE_TOKEN_ACQUISITION_FAILED: 'READINESS_GOOGLE_TOKEN_ACQUISITION_FAILED',
  GOOGLE_SHEETS_ACCESS_FAILED: 'READINESS_GOOGLE_SHEETS_ACCESS_FAILED',
  GOOGLE_SHEETS_RESPONSE_INVALID: 'READINESS_GOOGLE_SHEETS_RESPONSE_INVALID',
  GOOGLE_SOURCE_METADATA_MISMATCH: 'READINESS_GOOGLE_SOURCE_METADATA_MISMATCH',
  GOOGLE_SOURCE_SHEET_MISSING: 'READINESS_GOOGLE_SOURCE_SHEET_MISSING',
  GOOGLE_SOURCE_SCHEMA_MISMATCH: 'READINESS_GOOGLE_SOURCE_SCHEMA_MISMATCH',
  GOOGLE_SOURCE_VALUE_UNSUPPORTED: 'READINESS_GOOGLE_SOURCE_VALUE_UNSUPPORTED',
  GOOGLE_SOURCE_READ_FAILED: 'READINESS_GOOGLE_SOURCE_READ_FAILED',
  YDB_CLIENT_CREATE_FAILED: 'READINESS_YDB_CLIENT_CREATE_FAILED',
  YDB_QUERY_HEALTH_READ_FAILED: 'READINESS_YDB_QUERY_HEALTH_READ_FAILED',
  YDB_MIGRATION_SCHEMA_READ_FAILED: 'READINESS_YDB_MIGRATION_SCHEMA_READ_FAILED',
  YDB_MIGRATION_EVIDENCE_READ_FAILED: 'READINESS_YDB_MIGRATION_EVIDENCE_READ_FAILED',
  YDB_ACCOUNTS_SCHEMA_READ_FAILED: 'READINESS_YDB_ACCOUNTS_SCHEMA_READ_FAILED',
  YDB_CATEGORIES_SCHEMA_READ_FAILED: 'READINESS_YDB_CATEGORIES_SCHEMA_READ_FAILED',
  MALFORMED_SCHEMA_MIGRATION_EVIDENCE: 'READINESS_MALFORMED_SCHEMA_MIGRATION_EVIDENCE',
  MISSING_REQUIRED_SCHEMA_MIGRATION: 'READINESS_MISSING_REQUIRED_SCHEMA_MIGRATION',
  UNEXPECTED_SCHEMA_MIGRATION: 'READINESS_UNEXPECTED_SCHEMA_MIGRATION',
  YDB_CLIENT_CLOSE_FAILED: 'READINESS_YDB_CLIENT_CLOSE_FAILED',
  READINESS_FAILED: 'READINESS_RUNTIME_FAILED',
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

function capturedErrorField(error, field) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return '';
  const value = Reflect.get(error, field);
  return typeof value === 'string' ? value : '';
}

function safeInvokeFailure(error) {
  const captured = `${capturedErrorField(error, 'stdout')}\n${capturedErrorField(error, 'stderr')}`;
  const matches = Object.entries(SAFE_PROBE_FAILURE_CODE_BY_MARKER)
    .filter(([marker]) => captured.includes(marker));
  if (matches.length !== 1) return SAFE_INVOKE_FAILURE;
  return Object.freeze({ status: 'FAIL', code: matches[0][1] });
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
  } catch (error) {
    return safeInvokeFailure(error);
  }
}

const result = await invokeReadiness();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
