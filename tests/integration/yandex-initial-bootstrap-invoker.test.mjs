import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap.mjs');
const FUNCTION_ID = 'synthetic-bootstrap-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-bootstrap-yc-'));
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
    ...(includeFunctionId ? { PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID } : {}),
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

test('safe bootstrap invoker calls only the pinned one-shot tag and accepts exact COMMITTED result', async () => {
  const result = await runInvoker({
    fakeSource: `
const expected = ['serverless','function','invoke','--id','${FUNCTION_ID}','--tag','r1-initial-bootstrap','--retry','0','--no-user-output'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(91);
if (process.env.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID !== undefined) process.exit(92);
if (process.env.SYNTHETIC_PRIVATE_VALUE !== undefined) process.exit(93);
if (process.env.YC_IAM_TOKEN !== 'synthetic-short-lived-iam-token') process.exit(94);
process.stdout.write(JSON.stringify({status:'PASS',code:'INITIAL_BOOTSTRAP_COMMITTED'}));
`,
  });

  assert.equal(result.exitCode, 0);
  assertSafeOutput(result, { status: 'PASS', code: 'INITIAL_BOOTSTRAP_COMMITTED' });
});

test('safe non-success Function results remain exact bounded output and exit non-zero', async () => {
  const values = [
    { status: 'NOOP', code: 'INITIAL_BOOTSTRAP_BASELINE_EXISTS' },
    { status: 'STOP', code: 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED' },
    {
      status: 'STOP',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
      recoveryReason: 'PROMOTION_OUTCOME_UNKNOWN',
    },
    {
      status: 'STOP',
      code: 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED',
      blockers: [
        { code: 'INVALID_ROWS_PRESENT' },
        { code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'TOTALS_BY_TYPE' },
      ],
    },
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_CONFIG_INVALID' },
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED' },
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RESULT_INVALID' },
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED' },
  ];

  for (const value of values) {
    const result = await runInvoker({
      fakeSource: `process.stdout.write(${JSON.stringify(JSON.stringify(value))});`,
    });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, value);
  }
});

test('malformed, extra-field and non-allowlisted successful provider output fails closed without echo', async () => {
  const outputs = [
    PRIVATE_LOOKING,
    JSON.stringify({ status: 'PASS', code: 'INITIAL_BOOTSTRAP_COMMITTED', private: PRIVATE_LOOKING }),
    JSON.stringify({ status: 'STOP', code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED', recoveryReason: 'PRIVATE_REASON' }),
    JSON.stringify({
      status: 'STOP',
      code: 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED',
      blockers: [{ code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'PRIVATE_CHECK' }],
    }),
    JSON.stringify({ status: 'FAIL', code: 'PRIVATE_FAILURE' }),
  ];

  for (const output of outputs) {
    const result = await runInvoker({ fakeSource: `process.stdout.write(${JSON.stringify(output)});` });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID' });
  }
});

test('non-zero provider failure never echoes captured stdout or stderr', async () => {
  const result = await runInvoker({
    fakeSource: `
process.stdout.write('${PRIVATE_LOOKING}');
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`,
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_FAILED' });
});

test('missing function id fails before yc executes', async () => {
  const result = await runInvoker({
    includeFunctionId: false,
    fakeSource: `process.stdout.write('${PRIVATE_LOOKING}'); process.exit(99);`,
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID' });
});

test('missing yc CLI fails closed with generic invoke failure', async () => {
  const result = await runInvoker({
    fakeSource: null,
    ycPath: resolve(tmpdir(), 'prihrash-definitely-missing-bootstrap-yc'),
  });

  assert.equal(result.exitCode, 2);
  assertSafeOutput(result, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_FAILED' });
});
