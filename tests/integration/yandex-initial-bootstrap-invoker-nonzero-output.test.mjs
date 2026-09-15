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
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-bootstrap-nonzero-yc-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

async function runInvoker(fakeSource) {
  const fake = await fakeYc(fakeSource);
  try {
    await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PRIHRASH_YC_BIN: fake.path,
        PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
      },
      encoding: 'utf8',
    });
    assert.fail('non-success bootstrap result must keep the invoker exit non-zero');
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
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('non-zero yc exit preserves an exact allowlisted runtime failure without provider detail', async () => {
  const expected = {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_APPLICATION_SEMANTIC_FAILED',
    applicationPhase: 'FRESH_CONTEXT_PREPARATION',
    metadataFailureCode: null,
  };
  const result = await runInvoker(`
process.stdout.write(${JSON.stringify(JSON.stringify(expected))});
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeOutput(result, expected);
});

test('non-zero yc exit preserves an exact allowlisted STOP result without provider detail', async () => {
  const expected = {
    status: 'STOP',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
    recoveryReason: 'PROMOTION_OUTCOME_UNKNOWN',
  };
  const result = await runInvoker(`
process.stdout.write(${JSON.stringify(JSON.stringify(expected))});
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeOutput(result, expected);
});

test('non-zero yc exit never turns an exact PASS payload into success', async () => {
  const result = await runInvoker(`
process.stdout.write(JSON.stringify({status:'PASS',code:'INITIAL_BOOTSTRAP_COMMITTED'}));
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeOutput(result, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED' });
});
