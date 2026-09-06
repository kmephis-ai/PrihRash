import test from 'node:test';
import assert from 'node:assert/strict';
import { createMigrationRun } from '../../dist/migration/migrationRunState.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  evaluateInitialValidation,
} from '../../dist/migration/initialValidationGate.js';

const RUN_ID = '00000000-0000-0000-0000-000000000971';

function run(overrides = {}) {
  return Object.freeze({
    ...createMigrationRun({
      id: RUN_ID,
      startedAt: '2026-09-06T21:10:00Z',
      sourceSnapshotDigest: 'synthetic-snapshot-digest',
      counters: { rowsSeen: 5, rowsNew: 5, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 2 },
    }),
    ...overrides,
  });
}

function projection(counterOverrides = {}, outcomeCount = 5) {
  return {
    outcomes: Array.from({ length: outcomeCount }, (_, sourceOrdinal) => ({ sourceOrdinal })),
    counters: {
      rowsSeen: 5,
      financialRecords: 2,
      legacyPeriodClose: 1,
      nonFinancial: 0,
      invalid: 0,
      ambiguous: 2,
      transactionCandidates: 2,
      projectionFailures: 0,
      ...counterOverrides,
    },
  };
}

function reconciliation(overrides = {}) {
  return {
    checks: Object.fromEntries(INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED'])),
    unexplainedHighImpactMismatchCount: 0,
    ...overrides,
  };
}

function blockerCodes(result) {
  assert.equal(result.ok, false);
  return result.blockers.map((item) => item.code);
}

test('honestly classified AMBIGUOUS rows may validate when all reconciliation checks match', () => {
  const result = evaluateInitialValidation(run(), projection(), reconciliation());

  assert.equal(result.ok, true);
  assert.equal(result.validatedRun.state, 'VALIDATED');
  assert.equal(result.validatedRun.rowsAmbiguous, 2);
  assert.equal(result.validatedRun.finishedAt, null);
  assert.equal(Object.isFrozen(result.validatedRun), true);
});

test('INVALID rows block validation even when aggregate reconciliation statuses say matched', () => {
  const result = evaluateInitialValidation(
    run({ rowsAmbiguous: 1 }),
    projection({ invalid: 1, ambiguous: 1 }),
    reconciliation(),
  );
  assert.equal(blockerCodes(result).includes('INVALID_ROWS_PRESENT'), true);
});

test('projection failures and incomplete financial coverage both block validation', () => {
  const result = evaluateInitialValidation(
    run(),
    projection({ transactionCandidates: 1, projectionFailures: 1 }),
    reconciliation(),
  );
  const codes = blockerCodes(result);
  assert.equal(codes.includes('PROJECTION_FAILURES_PRESENT'), true);
  assert.equal(codes.includes('TRANSACTION_COVERAGE_MISMATCH'), true);
});

test('run must contain the refined projection row and ambiguity counters', () => {
  const result = evaluateInitialValidation(
    run({ rowsSeen: 6, rowsNew: 6, rowsAmbiguous: 1 }),
    projection(),
    reconciliation(),
  );
  const codes = blockerCodes(result);
  assert.equal(codes.includes('RUN_ROW_COUNT_MISMATCH'), true);
  assert.equal(codes.includes('RUN_AMBIGUOUS_COUNT_MISMATCH'), true);
});

test('non-STAGING or non-initial run cannot pass the initial gate', () => {
  const result = evaluateInitialValidation(
    run({ state: 'VALIDATED', rowsChanged: 1 }),
    projection(),
    reconciliation(),
  );
  const codes = blockerCodes(result);
  assert.equal(codes.includes('RUN_NOT_STAGING'), true);
  assert.equal(codes.includes('INITIAL_RUN_COUNTERS_INCONSISTENT'), true);
});

test('projection counter corruption fails closed before lifecycle transition', () => {
  const result = evaluateInitialValidation(
    run(),
    projection({ financialRecords: -1, ambiguous: 5 }, 4),
    reconciliation(),
  );
  assert.equal(blockerCodes(result).includes('PROJECTION_COUNTERS_INCONSISTENT'), true);
});

test('every mandatory reconciliation dimension must be explicitly MATCHED', () => {
  for (const status of ['MISMATCH', 'NOT_CHECKED']) {
    const checks = reconciliation().checks;
    const result = evaluateInitialValidation(
      run(),
      projection(),
      reconciliation({ checks: { ...checks, ACCOUNT_AGGREGATES: status } }),
    );
    assert.deepEqual(result.blockers.find((item) => item.code === 'RECONCILIATION_CHECK_NOT_MATCHED'), {
      code: 'RECONCILIATION_CHECK_NOT_MATCHED',
      check: 'ACCOUNT_AGGREGATES',
    });
  }
});

test('unexplained high-impact mismatch blocks validation while malformed evidence fails closed', () => {
  const mismatch = evaluateInitialValidation(
    run(),
    projection(),
    reconciliation({ unexplainedHighImpactMismatchCount: 1 }),
  );
  assert.equal(blockerCodes(mismatch).includes('UNEXPLAINED_HIGH_IMPACT_MISMATCH'), true);

  const malformed = evaluateInitialValidation(
    run(),
    projection(),
    reconciliation({ unexplainedHighImpactMismatchCount: -1 }),
  );
  assert.equal(blockerCodes(malformed).includes('INVALID_RECONCILIATION_EVIDENCE'), true);
});
