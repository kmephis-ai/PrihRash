import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { readControlledRebuildCurrentEvidence } from '../../dist/migration/initialControlledRebuildEvidenceReader.js';
import { verifyControlledInitialCurrentState } from '../../dist/migration/initialControlledRebuildCurrentVerification.js';

function rowSets(expenseTotal = 10050n) {
  return [
    [
      { classification: 'FINANCIAL_RECORD', state: null, row_count: 2n },
      { classification: 'AMBIGUOUS', state: null, row_count: 1n },
      { classification: 'LEGACY_PERIOD_CLOSE', state: null, row_count: 1n },
    ],
    [
      { type: 'EXPENSE', row_count: 1n, total_amount_minor: expenseTotal },
      { type: 'INCOME', row_count: 1n, total_amount_minor: 20000n },
    ],
    [
      { type: 'EXPENSE', dimension_id: '00000000-0000-0000-0000-000000009301', row_count: 1n, total_amount_minor: 10050n },
      { type: 'INCOME', dimension_id: '00000000-0000-0000-0000-000000009302', row_count: 1n, total_amount_minor: 20000n },
    ],
    [
      { type: 'EXPENSE', dimension_id: '00000000-0000-0000-0000-000000009201', row_count: 1n, total_amount_minor: 10050n },
    ],
    [
      { type: 'INCOME', dimension_id: '00000000-0000-0000-0000-000000009202', row_count: 1n, total_amount_minor: 20000n },
    ],
  ];
}

function fakeTransport(sets = rowSets()) {
  const events = [];
  let queryIndex = 0;
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            events.push(statement.text);
            const rows = sets[queryIndex] ?? [];
            queryIndex += 1;
            return { rows };
          },
        };
        try {
          const value = await work(transaction);
          events.push('commit');
          return value;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    },
  };
}

function source(id, classification, transactionId = null) {
  return Object.freeze({
    id, sourceType: 'GOOGLE_SHEETS', sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T21:55:00Z', lastSeenAt: '2026-09-06T21:55:00Z', lastRowHint: 2,
    currentDigest: `synthetic-${id}`, state: null, classification, normalizationStatus: null,
    transactionId, currentRevision: 1, resolutionCode: null, resolvedAt: null, resolvedBy: null,
  });
}

function candidatePlan() {
  const expenseSource = '00000000-0000-0000-0000-000000009501';
  const incomeSource = '00000000-0000-0000-0000-000000009502';
  const expenseTx = '00000000-0000-0000-0000-000000009511';
  const incomeTx = '00000000-0000-0000-0000-000000009512';
  return Object.freeze({
    sourceRecords: Object.freeze([
      source(expenseSource, 'FINANCIAL_RECORD', expenseTx),
      source(incomeSource, 'FINANCIAL_RECORD', incomeTx),
      source('00000000-0000-0000-0000-000000009503', 'AMBIGUOUS'),
      source('00000000-0000-0000-0000-000000009504', 'LEGACY_PERIOD_CLOSE'),
    ]),
    transactions: Object.freeze([
      Object.freeze({ sourceRecordId: expenseSource, transactionId: expenseTx, transaction: Object.freeze({
        type: 'EXPENSE', occurredOn: '2026-08-01', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
        aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
        amountMinor: 10050, currency: 'RUB', fromAccountId: '00000000-0000-0000-0000-000000009201',
        toAccountId: null, categoryId: '00000000-0000-0000-0000-000000009301', paidByMemberId: null,
        description: 'Synthetic expense', note: null, status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
      }) }),
      Object.freeze({ sourceRecordId: incomeSource, transactionId: incomeTx, transaction: Object.freeze({
        type: 'INCOME', occurredOn: '2026-08-02', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
        aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
        amountMinor: 20000, currency: 'RUB', fromAccountId: null,
        toAccountId: '00000000-0000-0000-0000-000000009202',
        categoryId: '00000000-0000-0000-0000-000000009302', paidByMemberId: null,
        description: 'Synthetic income', note: null, status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
      }) }),
    ]),
  });
}

test('reads canonical current tables with the same five-query exact parser in one transaction', async () => {
  const fake = fakeTransport();
  const snapshot = await readControlledRebuildCurrentEvidence(new YdbAdapter(fake.transport));

  assert.equal(snapshot.sourceRecordCount, 4);
  assert.equal(snapshot.transactionCount, 2);
  const queries = fake.events.filter((event) => typeof event === 'string' && event.startsWith('SELECT '));
  assert.equal(queries.length, 5);
  assert.equal(queries[0].includes('`source_records`'), true);
  assert.equal(queries.slice(1).every((query) => query.includes('`transactions`')), true);
  assert.equal(queries.some((query) => query.includes('rebuild/r_')), false);
  assert.deepEqual(fake.events.filter((event) => event === 'begin'), ['begin']);
  assert.deepEqual(fake.events.filter((event) => event === 'commit'), ['commit']);
});

test('exact canonical current state verifies with only safe MATCHED statuses', async () => {
  const fake = fakeTransport();
  const verdict = await verifyControlledInitialCurrentState(new YdbAdapter(fake.transport), candidatePlan());
  assert.equal(verdict.unexplainedHighImpactMismatchCount, 0);
  assert.equal(Object.values(verdict.checks).every((status) => status === 'MATCHED'), true);
  assert.equal('typeAggregates' in verdict, false);
});

test('post-swap mismatch remains explicit and does not expose private amount values in verdict', async () => {
  const fake = fakeTransport(rowSets(10051n));
  const verdict = await verifyControlledInitialCurrentState(new YdbAdapter(fake.transport), candidatePlan());
  assert.equal(verdict.checks.TOTALS_BY_TYPE, 'MISMATCH');
  assert.equal(verdict.unexplainedHighImpactMismatchCount > 0, true);
  assert.equal('observed' in verdict, false);
});
