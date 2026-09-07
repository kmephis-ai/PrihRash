import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_RECONCILIATION_CHECKS,
} from '../../dist/migration/initialValidationGate.js';
import {
  evaluateIncrementalValidation,
} from '../../dist/migration/incrementalValidationGate.js';
import { id } from './incremental-source-current-candidate-fixtures.mjs';

function run(overrides = {}) {
  return Object.freeze({
    id: id(500),
    startedAt: '2026-09-07T08:20:00.000Z',
    finishedAt: null,
    sourceSnapshotDigest: 'snapshot-digest',
    state: 'STAGING',
    rowsSeen: 5,
    rowsNew: 1,
    rowsChanged: 1,
    rowsMissing: 1,
    rowsAmbiguous: 2,
    errorCode: null,
    ...overrides,
  });
}

function sourceDelta(overrides = {}) {
  return Object.freeze({
    intents: Object.freeze([
      Object.freeze({ kind: 'TOUCH', sourceRecordId: id(1), expectedRevision: 1, expectedDigest: 'a', previousRowHint: 10, currentRowHint: 11, observedAt: '2026-09-07T08:20:00.000Z' }),
      Object.freeze({ kind: 'CREATE', sourceRecordId: id(2), currentRevision: 1, currentDigest: 'b', currentRowHint: 21, observedAt: '2026-09-07T08:20:00.000Z' }),
      Object.freeze({ kind: 'REVISE', sourceRecordId: id(3), expectedPreviousRevision: 2, expectedPreviousDigest: 'c', previousRowHint: 30, currentRevision: 3, currentDigest: 'd', currentRowHint: 31, observedAt: '2026-09-07T08:20:00.000Z' }),
      Object.freeze({ kind: 'MARK_MISSING', sourceRecordId: id(4), expectedRevision: 1, expectedDigest: 'e', previousRowHint: 40 }),
    ]),
    unresolvedBlocks: Object.freeze([
      Object.freeze({ previousSourceRecordIds: Object.freeze([id(5)]), previousRowHints: Object.freeze([50]), currentRowHints: Object.freeze([51, 52]) }),
    ]),
    ...overrides,
  });
}

function evidence(overrides = {}) {
  const checks = Object.fromEntries(INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED']));
  return Object.freeze({
    checks: Object.freeze({ ...checks, ...(overrides.checks ?? {}) }),
    unexplainedHighImpactMismatchCount: overrides.unexplainedHighImpactMismatchCount ?? 0,
  });
}

const expected = Object.freeze({
  sourceRecordCount: 0,
  transactionCount: 0,
  typeAggregates: Object.freeze([]),
  categoryAggregates: Object.freeze([]),
  accountAggregates: Object.freeze([]),
  classificationCounts: Object.freeze({ FINANCIAL_RECORD: 0, LEGACY_PERIOD_CLOSE: 0, NON_FINANCIAL: 0, INVALID: 0, AMBIGUOUS: 0 }),
  missingSourceRecordCount: 0,
});

const reconciliationPlan = (blocker = null) => Object.freeze({ expected, promotionBlocker: blocker });
const currentDelta = (blocker = null) => Object.freeze({ sourceIntents: Object.freeze([]), transactionIntents: Object.freeze([]), promotionBlocker: blocker });

test('validates an exact incremental STAGING run using deterministic lineage counters and matched reconciliation', () => {
  const result = evaluateIncrementalValidation(run(), sourceDelta(), reconciliationPlan(), evidence(), currentDelta());
  assert.equal(result.ok, true);
  assert.equal(result.validatedRun.state, 'VALIDATED');
  assert.equal(result.validatedRun.finishedAt, null);
  assert.equal(result.validatedRun.errorCode, null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.validatedRun), true);
});

test('counter mismatch blocks validation without mutating the run', () => {
  const original = run({ rowsChanged: 2 });
  const result = evaluateIncrementalValidation(original, sourceDelta(), reconciliationPlan(), evidence(), currentDelta());
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers.filter((item) => item.code === 'RUN_COUNTER_MISMATCH'), [
    { code: 'RUN_COUNTER_MISMATCH', counter: 'rowsChanged' },
  ]);
  assert.equal(original.state, 'STAGING');
});

test('duplicate current row hints across deterministic and unresolved evidence fail closed', () => {
  const malformed = sourceDelta({
    unresolvedBlocks: Object.freeze([
      Object.freeze({ previousSourceRecordIds: Object.freeze([id(5)]), previousRowHints: Object.freeze([50]), currentRowHints: Object.freeze([31]) }),
    ]),
  });
  const result = evaluateIncrementalValidation(run(), malformed, reconciliationPlan(), evidence(), currentDelta());
  assert.equal(result.ok, false);
  assert.equal(result.blockers.some((item) => item.code === 'INVALID_LINEAGE_COUNTER_EVIDENCE'), true);
});

test('unresolved lineage promotion blocker prevents VALIDATED even with matched reconciliation', () => {
  const result = evaluateIncrementalValidation(
    run(), sourceDelta(), reconciliationPlan('UNRESOLVED_LINEAGE'), evidence(), currentDelta('UNRESOLVED_LINEAGE'),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, [
    { code: 'PROMOTION_BLOCKED', promotionBlocker: 'UNRESOLVED_LINEAGE' },
  ]);
});

test('reconciliation mismatch and high-impact mismatch both block validation', () => {
  const result = evaluateIncrementalValidation(
    run(),
    sourceDelta(),
    reconciliationPlan(),
    evidence({ checks: { TOTALS_BY_TYPE: 'MISMATCH' }, unexplainedHighImpactMismatchCount: 1 }),
    currentDelta(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.blockers.some((item) => item.code === 'UNEXPLAINED_HIGH_IMPACT_MISMATCH'), true);
  assert.deepEqual(result.blockers.find((item) => item.code === 'RECONCILIATION_CHECK_NOT_MATCHED'), {
    code: 'RECONCILIATION_CHECK_NOT_MATCHED', check: 'TOTALS_BY_TYPE',
  });
});

test('non-STAGING run and promotion blocker disagreement fail closed', () => {
  const result = evaluateIncrementalValidation(
    run({ state: 'VALIDATED' }), sourceDelta(), reconciliationPlan('UNRESOLVED_LINEAGE'), evidence(), currentDelta(null),
  );
  assert.equal(result.ok, false);
  assert.equal(result.blockers.some((item) => item.code === 'RUN_NOT_STAGING'), true);
  assert.equal(result.blockers.some((item) => item.code === 'PROMOTION_BLOCKER_MISMATCH'), true);
});
