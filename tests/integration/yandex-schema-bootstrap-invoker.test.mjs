import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-schema-bootstrap.mjs');
const FUNCTION_ID = 'synthetic-schema-bootstrap-function-id';
const PRIVATE_LOOKING = 'grpcs://private-ydb private-provider-id private-token-value';
const SAFE_FAILURES = Object.freeze([
  ['CONFIG_INVALID', 'SCHEMA_BOOTSTRAP_RUNTIME_CONFIG_INVALID'],
  ['MIGRATION_BUNDLE_INVALID', 'SCHEMA_BOOTSTRAP_MIGRATION_BUNDLE_INVALID'],
  ['YDB_CLIENT_CREATE_FAILED', 'SCHEMA_BOOTSTRAP_YDB_CLIENT_CREATE_FAILED'],
  ['YDB_HEALTH_READ_FAILED', 'SCHEMA_BOOTSTRAP_YDB_HEALTH_READ_FAILED'],
  ['YDB_ACCESS_DENIED', 'SCHEMA_BOOTSTRAP_YDB_ACCESS_DENIED'],
  ['YDB_PREFLIGHT_READ_FAILED', 'SCHEMA_BOOTSTRAP_YDB_PREFLIGHT_READ_FAILED'],
  ['PARTIAL_SCHEMA_STATE', 'SCHEMA_BOOTSTRAP_PARTIAL_SCHEMA_STATE'],
  ['UNEXPECTED_MIGRATION_EVIDENCE', 'SCHEMA_BOOTSTRAP_UNEXPECTED_MIGRATION_EVIDENCE'],
  ['MIGRATION_001_APPLY_FAILED', 'SCHEMA_BOOTSTRAP_MIGRATION_001_APPLY_FAILED'],
  ['MIGRATION_001_EVIDENCE_FAILED', 'SCHEMA_BOOTSTRAP_MIGRATION_001_EVIDENCE_FAILED'],
  ['MIGRATION_002_APPLY_FAILED', 'SCHEMA_BOOTSTRAP_MIGRATION_002_APPLY_FAILED'],
  ['MIGRATION_002_EVIDENCE_FAILED', 'SCHEMA_BOOTSTRAP_MIGRATION_002_EVIDENCE_FAILED'],
  ['FINAL_READBACK_FAILED', 'SCHEMA_BOOTSTRAP_FINAL_READBACK_FAILED'],
  ['YDB_CLIENT_CLOSE_FAILED', 'SCHEMA_BOOTSTRAP_YDB_CLIENT_CLOSE_FAILED'],
]);

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-schema-bootstrap-yc-'));
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
    ...(includeFunctionId ? { PRIHRASH_YANDEX_SCHEMA_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID } : {}),
  };
  try {
    const result = await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: environment,
      encoding: 'utf8',
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    };
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

test('schema bootstrap invoker calls only pinned tag and accepts exact 001+002 READY evidence', async () => {
  const result = await runInvoker({
    fakeSource: `
const expected = ['serverless','function','invoke','--id','${FUNCTION_ID}','--tag','r1-schema-bootstrap','--retry','0','--no-user-output'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(91);
if (process.env.PRIHRASH_YANDEX_SCHEMA_BOOTSTRAP_FUNCTION_ID !== undefined) process.exit(92);
if (process.env.SYNTHETIC_PRIVATE_VALUE !== undefined) process.exit(93);
if (process.env.YC_IAM_TOKEN !== 'synthetic-short-lived-iam-token') process.exit(94);
process.stdout.write(JSON.stringify({ydbSchema:'READY',appliedMigrationVersions:[1,2]}));
`,
  });
  assert.equal(result.exitCode, 0);
  assertSafeOutput(result, { status: 'PASS', code: 'SCHEMA_BOOTSTRAP_READY' });
});

test('allowlisted bootstrap markers are classified without echoing provider output', async () => {
  for (const [marker, code] of SAFE_FAILURES) {
    const result = await runInvoker({
      fakeSource: `process.stderr.write(${JSON.stringify(`${marker}\n${PRIVATE_LOOKING}`)}); process.exit(17);`,
    });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code });
  }
});

test('ambiguous or raw non-zero output stays value-free', async () => {
  const ambiguous = await runInvoker({
    fakeSource: `process.stderr.write(${JSON.stringify(`MIGRATION_001_APPLY_FAILED MIGRATION_002_APPLY_FAILED\n${PRIVATE_LOOKING}`)}); process.exit(17);`,
  });
  assert.equal(ambiguous.exitCode, 2);
  assertSafeOutput(ambiguous, { status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_MARKER_AMBIGUOUS' });

  const raw = await runInvoker({
    fakeSource: `process.stdout.write('${PRIVATE_LOOKING}'); process.stderr.write('${PRIVATE_LOOKING}'); process.exit(17);`,
  });
  assert.equal(raw.exitCode, 2);
  assertSafeOutput(raw, { status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED' });
});

test('unexpected successful output, missing config and missing yc fail closed', async () => {
  const malformed = await runInvoker({
    fakeSource: `process.stdout.write(JSON.stringify({ydbSchema:'READY',appliedMigrationVersions:[1,2,3],extra:'${PRIVATE_LOOKING}'}));`,
  });
  assert.equal(malformed.exitCode, 2);
  assertSafeOutput(malformed, { status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_OUTPUT_INVALID' });

  const missingId = await runInvoker({
    includeFunctionId: false,
    fakeSource: `process.stdout.write('${PRIVATE_LOOKING}'); process.exit(99);`,
  });
  assert.equal(missingId.exitCode, 2);
  assertSafeOutput(missingId, { status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_CONFIG_INVALID' });

  const missingYc = await runInvoker({
    fakeSource: null,
    ycPath: resolve(tmpdir(), 'prihrash-definitely-missing-schema-bootstrap-yc'),
  });
  assert.equal(missingYc.exitCode, 2);
  assertSafeOutput(missingYc, { status: 'FAIL', code: 'SCHEMA_BOOTSTRAP_INVOKE_FAILED' });
});
