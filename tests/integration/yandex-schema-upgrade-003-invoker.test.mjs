import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-schema-upgrade-003.mjs');
const FUNCTION_ID = 'synthetic-upgrade-function-id';
const PRIVATE_LOOKING = 'private-ydb-id secret-upgrade-token';
const SAFE_FAILURES = Object.freeze([
  ['CONFIG_INVALID', 'SCHEMA_UPGRADE_003_RUNTIME_CONFIG_INVALID'],
  ['MIGRATION_BUNDLE_INVALID', 'SCHEMA_UPGRADE_003_MIGRATION_BUNDLE_INVALID'],
  ['YDB_CLIENT_CREATE_FAILED', 'SCHEMA_UPGRADE_003_YDB_CLIENT_CREATE_FAILED'],
  ['YDB_HEALTH_READ_FAILED', 'SCHEMA_UPGRADE_003_YDB_HEALTH_READ_FAILED'],
  ['YDB_ACCESS_DENIED', 'SCHEMA_UPGRADE_003_YDB_ACCESS_DENIED'],
  ['YDB_PREFLIGHT_READ_FAILED', 'SCHEMA_UPGRADE_003_YDB_PREFLIGHT_READ_FAILED'],
  ['PARTIAL_SCHEMA_STATE', 'SCHEMA_UPGRADE_003_PARTIAL_SCHEMA_STATE'],
  ['UNEXPECTED_MIGRATION_EVIDENCE', 'SCHEMA_UPGRADE_003_UNEXPECTED_MIGRATION_EVIDENCE'],
  ['MIGRATION_003_APPLY_FAILED', 'SCHEMA_UPGRADE_003_APPLY_FAILED'],
  ['MIGRATION_003_EVIDENCE_FAILED', 'SCHEMA_UPGRADE_003_EVIDENCE_FAILED'],
  ['FINAL_READBACK_FAILED', 'SCHEMA_UPGRADE_003_FINAL_READBACK_FAILED'],
  ['YDB_CLIENT_CLOSE_FAILED', 'SCHEMA_UPGRADE_003_YDB_CLIENT_CLOSE_FAILED'],
]);

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-yc-upgrade-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

async function runInvoker({ fakeSource, includeFunctionId = true }) {
  const fake = await fakeYc(fakeSource);
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PRIHRASH_YC_BIN: fake.path,
    SYNTHETIC_PRIVATE_VALUE: PRIVATE_LOOKING,
    YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
    ...(includeFunctionId ? { PRIHRASH_YANDEX_SCHEMA_UPGRADE_003_FUNCTION_ID: FUNCTION_ID } : {}),
  };
  try {
    const result = await execFileAsync(process.execPath, [INVOKER], { cwd: ROOT, env: environment, encoding: 'utf8' });
    return Object.freeze({ exitCode: 0, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    return Object.freeze({
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    });
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
}

function assertSafeOutput(result, expected) {
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
}

test('upgrade invoker calls only r1-schema-upgrade-003 tag and accepts exact 1+2+3 READY evidence', async () => {
  const result = await runInvoker({ fakeSource: `
const expected = ['serverless','function','invoke','--id','${FUNCTION_ID}','--tag','r1-schema-upgrade-003','--retry','0','--no-user-output'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(91);
if (process.env.PRIHRASH_YANDEX_SCHEMA_UPGRADE_003_FUNCTION_ID !== undefined) process.exit(92);
if (process.env.SYNTHETIC_PRIVATE_VALUE !== undefined) process.exit(93);
if (process.env.YC_IAM_TOKEN !== 'synthetic-short-lived-iam-token') process.exit(94);
process.stdout.write(JSON.stringify({ydbSchema:'READY',appliedMigrationVersions:[1,2,3]}));
` });
  assert.equal(result.exitCode, 0);
  assertSafeOutput(result, { status: 'PASS', code: 'SCHEMA_UPGRADE_003_READY' });
});

test('upgrade invoker rejects non-exact successful output and missing function config', async () => {
  for (const output of [
    JSON.stringify({ ydbSchema: 'READY', appliedMigrationVersions: [1, 2] }),
    JSON.stringify({ ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3], extra: PRIVATE_LOOKING }),
    PRIVATE_LOOKING,
  ]) {
    const result = await runInvoker({ fakeSource: `process.stdout.write(${JSON.stringify(output)});` });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code: 'SCHEMA_UPGRADE_003_INVOKE_OUTPUT_INVALID' });
  }

  const missing = await runInvoker({ includeFunctionId: false, fakeSource: `process.exit(99);` });
  assert.equal(missing.exitCode, 2);
  assertSafeOutput(missing, { status: 'FAIL', code: 'SCHEMA_UPGRADE_003_CONFIG_INVALID' });
});

test('upgrade invoker maps exactly one safe runtime marker without echoing provider output', async () => {
  for (const [marker, code] of SAFE_FAILURES) {
    const result = await runInvoker({ fakeSource: `
process.stderr.write(${JSON.stringify(`${marker}\n${PRIVATE_LOOKING}`)});
process.exit(17);
` });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code });
  }
});

test('upgrade invoker fails closed on ambiguous or unclassified nonzero provider output', async () => {
  const ambiguous = await runInvoker({ fakeSource: `
process.stderr.write('YDB_ACCESS_DENIED PARTIAL_SCHEMA_STATE ${PRIVATE_LOOKING}');
process.exit(17);
` });
  assert.equal(ambiguous.exitCode, 2);
  assertSafeOutput(ambiguous, { status: 'FAIL', code: 'SCHEMA_UPGRADE_003_INVOKE_MARKER_AMBIGUOUS' });

  const unknown = await runInvoker({ fakeSource: `
process.stdout.write('${PRIVATE_LOOKING}');
process.exit(17);
` });
  assert.equal(unknown.exitCode, 2);
  assertSafeOutput(unknown, { status: 'FAIL', code: 'SCHEMA_UPGRADE_003_INVOKE_NONZERO_UNCLASSIFIED' });
});
