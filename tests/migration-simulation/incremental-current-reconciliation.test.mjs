import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareControlledRebuildStagingReconciliation,
} from '../../dist/migration/initialControlledRebuildReconciliation.js';
import {
  IncrementalCurrentReconciliationError,
  buildExpectedIncrementalCurrentReconciliation,
} from '../../dist/migration/incrementalCurrentReconciliation.js';
import { id, transaction } from './incremental-source-current-candidate-fixtures.mjs';

function income(amountMinor) {
  return Object.freeze({
    ...transaction(amountMinor),
    type: 'INCOME',
    fromAccountId: null,
    toAccountId: id(9101),
    categoryId: id(9102),
  });
}

test('incremental candidates use the shared exact reconciliation snapshot/comparator', () => {
  const sourcePlan = Object.freeze({
    sourceRecords: Object.freeze([
      Object.freeze({ classification: 'FINANCIAL_RECORD', state: null }),
      Object.freeze({ classification: 'FINANCIAL_RECORD', state: 'MISSING' }),
      Object.freeze({ classification: 'AMBIGUOUS', state: null }),
      Object.freeze({ classification: 'LEGACY_PERIOD_CLOSE', state: null }),
    ]),
    promotionBlocker: 'UNRESOLVED_LINEAGE',
    unresolvedRowHints: Object.freeze([77]),
  });
  const transactionPlan = Object.freeze({
    transactions: Object.freeze([
      Object.freeze({ id: id(101), transaction: transaction(1200), version: 2 }),
      Object.freeze({ id: id(102), transaction: income(3400), version: 1 }),
      Object.freeze({ id: id(199), transaction: transaction(500), version: 7 }),
    ]),
    promotionBlocker: 'UNRESOLVED_LINEAGE',
  });

  const result = buildExpectedIncrementalCurrentReconciliation(sourcePlan, transactionPlan);
  assert.equal(result.promotionBlocker, 'UNRESOLVED_LINEAGE');
  assert.equal(result.expected.sourceRecordCount, 4);
  assert.equal(result.expected.transactionCount, 3);
  assert.equal(result.expected.classificationCounts.FINANCIAL_RECORD, 2);
  assert.equal(result.expected.classificationCounts.AMBIGUOUS, 1);
  assert.equal(result.expected.classificationCounts.LEGACY_PERIOD_CLOSE, 1);
  assert.equal(result.expected.missingSourceRecordCount, 1);
  assert.deepEqual(result.expected.typeAggregates, [
    { type: 'EXPENSE', count: 2, totalAmountMinor: 1700n },
    { type: 'INCOME', count: 1, totalAmountMinor: 3400n },
  ]);

  const evidence = compareControlledRebuildStagingReconciliation(result.expected, result.expected);
  assert.equal(evidence.unexplainedHighImpactMismatchCount, 0);
  assert.equal(Object.values(evidence.checks).every((value) => value === 'MATCHED'), true);
});

test('promotion blocker mismatch between source and transaction candidates fails closed', () => {
  assert.throws(
    () => buildExpectedIncrementalCurrentReconciliation(
      Object.freeze({ sourceRecords: Object.freeze([]), promotionBlocker: 'UNRESOLVED_LINEAGE', unresolvedRowHints: Object.freeze([1]) }),
      Object.freeze({ transactions: Object.freeze([]), promotionBlocker: null }),
    ),
    (error) => error instanceof IncrementalCurrentReconciliationError && error.code === 'PROMOTION_BLOCKER_MISMATCH',
  );
});
