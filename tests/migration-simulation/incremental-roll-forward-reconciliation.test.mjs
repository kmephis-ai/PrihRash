import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExpectedControlledRebuildReconciliation,
} from '../../dist/migration/initialControlledRebuildReconciliation.js';
import {
  IncrementalRollForwardReconciliationError,
  buildIncrementalRollForwardReconciliationSnapshot,
  compareIncrementalRollForwardReconciliation,
} from '../../dist/migration/incrementalRollForwardReconciliation.js';

const SOURCE_A = '00000000-0000-0000-0000-00000000a001';
const SOURCE_B = '00000000-0000-0000-0000-00000000a002';
const TX_A = '00000000-0000-0000-0000-00000000b001';
const TX_B = '00000000-0000-0000-0000-00000000b002';
const ACCOUNT_A = '00000000-0000-0000-0000-00000000c001';
const ACCOUNT_B = '00000000-0000-0000-0000-00000000c002';
const CATEGORY_A = '00000000-0000-0000-0000-00000000d001';
const CATEGORY_B = '00000000-0000-0000-0000-00000000d002';

function sourceRecord({
  id = SOURCE_A,
  transactionId = TX_A,
  digest = 'digest-a',
  revision = 1,
  classification = 'FINANCIAL_RECORD',
  state = null,
} = {}) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-07T10:00:00.000Z',
    lastSeenAt: '2026-09-07T10:00:00.000Z',
    lastRowHint: id === SOURCE_A ? 2 : 3,
    currentDigest: digest,
    state,
    classification,
    normalizationStatus: null,
    transactionId,
    currentRevision: revision,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

function transaction({
  id = TX_A,
  accountId = ACCOUNT_A,
  categoryId = CATEGORY_A,
  amountMinor = 1000,
  version = 1,
} = {}) {
  return Object.freeze({
    id,
    version,
    transaction: Object.freeze({
      type: 'EXPENSE',
      occurredOn: '2026-09-07',
      recordGranularity: 'TRANSACTION',
      datePrecision: 'DAY',
      aggregatePeriodMonth: null,
      financialPeriodId: null,
      periodAssignmentQuality: 'UNASSIGNED',
      amountMinor,
      currency: 'RUB',
      fromAccountId: accountId,
      toAccountId: null,
      categoryId,
      paidByMemberId: null,
      description: 'Synthetic reconciliation fixture',
      note: null,
      status: 'POSTED',
      analyticsState: 'INCLUDED',
      flowKind: null,
    }),
  });
}

function expectedPlan(sources, transactions, promotionBlocker = null) {
  return Object.freeze({
    expected: buildExpectedControlledRebuildReconciliation({
      sourceRecords: sources.map((record) => Object.freeze({
        classification: record.classification,
        state: record.state,
      })),
      transactions: transactions.map((record) => Object.freeze({ transaction: record.transaction })),
    }),
    promotionBlocker,
  });
}

function emptyDelta(promotionBlocker = null) {
  return Object.freeze({
    sourceIntents: Object.freeze([]),
    transactionIntents: Object.freeze([]),
    promotionBlocker,
  });
}

test('unchanged baseline roll-forward matches expected candidate aggregates', () => {
  const sources = Object.freeze([sourceRecord()]);
  const transactions = Object.freeze([transaction()]);
  const expected = expectedPlan(sources, transactions);

  const snapshot = buildIncrementalRollForwardReconciliationSnapshot(
    sources,
    transactions,
    emptyDelta(),
  );
  assert.deepEqual(snapshot, expected.expected);

  const evidence = compareIncrementalRollForwardReconciliation(
    expected,
    sources,
    transactions,
    emptyDelta(),
  );
  assert.equal(evidence.unexplainedHighImpactMismatchCount, 0);
  assert.deepEqual(new Set(Object.values(evidence.checks)), new Set(['MATCHED']));
});

test('create intents roll verified baseline forward without reading full candidate arrays', () => {
  const baselineSources = Object.freeze([sourceRecord()]);
  const baselineTransactions = Object.freeze([transaction()]);
  const createdSource = sourceRecord({
    id: SOURCE_B,
    transactionId: TX_B,
    digest: 'digest-b',
  });
  const createdTransaction = transaction({
    id: TX_B,
    accountId: ACCOUNT_B,
    categoryId: CATEGORY_B,
    amountMinor: 2500,
  });
  const delta = Object.freeze({
    sourceIntents: Object.freeze([Object.freeze({
      kind: 'CREATE_SOURCE_RECORD',
      candidate: createdSource,
    })]),
    transactionIntents: Object.freeze([Object.freeze({
      kind: 'CREATE_TRANSACTION',
      candidate: createdTransaction,
    })]),
    promotionBlocker: null,
  });
  const expected = expectedPlan(
    Object.freeze([baselineSources[0], createdSource]),
    Object.freeze([baselineTransactions[0], createdTransaction]),
  );

  const evidence = compareIncrementalRollForwardReconciliation(
    expected,
    baselineSources,
    baselineTransactions,
    delta,
  );
  assert.equal(evidence.unexplainedHighImpactMismatchCount, 0);
  assert.deepEqual(new Set(Object.values(evidence.checks)), new Set(['MATCHED']));
});

