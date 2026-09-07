import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
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

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000201';
const CATEGORY_ID = '00000000-0000-0000-0000-000000000301';

function adapterCapturing(statementCapture) {
  return new YdbAdapter({
    async executeRead(statement) {
      statementCapture.push(statement);
      return { rows: rowsForStatement(statement, []) };
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

test('type, status, account and category filters use only bound parameters', () => {
  const statement = recentOperationsStatement(20, {
    type: 'EXPENSE',
    status: 'POSTED',
    accountId: ACCOUNT_ID.toUpperCase(),
    categoryId: CATEGORY_ID.toUpperCase(),
  });

  assert.match(statement.text, /WHERE t\.type = \$type AND t\.status = \$status AND \(t\.from_account_id = \$account_id OR t\.to_account_id = \$account_id\) AND t\.category_id = \$category_id/);
  assert.equal(statement.text.includes(ACCOUNT_ID), false);
  assert.equal(statement.text.includes(CATEGORY_ID), false);
  assert.deepEqual(Object.keys(statement.parameters).sort(), ['account_id', 'category_id', 'limit', 'status', 'type']);
  assert.equal(statement.parameters.type.type, 'Utf8');
  assert.equal(statement.parameters.type.value, 'EXPENSE');
  assert.equal(statement.parameters.status.value, 'POSTED');
  assert.equal(statement.parameters.account_id.type, 'Uuid');
  assert.equal(statement.parameters.account_id.value, ACCOUNT_ID);
  assert.equal(statement.parameters.category_id.value, CATEGORY_ID);
  assert.equal(statement.parameters.limit.value, 20n);
});

test('each basic filter can be used independently without synthetic always-on predicates', () => {
  const cases = [
    [{ type: 'TRANSFER' }, 'WHERE t.type = $type', ['limit', 'type']],
    [{ status: 'VOIDED' }, 'WHERE t.status = $status', ['limit', 'status']],
    [{ accountId: ACCOUNT_ID }, 'WHERE (t.from_account_id = $account_id OR t.to_account_id = $account_id)', ['account_id', 'limit']],
    [{ categoryId: CATEGORY_ID }, 'WHERE t.category_id = $category_id', ['category_id', 'limit']],
  ];

  for (const [filters, expectedClause, expectedParameters] of cases) {
    const statement = recentOperationsStatement(10, filters);
    assert.equal(statement.text.includes(expectedClause), true);
    assert.deepEqual(Object.keys(statement.parameters).sort(), expectedParameters);
  }
});

test('no filters preserves the original query shape and only binds limit', () => {
  for (const filters of [undefined, {}]) {
    const statement = recentOperationsStatement(15, filters);
    assert.equal(statement.text.includes(' WHERE '), false);
    assert.deepEqual(Object.keys(statement.parameters), ['limit']);
  }
});

test('invalid filter values fail before provider read', async () => {
  const invalidFilters = [
    { type: 'DELETE' },
    { status: 'HIDDEN' },
    { accountId: 'not-a-uuid' },
    { categoryId: 'not-a-uuid' },
  ];

  for (const filters of invalidFilters) {
    const statements = [];
    const adapter = adapterCapturing(statements);
    await assert.rejects(
      () => readRecentOperations(adapter, 10, filters),
      (error) => error instanceof ReaderRecentOperationsError && error.code === 'INVALID_FILTER',
    );
    assert.equal(statements.length, 0);
  }
});

test('readRecentOperations passes normalized filters to the provider query', async () => {
  const statements = [];
  const adapter = adapterCapturing(statements);
  const result = await readRecentOperations(adapter, 7, {
    type: 'INCOME',
    accountId: ACCOUNT_ID.toUpperCase(),
  });

  assert.equal(result.limit, 7);
  assert.deepEqual(result.items, []);
  assert.equal(statements.length, 2);
  assert.match(statements[0].text, /FROM migration_runs WHERE state IN/);
  assert.equal(statements[1].parameters.type.value, 'INCOME');
  assert.equal(statements[1].parameters.account_id.value, ACCOUNT_ID);
  assert.equal(statements[1].parameters.limit.value, 7n);
});
