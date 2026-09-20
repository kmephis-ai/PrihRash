import assert from 'node:assert/strict';
import test from 'node:test';
import { InitialBootstrapPrivateEvidenceError } from '../../dist/migration/initialBootstrapPrivateEvidence.js';
import { InitialBootstrapJobError } from '../../dist/runtime/initialBootstrapJob.js';
import { InitialControlledRebuildJobError } from '../../dist/runtime/initialControlledRebuildJob.js';
import {
  executeYandexInitialControlledRebuildFunction,
  executeYandexInitialControlledRebuildSwapRecoveryDiagnosticFunction,
  formatInitialControlledRebuildPhaseMarker,
} from '../../dist/runtime/yandexCloudInitialControlledRebuildFunction.js';

const ENV = Object.freeze({ PRIHRASH_GOOGLE_SPREADSHEET_ID: 'synthetic-sheet-id' });

test('controlled rebuild phase marker is bounded to a single enum token', () => {
  assert.equal(
    formatInitialControlledRebuildPhaseMarker('BOOTSTRAP_RECONCILIATION_READ'),
    'R1_CONTROLLED_PHASE:BOOTSTRAP_RECONCILIATION_READ',
  );
});
async function execute(value) {
  return executeYandexInitialControlledRebuildFunction(ENV, async (environment) => {
    assert.equal(environment, ENV);
    if (value instanceof Error) throw value;
    return value;
  });
}

async function executeSwapDiagnostic(value) {
  return executeYandexInitialControlledRebuildSwapRecoveryDiagnosticFunction(ENV, async (environment) => {
    assert.equal(environment, ENV);
    if (value instanceof Error) throw value;
    return value;
  });
}

test('controlled swap recovery diagnostic exposes only bounded verdict', async () => {
  assert.deepEqual(await executeSwapDiagnostic({
    status: 'CLASSIFIED', verdict: 'NOT_APPLIED', run: { id: 'private' }, raw: 'private',
  }), {
    status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED', verdict: 'NOT_APPLIED',
  });
  assert.deepEqual(await executeSwapDiagnostic({
    status: 'CLASSIFIED', verdict: 'APPLIED', run: { id: 'private' }, raw: 'private',
  }), {
    status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED', verdict: 'APPLIED',
  });
  assert.deepEqual(await executeSwapDiagnostic({
    status: 'CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RECONCILIATION_MISMATCH',
    run: { id: 'private' },
    raw: 'private',
  }), {
    status: 'STOP',
    code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    recoveryReason: 'STAGING_RECONCILIATION_MISMATCH',
  });
});

test('controlled swap recovery diagnostic preserves bounded runtime failure taxonomy', async () => {
  assert.deepEqual(
    await executeSwapDiagnostic(new InitialControlledRebuildJobError('APPLICATION_FAILED', 'STAGING_RECONCILIATION')),
    {
      status: 'FAIL',
      code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'APPLICATION_FAILED',
      phase: 'STAGING_RECONCILIATION',
    },
  );
  assert.deepEqual(
    await executeSwapDiagnostic(new InitialControlledRebuildJobError('SOURCE_READ_FAILED')),
    {
      status: 'FAIL',
      code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
      jobCode: 'SOURCE_READ_FAILED',
      phase: null,
    },
  );
});

test('controlled swap recovery diagnostic malformed result fails closed without echo', async () => {
  for (const value of [
    { status: 'CLASSIFIED', verdict: 'PRIVATE', private: 'do-not-return' },
    { status: 'CLASSIFIED', verdict: 'RECOVERY_REQUIRED', private: 'do-not-return' },
    { status: 'CLASSIFIED', verdict: 'RECOVERY_REQUIRED', reason: 'PRIVATE_REASON', private: 'do-not-return' },
  ]) {
    const result = await executeSwapDiagnostic(value);
    assert.deepEqual(result, {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED', jobCode: 'UNCAUGHT', phase: null,
    });
    assert.equal(JSON.stringify(result).includes('do-not-return'), false);
  }
});

test('controlled rebuild committed result is reduced to exact PASS', async () => {
  const result = await execute({ status: 'COMMITTED', run: { id: 'private', rowsSeen: 999 }, raw: 'private' });
  assert.deepEqual(result, { status: 'PASS', code: 'INITIAL_CONTROLLED_REBUILD_COMMITTED' });
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('controlled rebuild non-success outcomes expose only bounded taxonomy', async () => {
  assert.deepEqual(await execute({ status: 'BASELINE_EXISTS', run: { id: 'private' } }), {
    status: 'NOOP', code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS',
  });
  assert.deepEqual(await execute({ status: 'RECOVERY_REQUIRED', reason: 'SWAP_OUTCOME_AMBIGUOUS', private: 'x' }), {
    status: 'STOP', code: 'INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED', recoveryReason: 'SWAP_OUTCOME_AMBIGUOUS',
  });
  assert.deepEqual(await execute({
    status: 'VALIDATION_BLOCKED',
    blockers: [
      { code: 'INVALID_ROWS_PRESENT', private: 'x' },
      { code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'TOTALS_BY_TYPE', private: 'x' },
    ],
  }), {
    status: 'STOP',
    code: 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED',
    blockers: [
      { code: 'INVALID_ROWS_PRESENT' },
      { code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'TOTALS_BY_TYPE' },
    ],
  });
});

test('controlled rebuild malformed application result fails closed without echo', async () => {
  for (const value of [
    { status: 'RECOVERY_REQUIRED', reason: 'PRIVATE_REASON', private: 'do-not-return' },
    { status: 'VALIDATION_BLOCKED', blockers: [{ code: 'PRIVATE_BLOCKER' }], private: 'do-not-return' },
    { status: 'PRIVATE', private: 'do-not-return' },
  ]) {
    const result = await execute(value);
    assert.deepEqual(result, {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED', jobCode: 'UNCAUGHT', phase: null,
    });
    assert.equal(JSON.stringify(result).includes('do-not-return'), false);
  }
});

test('controlled rebuild runtime errors retain only job code and controlled phase', async () => {
  assert.deepEqual(
    await execute(new InitialControlledRebuildJobError('APPLICATION_FAILED', 'SWAP_MUTATION')),
    {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED', jobCode: 'APPLICATION_FAILED', phase: 'SWAP_MUTATION',
    },
  );
  assert.deepEqual(
    await execute(new Error('private provider text')),
    { status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED', jobCode: 'UNCAUGHT', phase: null },
  );
});

test('controlled rebuild config failures collapse to safe config enum', async () => {
  for (const error of [
    new InitialBootstrapPrivateEvidenceError('EVIDENCE_JSON_INVALID'),
    new InitialBootstrapJobError('INVALID_YDB_CONNECTION_STRING'),
  ]) {
    assert.deepEqual(await execute(error), {
      status: 'FAIL', code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED', jobCode: 'CONFIG_INVALID', phase: null,
    });
  }
});
