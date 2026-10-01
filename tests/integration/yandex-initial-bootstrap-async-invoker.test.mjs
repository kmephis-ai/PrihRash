import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap-async.mjs');
const FETCH_MOCK = resolve(ROOT, 'tests/fixtures/mock-yandex-function-fetch.mjs');
const FUNCTION_ID = 'synthetic-bootstrap-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function runInvoker({
  body = PRIVATE_LOOKING,
  status = 202,
  mode = 'response',
  includeFunctionId = true,
  includeFunctionTag = true,
  includeIamToken = true,
  functionTag = 'r1-initial-bootstrap-async-deadbeefcafe',
} = {}) {
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_OPTIONS: `--import=${pathToFileURL(FETCH_MOCK).href}`,
    PRIHRASH_TEST_FUNCTION_ID: FUNCTION_ID,
    PRIHRASH_TEST_FUNCTION_TAG: functionTag,
    PRIHRASH_TEST_FUNCTION_INTEGRATION: 'async',
    PRIHRASH_TEST_FETCH_BODY: body,
    PRIHRASH_TEST_FETCH_STATUS: String(status),
    PRIHRASH_TEST_FETCH_MODE: mode,
    ...(includeFunctionId ? { PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID } : {}),
    ...(includeFunctionTag ? { PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_TAG: functionTag } : {}),
    ...(includeIamToken ? { YC_IAM_TOKEN: 'synthetic-short-lived-iam-token' } : {}),
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
  }
}

function assertSafeOutput(result, expected) {
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('async bootstrap treats HTTP 202 only as admission, never COMMITTED', async () => {
  const result = await runInvoker({
    body: JSON.stringify({ status: 'PASS', code: 'INITIAL_BOOTSTRAP_COMMITTED', private: PRIVATE_LOOKING }),
    status: 202,
  });

  assert.equal(result.exitCode, 0);
  assertSafeOutput(result, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_ASYNC_ACCEPTED',
  });
});

test('other HTTP responses fail closed without reading or echoing response body', async () => {
  for (const [status, httpStatus] of [
    [200, 'HTTP_2XX_OTHER'],
    [403, 'HTTP_403'],
    [429, 'HTTP_429'],
    [500, 'HTTP_500'],
    [599, 'HTTP_5XX_OTHER'],
  ]) {
    const result = await runInvoker({ status, body: PRIVATE_LOOKING });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_ASYNC_ACCEPTANCE_HTTP_FAILED',
      httpStatus,
    });
  }
});

test('transport timeout and failure stay bounded and private', async () => {
  const timeout = await runInvoker({ mode: 'timeout' });
  assert.equal(timeout.exitCode, 2);
  assertSafeOutput(timeout, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_ASYNC_ACCEPTANCE_TIMEOUT',
  });

  const failure = await runInvoker({ mode: 'failure' });
  assert.equal(failure.exitCode, 2);
  assertSafeOutput(failure, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_ASYNC_INVOKE_FAILED',
  });
});

test('missing exact function id, exact tag or IAM token stops before invocation', async () => {
  const missingFunction = await runInvoker({ includeFunctionId: false });
  assert.equal(missingFunction.exitCode, 2);
  assertSafeOutput(missingFunction, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_ASYNC_CONFIG_INVALID',
  });

  const missingTag = await runInvoker({ includeFunctionTag: false });
  assert.equal(missingTag.exitCode, 2);
  assertSafeOutput(missingTag, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_ASYNC_CONFIG_INVALID',
  });

  const invalidTag = await runInvoker({ functionTag: 'INVALID TAG' });
  assert.equal(invalidTag.exitCode, 2);
  assertSafeOutput(invalidTag, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_ASYNC_CONFIG_INVALID',
  });

  const missingToken = await runInvoker({ includeIamToken: false });
  assert.equal(missingToken.exitCode, 2);
  assertSafeOutput(missingToken, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_ASYNC_CONFIG_INVALID',
  });
});

test('async invoker contract is short-lived admission-only and contains no retry/result parser', async () => {
  const source = await readFile(INVOKER, 'utf8');

  assert.match(source, /request as httpsRequest.*node:https/);
  assert.match(source, /const ACCEPT_TIMEOUT_MS = 30_000/);
  assert.match(source, /PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_TAG/);
  assert.match(source, /BOOTSTRAP_TAG_PATTERN/);
  assert.match(source, /url\.searchParams\.set\('tag', functionTag\)/);
  assert.match(source, /url\.searchParams\.set\('integration', 'async'\)/);
  assert.match(source, /statusCode === 202/);
  assert.match(source, /INITIAL_BOOTSTRAP_ASYNC_ACCEPTED/);
  assert.doesNotMatch(source, /INITIAL_BOOTSTRAP_COMMITTED/);
  assert.doesNotMatch(source, /JSON\.parse/);
  assert.doesNotMatch(source, /retry/i);
  assert.doesNotMatch(source, /ymq/i);
});