test('update and replace intents use exact baseline predicates before contributing new aggregates', () => {
  const baselineSource = sourceRecord();
  const baselineTransaction = transaction();
  const updatedSource = Object.freeze({
    ...baselineSource,
    lastSeenAt: '2026-09-07T11:00:00.000Z',
    currentDigest: 'digest-a-v2',
    currentRevision: 2,
  });
  const replacedTransaction = transaction({ amountMinor: 1750, version: 2 });
  const delta = Object.freeze({
    sourceIntents: Object.freeze([Object.freeze({
      kind: 'UPDATE_SOURCE_RECORD',
      candidate: updatedSource,
      expectedCurrentRevision: 1,
      expectedCurrentDigest: 'digest-a',
      expectedState: null,
      expectedTransactionId: TX_A,
      expectedResolutionCode: null,
    })]),
    transactionIntents: Object.freeze([Object.freeze({
      kind: 'REPLACE_TRANSACTION',
      candidate: replacedTransaction,
      expectedVersion: 1,
    })]),
    promotionBlocker: null,
  });
  const expected = expectedPlan(
    Object.freeze([updatedSource]),
    Object.freeze([replacedTransaction]),
  );

  const evidence = compareIncrementalRollForwardReconciliation(
    expected,
    Object.freeze([baselineSource]),
    Object.freeze([baselineTransaction]),
    delta,
  );
  assert.equal(evidence.unexplainedHighImpactMismatchCount, 0);
  assert.equal(evidence.checks.TOTALS_BY_TYPE, 'MATCHED');
});

test('candidate/delta omission is visible as reconciliation mismatch instead of self-proof', () => {
  const baselineSources = Object.freeze([sourceRecord()]);
  const baselineTransactions = Object.freeze([transaction()]);
  const createdSource = sourceRecord({
    id: SOURCE_B,
    transactionId: TX_B,
    digest: 'digest-b',
  });
  const createdTransaction = transaction({
    id: TX_B,
    accountId: ACCOUNT_B,
    categoryId: CATEGORY_B,
    amountMinor: 2500,
  });
  const expected = expectedPlan(
    Object.freeze([baselineSources[0], createdSource]),
    Object.freeze([baselineTransactions[0], createdTransaction]),
  );

  const evidence = compareIncrementalRollForwardReconciliation(
    expected,
    baselineSources,
    baselineTransactions,
    emptyDelta(),
  );
  assert.equal(evidence.checks.SOURCE_RECORD_COUNT, 'MISMATCH');
  assert.equal(evidence.checks.TRANSACTION_COUNTS, 'MISMATCH');
  assert.ok(evidence.unexplainedHighImpactMismatchCount > 0);
});

for (const [name, mutate, code] of [
  [
    'source update digest predicate mismatch',
    () => Object.freeze({
      sourceIntents: Object.freeze([Object.freeze({
        kind: 'UPDATE_SOURCE_RECORD',
        candidate: Object.freeze({
          ...sourceRecord(),
          currentDigest: 'digest-a-v2',
          currentRevision: 2,
        }),
        expectedCurrentRevision: 1,
        expectedCurrentDigest: 'wrong-digest',
        expectedState: null,
        expectedTransactionId: TX_A,
        expectedResolutionCode: null,
      })]),
      transactionIntents: Object.freeze([]),
      promotionBlocker: null,
    }),
    'SOURCE_UPDATE_PREDICATE_MISMATCH',
  ],
  [
    'source create collision',
    () => Object.freeze({
      sourceIntents: Object.freeze([Object.freeze({
        kind: 'CREATE_SOURCE_RECORD',
        candidate: sourceRecord(),
      })]),
      transactionIntents: Object.freeze([]),
      promotionBlocker: null,
    }),
    'SOURCE_CREATE_COLLISION',
  ],
  [
    'transaction replace version predicate mismatch',
    () => Object.freeze({
      sourceIntents: Object.freeze([]),
      transactionIntents: Object.freeze([Object.freeze({
        kind: 'REPLACE_TRANSACTION',
        candidate: transaction({ amountMinor: 2000, version: 2 }),
        expectedVersion: 9,
      })]),
      promotionBlocker: null,
    }),
    'TRANSACTION_REPLACE_PREDICATE_MISMATCH',
  ],
]) {
  test(`fails closed for ${name}`, () => {
    assert.throws(
      () => buildIncrementalRollForwardReconciliationSnapshot(
        Object.freeze([sourceRecord()]),
        Object.freeze([transaction()]),
        mutate(),
      ),
      (error) => error instanceof IncrementalRollForwardReconciliationError && error.code === code,
    );
  });
}

test('promotion blocker mismatch fails before aggregate comparison', () => {
  assert.throws(
    () => compareIncrementalRollForwardReconciliation(
      expectedPlan(Object.freeze([sourceRecord()]), Object.freeze([transaction()]), 'UNRESOLVED_LINEAGE'),
      Object.freeze([sourceRecord()]),
      Object.freeze([transaction()]),
      emptyDelta(null),
    ),
    (error) => error instanceof IncrementalRollForwardReconciliationError
      && error.code === 'PROMOTION_BLOCKER_MISMATCH',
  );
});
