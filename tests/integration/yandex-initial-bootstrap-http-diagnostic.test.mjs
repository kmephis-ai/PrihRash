import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap-http-diagnostic.mjs');
const FETCH_MOCK = resolve(ROOT, 'tests/fixtures/mock-yandex-function-fetch.mjs');
const FUNCTION_ID = 'synthetic-bootstrap-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function runDiagnostic({ body, status = 502, functionError = true }) {
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_OPTIONS: `--import=${pathToFileURL(FETCH_MOCK).href}`,
    PRIHRASH_TEST_FUNCTION_ID: FUNCTION_ID,
    PRIHRASH_TEST_FETCH_BODY: body,
    PRIHRASH_TEST_FETCH_STATUS: String(status),
    PRIHRASH_TEST_FETCH_MODE: 'response',
    PRIHRASH_TEST_FUNCTION_ERROR: functionError ? 'true' : 'false',
    PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID,
    YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
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

function assertBounded(result, diagnostic) {
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
    httpStatus: 'HTTP_502',
    functionError: 'PRESENT',
  });
  assert.equal(result.stderr.trim(), diagnostic);
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('502 function error classifies Node heap exhaustion without exposing provider error text', async () => {
  const result = await runDiagnostic({
    body: JSON.stringify({
      errorType: 'Error',
      errorMessage: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory ${PRIVATE_LOOKING}`,
      stackTrace: [PRIVATE_LOOKING],
    }),
  });
  assertBounded(result, 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_NODE_HEAP_OOM');
});

test('502 proxy integration and standard Node error types are reduced to allowlisted enums', async () => {
  const proxy = await runDiagnostic({
    body: JSON.stringify({
      errorType: 'ProxyIntegrationError',
      errorMessage: `Malformed serverless function response ${PRIVATE_LOOKING}`,
      payload: PRIVATE_LOOKING,
    }),
  });
  assertBounded(proxy, 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_PROXY_INTEGRATION');

  const typeError = await runDiagnostic({
    body: JSON.stringify({ errorType: 'TypeError', errorMessage: PRIVATE_LOOKING }),
  });
  assertBounded(typeError, 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_NODE_TYPE_ERROR');
});

test('unknown or malformed 502 bodies fail closed to non-sensitive diagnostic buckets', async () => {
  const unknown = await runDiagnostic({
    body: JSON.stringify({ errorType: PRIVATE_LOOKING, errorMessage: PRIVATE_LOOKING }),
  });
  assertBounded(unknown, 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_OTHER');

  const malformed = await runDiagnostic({ body: PRIVATE_LOOKING });
  assertBounded(malformed, 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_BODY_INVALID');
});

test('diagnostic wrapper does not inspect non-502 responses', async () => {
  const result = await runDiagnostic({
    status: 500,
    body: JSON.stringify({ errorType: 'TypeError', errorMessage: PRIVATE_LOOKING }),
  });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
    httpStatus: 'HTTP_500',
    functionError: 'PRESENT',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
});
