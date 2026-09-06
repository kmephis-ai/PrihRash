import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  InitialControlledRebuildReconciliationError,
} from '../../dist/migration/initialControlledRebuildReconciliation.js';

function source(id, classification, state = null) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T21:40:00Z',
    lastSeenAt: '2026-09-06T21:40:00Z',
    lastRowHint: 2,
    currentDigest: `synthetic-${id}`,
    state,
    classification,
    normalizationStatus: null,
    transactionId: classification === 'FINANCIAL_RECORD'
      ? id.replace('000000008', '000000009')
      : null,
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

function transactionCandidate(sourceRecordId, transactionId, transaction) {
  return Object.freeze({ sourceRecordId, transactionId, transaction: Object.freeze(transaction) });
}

function plan() {
  const expenseSource = '00000000-0000-0000-0000-000000008101';
  const incomeSource = '00000000-0000-0000-0000-000000008102';
  const expenseTx = '00000000-0000-0000-0000-000000009101';
  const incomeTx = '00000000-0000-0000-0000-000000009102';
  return Object.freeze({
    sourceRecords: Object.freeze([
      Object.freeze({ ...source(expenseSource, 'FINANCIAL_RECORD'), transactionId: expenseTx }),
      Object.freeze({ ...source(incomeSource, 'FINANCIAL_RECORD'), transactionId: incomeTx }),
      source('00000000-0000-0000-0000-000000008103', 'AMBIGUOUS'),
      source('00000000-0000-0000-0000-000000008104', 'LEGACY_PERIOD_CLOSE'),
      source('00000000-0000-0000-0000-000000008105', 'NON_FINANCIAL'),
    ]),
    transactions: Object.freeze([
      transactionCandidate(expenseSource, expenseTx, {
        type: 'EXPENSE', occurredOn: '2026-08-01', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
        aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
        amountMinor: 9007199254740000, currency: 'RUB',
        fromAccountId: '00000000-0000-0000-0000-000000008201', toAccountId: null,
        categoryId: '00000000-0000-0000-0000-000000008301', paidByMemberId: null,
        description: 'Synthetic expense', note: null, status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
      }),
      transactionCandidate(incomeSource, incomeTx, {
        type: 'INCOME', occurredOn: '2026-08-02', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
        aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
        amountMinor: 12345, currency: 'RUB',
        fromAccountId: null, toAccountId: '00000000-0000-0000-0000-000000008202',
        categoryId: '00000000-0000-0000-0000-000000008302', paidByMemberId: null,
        description: 'Synthetic income', note: null, status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
      }),
    ]),
  });
}

test('builds exact bigint aggregates with canonical expense/income account direction', () => {
  const expected = buildExpectedControlledRebuildReconciliation(plan());

  assert.equal(expected.sourceRecordCount, 5);
  assert.equal(expected.transactionCount, 2);
  assert.deepEqual(expected.classificationCounts, {
    FINANCIAL_RECORD: 2,
    LEGACY_PERIOD_CLOSE: 1,
    NON_FINANCIAL: 1,
    INVALID: 0,
    AMBIGUOUS: 1,
  });
  assert.deepEqual(expected.typeAggregates, [
    { type: 'EXPENSE', count: 1, totalAmountMinor: 9007199254740000n },
    { type: 'INCOME', count: 1, totalAmountMinor: 12345n },
  ]);
  assert.deepEqual(expected.accountAggregates.map((entry) => [entry.type, entry.dimensionId]), [
    ['EXPENSE', '00000000-0000-0000-0000-000000008201'],
    ['INCOME', '00000000-0000-0000-0000-000000008202'],
  ]);
  assert.equal(expected.missingSourceRecordCount, 0);
});

test('exact staging evidence produces only safe MATCHED reconciliation statuses', () => {
  const expected = buildExpectedControlledRebuildReconciliation(plan());
  const verdict = compareControlledRebuildStagingReconciliation(expected, expected);

  assert.equal(verdict.unexplainedHighImpactMismatchCount, 0);
  assert.equal(Object.values(verdict.checks).every((status) => status === 'MATCHED'), true);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(Object.isFrozen(verdict.checks), true);
});

test('amount mismatch is isolated to totals/dimension aggregates without exposing amount in verdict', () => {
  const expected = buildExpectedControlledRebuildReconciliation(plan());
  const observed = Object.freeze({
    ...expected,
    typeAggregates: Object.freeze(expected.typeAggregates.map((entry) => (
      entry.type === 'EXPENSE' ? Object.freeze({ ...entry, totalAmountMinor: entry.totalAmountMinor + 1n }) : entry
    ))),
  });
  const verdict = compareControlledRebuildStagingReconciliation(expected, observed);

  assert.equal(verdict.checks.TRANSACTION_COUNTS, 'MATCHED');
  assert.equal(verdict.checks.TOTALS_BY_TYPE, 'MISMATCH');
  assert.equal('typeAggregates' in verdict, false);
  assert.equal(verdict.unexplainedHighImpactMismatchCount, 1);
});

test('classification/missing mismatches remain explicit and honest ambiguity is allowed when exact', () => {
  const expected = buildExpectedControlledRebuildReconciliation(plan());
  const observed = Object.freeze({
    ...expected,
    classificationCounts: Object.freeze({ ...expected.classificationCounts, AMBIGUOUS: 2 }),
    missingSourceRecordCount: 1,
  });
  const verdict = compareControlledRebuildStagingReconciliation(expected, observed);

  assert.equal(verdict.checks.CLASSIFICATION_COUNTS, 'MISMATCH');
  assert.equal(verdict.checks.INVALID_AMBIGUOUS_MISSING_COUNTS, 'MISMATCH');
  assert.equal(verdict.checks.LEGACY_PERIOD_CLOSE_COUNT, 'MATCHED');
});

test('unsupported transfer or malformed account shape fails before expected evidence is accepted', () => {
  const base = plan();
  const transferPlan = Object.freeze({
    ...base,
    transactions: Object.freeze([
      Object.freeze({
        ...base.transactions[0],
        transaction: Object.freeze({
          ...base.transactions[0].transaction,
          type: 'TRANSFER',
          categoryId: null,
          toAccountId: '00000000-0000-0000-0000-000000008299',
        }),
      }),
    ]),
  });
  assert.throws(
    () => buildExpectedControlledRebuildReconciliation(transferPlan),
    (error) => error instanceof InitialControlledRebuildReconciliationError
      && error.code === 'UNSUPPORTED_TRANSACTION_TYPE',
  );

  const malformed = Object.freeze({
    ...base,
    transactions: Object.freeze([
      Object.freeze({
        ...base.transactions[0],
        transaction: Object.freeze({ ...base.transactions[0].transaction, fromAccountId: null }),
      }),
    ]),
  });
  assert.throws(
    () => buildExpectedControlledRebuildReconciliation(malformed),
    (error) => error instanceof InitialControlledRebuildReconciliationError
      && error.code === 'INVALID_TRANSACTION_SHAPE',
  );
});
