import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  READER_RECENT_OPERATIONS_DEFAULT_LIMIT,
  READER_RECENT_OPERATIONS_MAX_LIMIT,
  ReaderRecentOperationsError,
  readRecentOperations,
  recentOperationsStatement,
} from '../../dist/reader/recentOperations.js';

const COMMITTED_RUN_ROW = Object.freeze({
  id: '00000000-0000-0000-0000-000000000901',
  started_at: '2026-09-07T10:00:00.000Z',
  finished_at: '2026-09-07T10:00:05.000Z',
  source_snapshot_digest: 'synthetic-reader-verified-shadow',
  state: 'COMMITTED',
  rows_seen: 1n,
  rows_new: 1n,
  rows_changed: 0n,
  rows_missing: 0n,
  rows_ambiguous: 0n,
  error_code: null,
});

function rowsForStatement(statement, rows) {
  return statement.text.includes('FROM migration_runs WHERE state IN') ? [COMMITTED_RUN_ROW] : rows;
}

const IDS = Object.freeze({
  txExpense: '00000000-0000-0000-0000-000000000101',
  txIncome: '00000000-0000-0000-0000-000000000102',
  txTransfer: '00000000-0000-0000-0000-000000000103',
  accountA: '00000000-0000-0000-0000-000000000201',
  accountB: '00000000-0000-0000-0000-000000000202',
  categoryExpense: '00000000-0000-0000-0000-000000000301',
  categoryIncome: '00000000-0000-0000-0000-000000000302',
  member: '00000000-0000-0000-0000-000000000401',
});

function adapterWithRows(rows, capture = { statements: [], transactions: 0 }) {
  return {
    adapter: new YdbAdapter({
      async executeRead(statement) {
        capture.statements.push(statement);
        return { rows: rowsForStatement(statement, rows) };
      },
      async serializableReadWrite() {
        capture.transactions += 1;
        throw new Error('unexpected transaction');
      },
    }),
    capture,
  };
}

function baseRow(overrides = {}) {
  return {
    id: IDS.txExpense,
    type: 'EXPENSE',
    occurred_on: '2026-09-07',
    captured_at: '2026-09-07T12:34:56.000Z',
    record_granularity: 'TRANSACTION',
    date_precision: 'DAY',
    aggregate_period_month: null,
    financial_period_id: null,
    period_assignment_quality: 'UNASSIGNED',
    amount_minor: 12345n,
    currency: 'RUB',
    from_account_id: IDS.accountA,
    from_account_name: 'Synthetic Account A',
    to_account_id: null,
    to_account_name: null,
    category_id: IDS.categoryExpense,
    category_name: 'Synthetic Expense',
    category_kind: 'EXPENSE',
    paid_by_member_id: IDS.member,
    paid_by_member_name: 'Synthetic Member',
    description: 'Synthetic description',
    note: null,
    status: 'POSTED',
    analytics_state: 'INCLUDED',
    flow_kind: null,
    version: 1n,
    ...overrides,
  };
}

test('recent operations query performs verified-shadow admission before one bounded canonical read', async () => {
  const rows = [
    baseRow(),
    baseRow({
      id: IDS.txIncome,
      type: 'INCOME',
      from_account_id: null,
      from_account_name: null,
      to_account_id: IDS.accountB,
      to_account_name: 'Synthetic Account B',
      category_id: IDS.categoryIncome,
      category_name: 'Synthetic Income',
      category_kind: 'INCOME',
      paid_by_member_id: null,
      paid_by_member_name: null,
      status: 'VOIDED',
    }),
    baseRow({
      id: IDS.txTransfer,
      type: 'TRANSFER',
      from_account_id: IDS.accountA,
      from_account_name: 'Synthetic Account A',
      to_account_id: IDS.accountB,
      to_account_name: 'Synthetic Account B',
      category_id: null,
      category_name: null,
      category_kind: null,
      flow_kind: 'OWN_FUNDS_TRANSFER',
    }),
  ];
  const { adapter, capture } = adapterWithRows(rows);

  const result = await readRecentOperations(adapter, 25);

  assert.equal(result.limit, 25);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].amountMinor, 12345);
  assert.equal(result.items[0].fromAccount.label, 'Synthetic Account A');
  assert.equal(result.items[1].status, 'VOIDED');
  assert.equal(result.items[2].category, null);
  assert.equal(capture.transactions, 0);
  assert.equal(capture.statements.length, 2);
  assert.match(capture.statements[0].text, /FROM migration_runs WHERE state IN/);
  assert.match(capture.statements[1].text, /LEFT JOIN accounts AS fa/);
  assert.match(capture.statements[1].text, /LEFT JOIN categories AS c/);
  assert.match(capture.statements[1].text, /ORDER BY t\.occurred_on DESC, t\.captured_at DESC, t\.id DESC LIMIT \$limit/);
  assert.equal(capture.statements[1].parameters.limit.type, 'Uint64');
  assert.equal(capture.statements[1].parameters.limit.value, 25n);
});

test('coarse and uncertain historical quality remains explicit in Reader projection', async () => {
  const row = baseRow({
    record_granularity: 'PERIOD_AGGREGATE',
    date_precision: 'MONTH',
    aggregate_period_month: '2024-02-01',
    period_assignment_quality: 'LEGACY_AMBIGUOUS',
    occurred_on: '2024-02-01',
  });
  const { adapter } = adapterWithRows([row]);

  const result = await readRecentOperations(adapter);
  assert.equal(result.limit, READER_RECENT_OPERATIONS_DEFAULT_LIMIT);
  assert.equal(result.items[0].recordGranularity, 'PERIOD_AGGREGATE');
  assert.equal(result.items[0].datePrecision, 'MONTH');
  assert.equal(result.items[0].aggregatePeriodMonth, '2024-02-01');
  assert.equal(result.items[0].periodAssignmentQuality, 'LEGACY_AMBIGUOUS');
});

test('limit is bounded fail-closed', async () => {
  for (const value of [0, -1, 1.5, READER_RECENT_OPERATIONS_MAX_LIMIT + 1]) {
    assert.throws(
      () => recentOperationsStatement(value),
      (error) => error instanceof ReaderRecentOperationsError && error.code === 'INVALID_LIMIT',
    );
  }
  assert.equal(recentOperationsStatement(READER_RECENT_OPERATIONS_MAX_LIMIT).parameters.limit.value, 100n);
});

test('malformed provider evidence and orphaned display references fail closed', async () => {
  const badRows = [
    baseRow({ currency: 'USD' }),
    baseRow({ amount_minor: 0n }),
    baseRow({ from_account_name: null }),
    baseRow({ category_kind: 'INCOME' }),
    baseRow({ aggregate_period_month: '2026-09-01' }),
    baseRow({ type: 'TRANSFER' }),
    baseRow({ version: 0n }),
  ];

  for (const row of badRows) {
    const { adapter } = adapterWithRows([row]);
    await assert.rejects(
      () => readRecentOperations(adapter, 10),
      (error) => error instanceof ReaderRecentOperationsError
        && error.code === 'MALFORMED_READER_EVIDENCE',
    );
  }
});

test('nullable labels stay null only when their canonical id is null', async () => {
  const row = baseRow({
    paid_by_member_id: null,
    paid_by_member_name: null,
    description: null,
    note: null,
  });
  const { adapter } = adapterWithRows([row]);
  const result = await readRecentOperations(adapter, 1);
  assert.equal(result.items[0].paidByMember, null);
  assert.equal(result.items[0].description, null);
  assert.equal(result.items[0].note, null);
});
