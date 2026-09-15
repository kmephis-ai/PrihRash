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

async function runInvoker({
  body = '',
  status = 200,
  functionError = false,
  mode = 'response',
  includeFunctionId = true,
  includeIamToken = true,
} = {}) {
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_OPTIONS: `--import=${pathToFileURL(FETCH_MOCK).href}`,
    PRIHRASH_TEST_FUNCTION_ID: FUNCTION_ID,
    PRIHRASH_TEST_FETCH_BODY: body,
    PRIHRASH_TEST_FETCH_STATUS: String(status),
    PRIHRASH_TEST_FETCH_MODE: mode,
    PRIHRASH_TEST_FUNCTION_ERROR: functionError ? 'true' : 'false',
    ...(includeFunctionId ? { PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID } : {}),
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

test('safe bootstrap invoker uses private HTTPS raw integration and accepts exact COMMITTED result', async () => {
  const result = await runInvoker({
    body: JSON.stringify({ status: 'PASS', code: 'INITIAL_BOOTSTRAP_COMMITTED' }),
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
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE',
      applicationPhase: null,
      metadataFailureCode: null,
    },
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_FUNCTION_MODULE_LOAD_FAILED',
      applicationPhase: null,
      metadataFailureCode: null,
    },
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_FUNCTION_HANDLER_UNCAUGHT',
      applicationPhase: null,
      metadataFailureCode: null,
    },
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_METADATA_FAILED',
      applicationPhase: 'FRESH_CLAIM_WRITE',
      metadataFailureCode: 'METADATA_EXECUTOR_RUN_READBACK_MISMATCH',
    },
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_METADATA_FAILED',
      applicationPhase: 'FRESH_CLAIM_WRITE',
      metadataFailureCode: 'METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTENT_READBACK_MISMATCH',
    },
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_METADATA_FAILED',
      applicationPhase: 'FRESH_CLAIM_WRITE',
      metadataFailureCode: 'IDENTITY_MANIFEST_MALFORMED_BINDINGS_PAYLOAD',
    },
  ];

  for (const value of values) {
    const result = await runInvoker({ body: JSON.stringify(value) });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, value);
  }
});

test('all structural manifest parser diagnostics are accepted only as enum-only metadata failures', async () => {
  const codes = [
    'IDENTITY_MANIFEST_MALFORMED_ROW_CARDINALITY',
    'IDENTITY_MANIFEST_MALFORMED_BINDINGS_PAYLOAD',
    'IDENTITY_MANIFEST_MALFORMED_BINDING_ENTRY',
    'IDENTITY_MANIFEST_MALFORMED_BINDING_SET',
    'IDENTITY_MANIFEST_MALFORMED_BINDING_COUNT',
    'IDENTITY_MANIFEST_MALFORMED_SNAPSHOT_ROW_COUNT',
    'IDENTITY_MANIFEST_MALFORMED_RUN_STATE',
    'IDENTITY_MANIFEST_MALFORMED_MIGRATION_RUN_ID',
    'IDENTITY_MANIFEST_MALFORMED_SOURCE_SNAPSHOT_ID',
    'IDENTITY_MANIFEST_MALFORMED_SOURCE_SNAPSHOT_DIGEST',
    'IDENTITY_MANIFEST_MALFORMED_RUN_SNAPSHOT_DIGEST',
    'IDENTITY_MANIFEST_MALFORMED_SNAPSHOT_DIGEST'
  ];
  for (const metadataFailureCode of codes) {
    const value = {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_METADATA_FAILED',
      applicationPhase: 'FRESH_CLAIM_WRITE',
      metadataFailureCode,
    };
    const result = await runInvoker({ body: JSON.stringify(value) });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, value);
  }
});

test('malformed, extra-field and non-allowlisted successful response bodies fail closed without echo', async () => {
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
    JSON.stringify({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'PRIVATE_RUNTIME_CODE',
      applicationPhase: null,
      metadataFailureCode: null,
    }),
  ];

  for (const body of outputs) {
    const result = await runInvoker({ body });
    assert.equal(result.exitCode, 2);
    assertSafeOutput(result, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID' });
  }
});

test('transport timeout and generic transport failure remain bounded and private', async () => {
  const timeout = await runInvoker({ mode: 'timeout', body: PRIVATE_LOOKING });
  assert.equal(timeout.exitCode, 2);
  assertSafeOutput(timeout, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT' });

  const failure = await runInvoker({ mode: 'failure', body: PRIVATE_LOOKING });
  assert.equal(failure.exitCode, 2);
  assertSafeOutput(failure, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKE_FAILED' });
});

test('missing function id or IAM token fails before any invocation', async () => {
  const missingFunction = await runInvoker({ includeFunctionId: false, body: PRIVATE_LOOKING });
  assert.equal(missingFunction.exitCode, 2);
  assertSafeOutput(missingFunction, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID' });

  const missingToken = await runInvoker({ includeIamToken: false, body: PRIVATE_LOOKING });
  assert.equal(missingToken.exitCode, 2);
  assertSafeOutput(missingToken, { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID' });
});
