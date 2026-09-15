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

async function runInvoker({ status, functionError = false }) {
  try {
    await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_OPTIONS: `--import=${pathToFileURL(FETCH_MOCK).href}`,
        PRIHRASH_TEST_FUNCTION_ID: FUNCTION_ID,
        PRIHRASH_TEST_FETCH_BODY: PRIVATE_LOOKING,
        PRIHRASH_TEST_FETCH_STATUS: String(status),
        PRIHRASH_TEST_FETCH_MODE: 'response',
        PRIHRASH_TEST_FUNCTION_ERROR: functionError ? 'true' : 'false',
        PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
      },
      encoding: 'utf8',
    });
    assert.fail('HTTP failure must keep the invoker exit non-zero');
  } catch (error) {
    return Object.freeze({
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    });
  }
}

function assertHttpFailure(result, httpStatus, functionError) {
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
    httpStatus,
    functionError,
  });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('documented Cloud Functions 502 is classified without reading private response body', async () => {
  const result = await runInvoker({ status: 502, functionError: true });
  assertHttpFailure(result, 'HTTP_502', 'PRESENT');
});

test('provider 500 remains distinguishable from user-function 502 without response detail', async () => {
  const result = await runInvoker({ status: 500 });
  assertHttpFailure(result, 'HTTP_500', 'ABSENT');
});

test('deadline and unavailable HTTP statuses stay exact enum-only evidence', async () => {
  const deadline = await runInvoker({ status: 504 });
  assertHttpFailure(deadline, 'HTTP_504', 'ABSENT');

  const unavailable = await runInvoker({ status: 503 });
  assertHttpFailure(unavailable, 'HTTP_503', 'ABSENT');
});

test('unlisted HTTP status collapses to bounded class without leaking body', async () => {
  const result = await runInvoker({ status: 418 });
  assertHttpFailure(result, 'HTTP_4XX_OTHER', 'ABSENT');
});
