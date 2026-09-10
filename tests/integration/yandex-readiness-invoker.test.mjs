import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-readiness.mjs');
const FUNCTION_ID = 'synthetic-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value';
const SAFE_PROBE_FAILURES = Object.freeze([
  ['CONFIG_INVALID', 'READINESS_RUNTIME_CONFIG_INVALID'],
  ['GOOGLE_SPREADSHEET_ID_INVALID', 'READINESS_GOOGLE_SPREADSHEET_ID_INVALID'],
  ['GOOGLE_CREDENTIALS_INVALID', 'READINESS_GOOGLE_CREDENTIALS_INVALID'],
  ['GOOGLE_TOKEN_ACQUISITION_FAILED', 'READINESS_GOOGLE_TOKEN_ACQUISITION_FAILED'],
  ['GOOGLE_SHEETS_ACCESS_FAILED', 'READINESS_GOOGLE_SHEETS_ACCESS_FAILED'],
  ['GOOGLE_SHEETS_RESPONSE_INVALID', 'READINESS_GOOGLE_SHEETS_RESPONSE_INVALID'],
  ['GOOGLE_SOURCE_METADATA_MISMATCH', 'READINESS_GOOGLE_SOURCE_METADATA_MISMATCH'],
  ['GOOGLE_SOURCE_SHEET_MISSING', 'READINESS_GOOGLE_SOURCE_SHEET_MISSING'],
  ['GOOGLE_SOURCE_SCHEMA_MISMATCH', 'READINESS_GOOGLE_SOURCE_SCHEMA_MISMATCH'],
  ['GOOGLE_SOURCE_VALUE_UNSUPPORTED', 'READINESS_GOOGLE_SOURCE_VALUE_UNSUPPORTED'],
  ['GOOGLE_SOURCE_READ_FAILED', 'READINESS_GOOGLE_SOURCE_READ_FAILED'],
  ['YDB_CLIENT_CREATE_FAILED', 'READINESS_YDB_CLIENT_CREATE_FAILED'],
  ['YDB_QUERY_HEALTH_READ_FAILED', 'READINESS_YDB_QUERY_HEALTH_READ_FAILED'],
  ['YDB_MIGRATION_SCHEMA_READ_FAILED', 'READINESS_YDB_MIGRATION_SCHEMA_READ_FAILED'],
  ['YDB_MIGRATION_EVIDENCE_READ_FAILED', 'READINESS_YDB_MIGRATION_EVIDENCE_READ_FAILED'],
  ['YDB_ACCOUNTS_SCHEMA_READ_FAILED', 'READINESS_YDB_ACCOUNTS_SCHEMA_READ_FAILED'],
  ['YDB_CATEGORIES_SCHEMA_READ_FAILED', 'READINESS_YDB_CATEGORIES_SCHEMA_READ_FAILED'],
  ['MALFORMED_SCHEMA_MIGRATION_EVIDENCE', 'READINESS_MALFORMED_SCHEMA_MIGRATION_EVIDENCE'],
  ['MISSING_REQUIRED_SCHEMA_MIGRATION', 'READINESS_MISSING_REQUIRED_SCHEMA_MIGRATION'],
  ['UNEXPECTED_SCHEMA_MIGRATION', 'READINESS_UNEXPECTED_SCHEMA_MIGRATION'],
  ['YDB_CLIENT_CLOSE_FAILED', 'READINESS_YDB_CLIENT_CLOSE_FAILED'],
  ['READINESS_FAILED', 'READINESS_RUNTIME_FAILED'],
]);

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-yc-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

async function runInvoker({ fakeSource, includeFunctionId = true, ycPath = null }) {
  const fake = fakeSource === null ? null : await fakeYc(fakeSource);
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PRIHRASH_YC_BIN: ycPath ?? fake?.path,
    SYNTHETIC_PRIVATE_VALUE: PRIVATE_LOOKING,
    YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
    ...(includeFunctionId ? { PRIHRASH_YANDEX_READINESS_FUNCTION_ID: FUNCTION_ID } : {}),
  };
  try {
    const result = await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: environment,
      encoding: 'utf8',
    });
    return Object.freeze({ exitCode: 0, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    return Object.freeze({
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    });
  } finally {
    if (fake !== null) await rm(fake.directory, { recursive: true, force: true });
  }
}

function assertSafeOutput(result, expected) {
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('safe invoker calls only the pinned readiness tag and accepts exact READY evidence', async () => {
  const result = await runInvoker({
    fakeSource: `
const expected = ['serverless','function','invoke','--id','${FUNCTION_ID}','--tag','r1-readiness','--retry','0','--no-user-output'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(91);
if (process.env.PRIHRASH_YANDEX_READINESS_FUNCTION_ID !== undefined) process.exit(92);
if (process.env.SYNTHETIC_PRIVATE_VALUE !== undefined) process.exit(93);
if (process.env.YC_IAM_TOKEN !== 'synthetic-short-lived-iam-token') process.exit(94);
process.stdout.write(JSON.stringify({googleSource:'READY',ydbSchema:'READY',requiredMigrationVersion:2}));
`,
  });

  assert.equal(result.exitCode, 0);
  assertSafeOutput(result, { status: 'PASS', code: 'READINESS_READY' });
});

test('non-zero yc failure is collapsed without echoing raw stdout or stderr', async () => {
  const result = await runInvoker({
    fakeSource: `
process.stdout.write('${PRIVATE_LOOKING}');
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`,
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'READINESS_INVOKE_FAILED' });
});

test('one allowlisted sanitized readiness marker is classified without echoing provider output', async () => {
  for (const [marker, code] of SAFE_PROBE_FAILURES) {
    const result = await runInvoker({
      fakeSource: `
process.stderr.write(${JSON.stringify(`${marker}\n${PRIVATE_LOOKING}`)});
process.exit(17);
`,
    });

    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code });
  }
});

test('ambiguous sanitized readiness markers still fail closed to the generic invoke code', async () => {
  const result = await runInvoker({
    fakeSource: `
process.stderr.write(${JSON.stringify(`GOOGLE_SOURCE_READ_FAILED YDB_MIGRATION_EVIDENCE_READ_FAILED\n${PRIVATE_LOOKING}`)});
process.exit(17);
`,
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'READINESS_INVOKE_FAILED' });
});

test('malformed or unexpected provider output fails closed without echoing it', async () => {
  const outputs = [
    PRIVATE_LOOKING,
    JSON.stringify({ googleSource: 'READY', ydbSchema: 'READY' }),
    JSON.stringify({ googleSource: 'READY', ydbSchema: 'READY', requiredMigrationVersion: 2, extra: PRIVATE_LOOKING }),
    JSON.stringify({ googleSource: 'READY', ydbSchema: 'NOT_READY', requiredMigrationVersion: 2 }),
  ];

  for (const output of outputs) {
    const result = await runInvoker({ fakeSource: `process.stdout.write(${JSON.stringify(output)});` });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code: 'READINESS_INVOKE_FAILED' });
  }
});

test('missing function id fails before yc is executed', async () => {
  const result = await runInvoker({
    includeFunctionId: false,
    fakeSource: `process.stdout.write('${PRIVATE_LOOKING}'); process.exit(99);`,
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'READINESS_CONFIG_INVALID' });
});

test('missing yc CLI fails closed with the same provider-safe code', async () => {
  const result = await runInvoker({
    fakeSource: null,
    ycPath: resolve(tmpdir(), 'prihrash-definitely-missing-yc'),
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'READINESS_INVOKE_FAILED' });
});
