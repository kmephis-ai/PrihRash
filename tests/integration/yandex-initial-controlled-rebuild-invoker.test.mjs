import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-controlled-rebuild.mjs');
const FETCH_MOCK = resolve(ROOT, 'tests/fixtures/mock-yandex-function-fetch.mjs');
const FUNCTION_ID = 'synthetic-controlled-rebuild-function-id';
const PRIVATE_LOOKING = 'private-sheet grpcs://private-ydb private-token 12345';

async function runInvoker({
  body = '',
  status = 200,
  mode = 'response',
  functionId = true,
  token = true,
  invokeMode = 'sync',
  functionError = false,
} = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_OPTIONS: `--import=${pathToFileURL(FETCH_MOCK).href}`,
    PRIHRASH_TEST_FUNCTION_ID: FUNCTION_ID,
    PRIHRASH_TEST_FUNCTION_TAG: 'r1-initial-controlled-rebuild',
    PRIHRASH_TEST_FUNCTION_INTEGRATION: invokeMode === 'async' ? 'async' : 'raw',
    PRIHRASH_TEST_FETCH_BODY: body,
    PRIHRASH_TEST_FETCH_STATUS: String(status),
    PRIHRASH_TEST_FETCH_MODE: mode,
    PRIHRASH_TEST_FUNCTION_ERROR: functionError ? 'true' : 'false',
    ...(functionId ? { PRIHRASH_YANDEX_INITIAL_CONTROLLED_REBUILD_FUNCTION_ID: FUNCTION_ID } : {}),
    ...(token ? { YC_IAM_TOKEN: 'synthetic-short-lived-iam-token' } : {}),
    PRIHRASH_INITIAL_CONTROLLED_REBUILD_INVOKE_MODE: invokeMode,
  };
  try {
    const result = await execFileAsync(process.execPath, [INVOKER], { cwd: ROOT, env, encoding: 'utf8' });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    };
  }
}

function assertSafe(result, expected) {
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('controlled rebuild invoker accepts only exact COMMITTED PASS', async () => {
  const expected = { status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_COMMITTED' };
  const result = await runInvoker({ body: JSON.stringify(expected) });
  assert.equal(result.exitCode, 0);
  assertSafe(result, expected);
});

test('controlled rebuild invoker preserves bounded STOP and runtime enum results', async () => {
  const values = [
    ...['RESUME_IDENTITY_MANIFEST_READ', 'RESUME_SNAPSHOT_READ', 'RECONCILIATION_READ'].map((bootstrapPhase) => ({
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED', phase: 'PREPARATION', bootstrapPhase,
    })),
    {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED', phase: 'PREPARATION', bootstrapPhase: 'RECONCILIATION_READ',
      applicationFailureCode: 'YDB_DATA_QUERY_EXECUTION_YDB_TIMEOUT',
    },
    {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED', phase: 'PREPARATION', bootstrapPhase: 'RECONCILIATION_READ',
      applicationFailureCode: 'REVISION_EVIDENCE_EXISTING_REVISION_MISMATCH',
    },
    { status: 'NOOP', code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' },
    { status: 'STOP', code: 'INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED', recoveryReason: 'SWAP_OUTCOME_AMBIGUOUS' },
    {
      status: 'STOP', code: 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED',
      blockers: [{ code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'TOTALS_BY_TYPE' }],
    },
    {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED', phase: 'PREPARATION', bootstrapPhase: 'RESUME_CONTEXT_READ',
    },
    {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED', phase: 'SWAP_MUTATION', bootstrapPhase: null,
    },
    {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'MODULE_LOAD_FAILED', phase: null,
    },
  ];
  for (const value of values) {
    const result = await runInvoker({ body: JSON.stringify(value) });
    assert.equal(result.exitCode, 2);
    assertSafe(result, value);
  }
});

test('controlled rebuild invoker accepts async dispatch only on HTTP 202 and never treats it as COMMITTED', async () => {
  const accepted = await runInvoker({
    invokeMode: 'async',
    status: 202,
    body: PRIVATE_LOOKING,
  });
  assert.equal(accepted.exitCode, 0);
  assertSafe(accepted, {
    status: 'PASS',
    code: 'INITIAL_CONTROLLED_REBUILD_ASYNC_ACCEPTED',
  });

  const wrongStatus = await runInvoker({
    invokeMode: 'async',
    status: 200,
    body: JSON.stringify({ status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_COMMITTED' }),
  });
  assert.equal(wrongStatus.exitCode, 2);
  assertSafe(wrongStatus, {
    status: 'FAIL',
    code: 'INITIAL_CONTROLLED_REBUILD_HTTP_FAILED',
    httpStatus: 'HTTP_OTHER',
  });
});

test('controlled rebuild invoker rejects extra/private fields and unknown enums without echo', async () => {
  for (const body of [
    PRIVATE_LOOKING,
    JSON.stringify({ status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_COMMITTED', private: PRIVATE_LOOKING }),
    JSON.stringify({ status: 'STOP', code: 'INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED', recoveryReason: PRIVATE_LOOKING }),
    JSON.stringify({
      status: 'FAIL',
      code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED',
      phase: 'PREPARATION',
      bootstrapPhase: 'PRIVATE_PHASE',
    }),
    JSON.stringify({
      status: 'FAIL',
      code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED',
      phase: 'PREPARATION',
      bootstrapPhase: 'RECONCILIATION_READ',
      applicationFailureCode: PRIVATE_LOOKING,
    }),
    JSON.stringify({
      status: 'FAIL',
      code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED',
      phase: 'CURRENT_WRITE_PREPARATION',
      bootstrapPhase: 'RECONCILIATION_READ',
      applicationFailureCode: 'YDB_DATA_QUERY_EXECUTION_YDB_TIMEOUT',
    }),
  ]) {
    const result = await runInvoker({ body });
    assert.equal(result.exitCode, 2);
    assertSafe(result, { status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKE_OUTPUT_INVALID' });
  }
});

test('controlled rebuild invoker bounds transport and config failures', async () => {
  const timeout = await runInvoker({ mode: 'timeout', body: PRIVATE_LOOKING });
  assert.equal(timeout.exitCode, 2);
  assertSafe(timeout, { status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKE_FUNCTION_TIMEOUT' });

  const missing = await runInvoker({ functionId: false });
  assert.equal(missing.exitCode, 2);
  assertSafe(missing, { status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_INVOKER_CONFIG_INVALID' });

  const http = await runInvoker({ status: 503, body: PRIVATE_LOOKING });
  assert.equal(http.exitCode, 2);
  assertSafe(http, {
    status: 'FAIL',
    code: 'INITIAL_CONTROLLED_REBUILD_HTTP_FAILED',
    httpStatus: 'HTTP_503',
    functionError: 'ABSENT',
  });

  const functionError = await runInvoker({
    status: 502,
    body: PRIVATE_LOOKING,
    functionError: true,
  });
  assert.equal(functionError.exitCode, 2);
  assertSafe(functionError, {
    status: 'FAIL',
    code: 'INITIAL_CONTROLLED_REBUILD_HTTP_FAILED',
    httpStatus: 'HTTP_502',
    functionError: 'PRESENT',
  });
});
