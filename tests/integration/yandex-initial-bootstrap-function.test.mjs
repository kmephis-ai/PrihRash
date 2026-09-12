import assert from 'node:assert/strict';
import test from 'node:test';

import { InitialBootstrapPrivateEvidenceError } from '../../dist/migration/initialBootstrapPrivateEvidence.js';
import { InitialBootstrapJobError } from '../../dist/runtime/initialBootstrapJob.js';
import {
  executeYandexInitialBootstrapFunction,
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
