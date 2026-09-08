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
