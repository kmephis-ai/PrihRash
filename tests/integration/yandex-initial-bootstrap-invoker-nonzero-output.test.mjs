import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap.mjs');
const FETCH_MOCK = resolve(ROOT, 'tests/fixtures/mock-yandex-function-fetch.mjs');
const FUNCTION_ID = 'synthetic-bootstrap-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function runInvoker(body) {
  try {
    await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_OPTIONS: `--import=${pathToFileURL(FETCH_MOCK).href}`,
        PRIHRASH_TEST_FUNCTION_ID: FUNCTION_ID,
        PRIHRASH_TEST_FETCH_BODY: body,
        PRIHRASH_TEST_FETCH_STATUS: '200',
        PRIHRASH_TEST_FETCH_MODE: 'response',
        PRIHRASH_TEST_FUNCTION_ERROR: 'false',
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
  }
}

function assertSafeOutput(result, expected) {
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('raw HTTPS 200 preserves an exact allowlisted runtime failure without wrapper text', async () => {
  const expected = {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_APPLICATION_SEMANTIC_FAILED',
    applicationPhase: 'FRESH_CONTEXT_PREPARATION',
    metadataFailureCode: null,
  };
  assertSafeOutput(await runInvoker(JSON.stringify(expected)), expected);
});

test('raw HTTPS 200 preserves an exact allowlisted STOP result', async () => {
  const expected = {
    status: 'STOP',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
    recoveryReason: 'PROMOTION_OUTCOME_UNKNOWN',
  };
  assertSafeOutput(await runInvoker(JSON.stringify(expected)), expected);
});

test('multiple or wrapped result lines are rejected rather than heuristically recovered', async () => {
  const first = JSON.stringify({ status: 'FAIL', code: 'INITIAL_BOOTSTRAP_CONFIG_INVALID' });
  const second = JSON.stringify({ status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RESULT_INVALID' });
  const body = `${PRIVATE_LOOKING}\n${first}\n${second}`;
  assertSafeOutput(
    await runInvoker(body),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID' },
  );
});
