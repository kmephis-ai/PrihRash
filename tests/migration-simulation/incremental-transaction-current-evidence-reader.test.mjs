import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  IncrementalTransactionCurrentEvidenceReaderError,
  readIncrementalTransactionCurrentEvidence,
} from '../../dist/migration/incrementalTransactionCurrentEvidenceReader.js';

function expenseRow(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000301',
    type: 'EXPENSE',
    occurred_on: '2026-09-05',
    record_granularity: 'TRANSACTION',
    date_precision: 'DAY',
    aggregate_period_month: null,
    financial_period_id: null,
    period_assignment_quality: 'UNASSIGNED',
    amount_minor: 12345n,
    currency: 'RUB',
    from_account_id: '00000000-0000-0000-0000-000000000401',
    to_account_id: null,
    category_id: '00000000-0000-0000-0000-000000000501',
    paid_by_member_id: null,
    description: 'synthetic expense',
    note: null,
    status: 'POSTED',
    analytics_state: 'INCLUDED',
    flow_kind: null,
    version: 2n,
    ...overrides,
  };
}

function makeAdapter(rows) {
  const observed = { calls: [] };
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      observed.calls.push(statement);
      return { rows };
    },
    async serializableReadWrite() {
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });
  return { adapter, observed };
}

test('reads canonical transactions once and returns frozen deterministic current evidence', async () => {
  const income = expenseRow({
    id: '00000000-0000-0000-0000-000000000302',
    type: 'INCOME',
    amount_minor: 20000,
    from_account_id: null,
    to_account_id: '00000000-0000-0000-0000-000000000402',
    category_id: '00000000-0000-0000-0000-000000000502',
    description: 'synthetic income',
    version: 1,
  });
  const expense = expenseRow();
  const { adapter, observed } = makeAdapter([income, expense]);

  const evidence = await readIncrementalTransactionCurrentEvidence(adapter);

  assert.equal(observed.calls.length, 1);
  assert.equal(observed.calls[0].kind, 'READ');
  assert.match(observed.calls[0].text, /FROM transactions$/);
  assert.deepEqual(evidence.map((item) => item.id), [expense.id, income.id]);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence[0]), true);
  assert.equal(Object.isFrozen(evidence[0].transaction), true);
  assert.equal(evidence[0].version, 2);
  assert.equal(evidence[0].transaction.amountMinor, 12345);
  assert.equal(evidence[1].transaction.type, 'INCOME');
});

test('accepts transfer and period-aggregate structural variants already allowed by canonical domain', async () => {
  const transfer = expenseRow({
    id: '00000000-0000-0000-0000-000000000303',
    type: 'TRANSFER',
    from_account_id: '00000000-0000-0000-0000-000000000403',
    to_account_id: '00000000-0000-0000-0000-000000000404',
    category_id: null,
    flow_kind: 'OWN_FUNDS_TRANSFER',
  });
  const aggregate = expenseRow({
    id: '00000000-0000-0000-0000-000000000304',
    occurred_on: '2026-09-01',
    record_granularity: 'PERIOD_AGGREGATE',
    date_precision: 'MONTH',
    aggregate_period_month: '2026-09-01',
  });
  const { adapter } = makeAdapter([transfer, aggregate]);

  const evidence = await readIncrementalTransactionCurrentEvidence(adapter);

  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].transaction.type, 'TRANSFER');
  assert.equal(evidence[1].transaction.aggregatePeriodMonth, '2026-09-01');
});

test('normalizes UUID casing, preserves text values, and rejects duplicate ids case-insensitively', async () => {
  const upper = expenseRow({ id: 'AAAAAAAA-0000-0000-0000-000000000301', description: '', note: '' });
  const lower = expenseRow({ id: '00000000-0000-0000-0000-000000000302' });
  const { adapter } = makeAdapter([upper, lower]);
  const evidence = await readIncrementalTransactionCurrentEvidence(adapter);

  assert.deepEqual(evidence.map((item) => item.id), [
    '00000000-0000-0000-0000-000000000302',
    'aaaaaaaa-0000-0000-0000-000000000301',
  ]);
  assert.equal(evidence[1].transaction.description, '');
  assert.equal(evidence[1].transaction.note, '');

  const duplicate = makeAdapter([
    expenseRow({ id: 'AAAAAAAA-0000-0000-0000-000000000399' }),
    expenseRow({ id: 'aaaaaaaa-0000-0000-0000-000000000399' }),
  ]);
  await assert.rejects(
    () => readIncrementalTransactionCurrentEvidence(duplicate.adapter),
    (error) => error instanceof IncrementalTransactionCurrentEvidenceReaderError
      && error.code === 'DUPLICATE_TRANSACTION_ID',
  );
});

test('malformed provider and canonical transaction evidence fails closed', async () => {
  const malformed = [
    { id: 'not-a-uuid' },
    { type: 'OTHER' },
    { occurred_on: '2026-02-31' },
    { record_granularity: 'OTHER' },
    { date_precision: 'YEAR' },
    { aggregate_period_month: '2026-09-15' },
    { financial_period_id: 'bad-id' },
    { period_assignment_quality: 'OTHER' },
    { amount_minor: 0n },
    { currency: 'USD' },
    { from_account_id: null },
    { to_account_id: '00000000-0000-0000-0000-000000000499' },
    { category_id: null },
    { paid_by_member_id: 'bad-id' },
    { description: 123 },
    { note: false },
    { status: 'DELETED' },
    { analytics_state: 'OTHER' },
    { flow_kind: 'CREDIT_DRAW' },
    { version: 0n },
  ];

  for (const overrides of malformed) {
    const { adapter } = makeAdapter([expenseRow(overrides)]);
    await assert.rejects(
      () => readIncrementalTransactionCurrentEvidence(adapter),
      (error) => error instanceof IncrementalTransactionCurrentEvidenceReaderError
        && error.code === 'MALFORMED_TRANSACTION_CURRENT_EVIDENCE',
      JSON.stringify(overrides),
    );
  }
});

test('aggregate month must be canonical month start and canonical aggregate invariants remain fail-closed', async () => {
  for (const overrides of [
    { record_granularity: 'PERIOD_AGGREGATE', date_precision: 'DAY', aggregate_period_month: '2026-09-01' },
    { record_granularity: 'PERIOD_AGGREGATE', date_precision: 'MONTH', aggregate_period_month: null },
    { record_granularity: 'TRANSACTION', date_precision: 'DAY', aggregate_period_month: '2026-09-01' },
  ]) {
    const { adapter } = makeAdapter([expenseRow(overrides)]);
    await assert.rejects(
      () => readIncrementalTransactionCurrentEvidence(adapter),
      (error) => error instanceof IncrementalTransactionCurrentEvidenceReaderError
        && error.code === 'MALFORMED_TRANSACTION_CURRENT_EVIDENCE',
    );
  }
});

test('empty transaction evidence is valid and performs no writes', async () => {
  const { adapter, observed } = makeAdapter([]);
  const evidence = await readIncrementalTransactionCurrentEvidence(adapter);
  assert.deepEqual(evidence, []);
  assert.equal(observed.calls.length, 1);
});
