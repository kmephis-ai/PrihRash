import assert from 'node:assert/strict';
import test from 'node:test';

import { InitialBootstrapPrivateEvidenceError } from '../../dist/migration/initialBootstrapPrivateEvidence.js';
import {
  InitialBootstrapReferenceAwareRuntimeError,
} from '../../dist/runtime/initialBootstrapReferenceAwareJob.js';
import { InitialBootstrapJobError } from '../../dist/runtime/initialBootstrapJob.js';
import {
  createInitialBootstrapExecutionBudgetFromYandexContext,
  executeYandexInitialBootstrapFunction,
  INITIAL_BOOTSTRAP_REVISION_EVIDENCE_MIN_REMAINING_MS,
} from '../../dist/runtime/yandexCloudInitialBootstrapFunction.js';

const ENV = Object.freeze({
  PRIHRASH_GOOGLE_SPREADSHEET_ID: 'synthetic-sheet-id',
});

async function execute(resultOrError) {
  return executeYandexInitialBootstrapFunction(ENV, async (environment) => {
    assert.equal(environment, ENV);
    if (resultOrError instanceof Error) throw resultOrError;
    return resultOrError;
  });
}

test('committed result is reduced to exact PASS without run or financial/provider fields', async () => {
  const result = await execute({
    status: 'COMMITTED',
    run: { id: 'private-id', rowsSeen: 999, sourceSnapshotDigest: 'private-digest' },
    rawPayload: { private: true },
  });

  assert.deepEqual(result, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_COMMITTED',
  });
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('validation blocked transports only allowlisted blocker taxonomy', async () => {
  const result = await execute({
    status: 'VALIDATION_BLOCKED',
    run: { id: 'private-id' },
    blockers: [
      { code: 'INVALID_ROWS_PRESENT', amount: 12345 },
      {
        code: 'RECONCILIATION_CHECK_NOT_MATCHED',
        check: 'TOTALS_BY_TYPE',
        privateDetail: 'do-not-return',
      },
    ],
  });

  assert.deepEqual(result, {
    status: 'STOP',
    code: 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED',
    blockers: [
      { code: 'INVALID_ROWS_PRESENT' },
      { code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'TOTALS_BY_TYPE' },
    ],
  });
  assert.equal(JSON.stringify(result).includes('12345'), false);
  assert.equal(JSON.stringify(result).includes('do-not-return'), false);
});

test('baseline, controlled rebuild and recovery outcomes remain non-success bounded results', async () => {
  assert.deepEqual(await execute({ status: 'BASELINE_EXISTS', run: { id: 'private' } }), {
    status: 'NOOP',
    code: 'INITIAL_BOOTSTRAP_BASELINE_EXISTS',
  });
  assert.deepEqual(await execute({
    status: 'CONTROLLED_REBUILD_REQUIRED',
    preflight: { candidateRows: 999999, cap: 1 },
  }), {
    status: 'STOP',
    code: 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED',
  });
  assert.deepEqual(await execute({
    status: 'RECOVERY_REQUIRED',
    reason: 'PROMOTION_OUTCOME_UNKNOWN',
    run: { id: 'private' },
  }), {
    status: 'STOP',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
    recoveryReason: 'PROMOTION_OUTCOME_UNKNOWN',
  });
  assert.deepEqual(await execute({
    status: 'RECOVERY_REQUIRED',
    reason: 'REVISION_EVIDENCE_RUNTIME_BUDGET_EXHAUSTED',
    run: { id: 'private' },
  }), {
    status: 'STOP',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED',
    recoveryReason: 'REVISION_EVIDENCE_RUNTIME_BUDGET_EXHAUSTED',
  });
});

test('Yandex remaining-time context gates only new revision evidence batches', () => {
  let remaining = INITIAL_BOOTSTRAP_REVISION_EVIDENCE_MIN_REMAINING_MS;
  const context = {
    getRemainingTimeInMillis() { return remaining; },
  };
  const budget = createInitialBootstrapExecutionBudgetFromYandexContext(context);
  assert.notEqual(budget, null);
  assert.equal(budget.canStartRevisionEvidenceBatch(), true);
  remaining -= 1;
  assert.equal(budget.canStartRevisionEvidenceBatch(), false);
  assert.equal(createInitialBootstrapExecutionBudgetFromYandexContext({}), null);
});

test('malformed or unknown application result fails closed without echoing input', async () => {
  const malformedRecovery = await execute({
    status: 'RECOVERY_REQUIRED',
    reason: 'PRIVATE_UNKNOWN_REASON',
    secret: 'do-not-return',
  });
  assert.deepEqual(malformedRecovery, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RESULT_INVALID',
  });

  const malformedBlocker = await execute({
    status: 'VALIDATION_BLOCKED',
    blockers: [{ code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'PRIVATE_CHECK' }],
  });
  assert.deepEqual(malformedBlocker, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RESULT_INVALID',
  });

  assert.deepEqual(await execute({ status: 'PRIVATE_STATUS', raw: 'do-not-return' }), {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RESULT_INVALID',
  });
});

test('private evidence and job config failures collapse to one safe config code', async () => {
  assert.deepEqual(
    await execute(new InitialBootstrapPrivateEvidenceError('EVIDENCE_JSON_INVALID')),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_CONFIG_INVALID' },
  );
  assert.deepEqual(
    await execute(new InitialBootstrapJobError('INVALID_YDB_CONNECTION_STRING')),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_CONFIG_INVALID' },
  );
});

test('reference-aware runtime failures expose only the bounded runtime taxonomy', async () => {
  for (const runtimeCode of [
    'REFERENCE_RUNTIME_STATE_INVALID',
    'REFERENCE_BOOTSTRAP_RESUME_UNSAFE',
    'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE',
    'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
  ]) {
    assert.deepEqual(
      await execute(new InitialBootstrapReferenceAwareRuntimeError(runtimeCode)),
      {
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
        runtimeCode,
        applicationPhase: null,
        metadataFailureCode: null,
      },
    );
  }

  assert.deepEqual(
    await execute(new InitialBootstrapReferenceAwareRuntimeError(
      'REFERENCE_APPLICATION_METADATA_FAILED',
      'FRESH_CLAIM_WRITE',
      'METADATA_EXECUTOR_RUN_READBACK_MISMATCH',
    )),
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_METADATA_FAILED',
      applicationPhase: 'FRESH_CLAIM_WRITE',
      metadataFailureCode: 'METADATA_EXECUTOR_RUN_READBACK_MISMATCH',
    },
  );

  assert.deepEqual(
    await execute(new InitialBootstrapReferenceAwareRuntimeError(
      'REFERENCE_APPLICATION_YDB_DATA_FAILED',
      'REVISION_EVIDENCE_WRITE',
      null,
      'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    )),
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_YDB_DATA_FAILED',
      applicationPhase: 'REVISION_EVIDENCE_WRITE',
      metadataFailureCode: null,
      ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    },
  );

  const untrustedError = Object.assign(new Error('private provider error text'), {
    code: 'REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE',
  });
  assert.deepEqual(
    await execute(untrustedError),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED' },
  );
});

test('post-commit reconciliation mismatch is distinct while other errors stay generic', async () => {
  assert.deepEqual(
    await execute(new InitialBootstrapJobError('COMMITTED_RECONCILIATION_MISMATCH')),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED' },
  );
  assert.deepEqual(
    await execute(new InitialBootstrapJobError('YDB_CLIENT_CLOSE_FAILED')),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED' },
  );
  assert.deepEqual(
    await execute(new Error('private provider error text')),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED' },
  );
});
