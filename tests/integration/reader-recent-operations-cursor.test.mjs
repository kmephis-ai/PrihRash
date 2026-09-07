import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ReaderRecentOperationsError,
  decodeRecentOperationsCursor,
  encodeRecentOperationsCursor,
  readRecentOperationsPage,
  recentOperationsPageStatement,
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
  first: '00000000-0000-0000-0000-000000000501',
  second: '00000000-0000-0000-0000-000000000502',
  third: '00000000-0000-0000-0000-000000000503',
  account: '00000000-0000-0000-0000-000000000201',
  category: '00000000-0000-0000-0000-000000000301',
});

function row(id, occurredOn, capturedAt) {
  return {
    id,
    type: 'EXPENSE',
    occurred_on: occurredOn,
    captured_at: capturedAt,
    record_granularity: 'TRANSACTION',
    date_precision: 'DAY',
    aggregate_period_month: null,
    financial_period_id: null,
    period_assignment_quality: 'UNASSIGNED',
    amount_minor: 100n,
    currency: 'RUB',
    from_account_id: IDS.account,
    from_account_name: 'Synthetic Account',
    to_account_id: null,
    to_account_name: null,
    category_id: IDS.category,
    category_name: 'Synthetic Category',
    category_kind: 'EXPENSE',
    paid_by_member_id: null,
    paid_by_member_name: null,
    description: null,
    note: null,
    status: 'POSTED',
    analytics_state: 'INCLUDED',
    flow_kind: null,
    version: 1n,
  };
}

function adapterWithRows(rows, capture = []) {
  return new YdbAdapter({
    async executeRead(statement) {
      capture.push(statement);
      return { rows: rowsForStatement(statement, rows) };
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

test('cursor round-trips only stable sort keys', () => {
  const cursor = encodeRecentOperationsCursor({
    occurredOn: '2026-09-07',
    capturedAt: '2026-09-07T12:34:56.000Z',
    id: IDS.first.toUpperCase(),
  });
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  const decoded = decodeRecentOperationsCursor(cursor);
  assert.deepEqual(decoded, {
    v: 1,
    o: '2026-09-07',
    c: '2026-09-07T12:34:56.000Z',
    i: IDS.first,
  });
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  assert.equal(raw.includes('amount'), false);
  assert.equal(raw.includes('description'), false);
  assert.equal(raw.includes('note'), false);
});

test('page statement uses limit+1 and exact DESC keyset predicate with typed parameters', () => {
  const cursor = encodeRecentOperationsCursor({
    occurredOn: '2026-09-07',
    capturedAt: '2026-09-07T12:34:56.000Z',
    id: IDS.first,
  });
  const statement = recentOperationsPageStatement(20, { type: 'EXPENSE' }, cursor);

  assert.equal(statement.parameters.limit.value, 21n);
  assert.equal(statement.parameters.cursor_occurred_on.type, 'Date');
  assert.equal(statement.parameters.cursor_occurred_on.value, '2026-09-07');
  assert.equal(statement.parameters.cursor_captured_at.type, 'Timestamp');
  assert.equal(statement.parameters.cursor_captured_at.value, '2026-09-07T12:34:56.000Z');
  assert.equal(statement.parameters.cursor_id.type, 'Uuid');
  assert.equal(statement.parameters.cursor_id.value, IDS.first);
  assert.match(statement.text, /t\.type = \$type AND \(t\.occurred_on < \$cursor_occurred_on OR/);
  assert.match(statement.text, /t\.id < \$cursor_id\)\)/);
  assert.equal(statement.text.includes('OFFSET'), false);
});

test('page returns at most requested items and cursor from last returned row', async () => {
  const rows = [
    row(IDS.first, '2026-09-07', '2026-09-07T12:34:58.000Z'),
    row(IDS.second, '2026-09-07', '2026-09-07T12:34:57.000Z'),
    row(IDS.third, '2026-09-07', '2026-09-07T12:34:56.000Z'),
  ];
  const capture = [];
  const result = await readRecentOperationsPage(adapterWithRows(rows, capture), 2);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, IDS.first);
  assert.equal(result.items[1].id, IDS.second);
  assert.equal(result.limit, 2);
  assert.notEqual(result.nextCursor, null);
  assert.deepEqual(decodeRecentOperationsCursor(result.nextCursor), {
    v: 1,
    o: '2026-09-07',
    c: '2026-09-07T12:34:57.000Z',
    i: IDS.second,
  });
  assert.equal(capture.length, 2);
  assert.match(capture[0].text, /FROM migration_runs WHERE state IN/);
  assert.equal(capture[1].parameters.limit.value, 3n);
});

test('page returns null cursor when provider has no extra row', async () => {
  const result = await readRecentOperationsPage(adapterWithRows([
    row(IDS.first, '2026-09-07', '2026-09-07T12:34:58.000Z'),
  ]), 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.nextCursor, null);
});

test('malformed cursors fail before provider read', async () => {
  const invalid = [
    '',
    ' not-canonical ',
    '***',
    Buffer.from('{}', 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 2, o: '2026-09-07', c: '2026-09-07T12:34:56.000Z', i: IDS.first }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, o: 'bad', c: '2026-09-07T12:34:56.000Z', i: IDS.first }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, o: '2026-09-07', c: 'bad', i: IDS.first }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, o: '2026-09-07', c: '2026-09-07T12:34:56.000Z', i: 'bad' }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, o: '2026-09-07', c: '2026-09-07T12:34:56.000Z', i: IDS.first, extra: 1 }), 'utf8').toString('base64url'),
  ];

  for (const cursor of invalid) {
    const capture = [];
    await assert.rejects(
      () => readRecentOperationsPage(adapterWithRows([], capture), 10, undefined, cursor),
      (error) => error instanceof ReaderRecentOperationsError && error.code === 'INVALID_CURSOR',
    );
    assert.equal(capture.length, 0);
  }
});
