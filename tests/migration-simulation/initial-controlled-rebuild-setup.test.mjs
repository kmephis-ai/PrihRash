import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InitialControlledRebuildSetupError,
  planInitialControlledRebuildSetup,
} from '../../dist/migration/initialControlledRebuildSetup.js';

const controlled = Object.freeze({
  runId: '00000000-0000-0000-0000-000000006001',
  stagingTables: Object.freeze({
    transactions: 'rebuild/r_00000000000000000000000000006001/transactions',
    sourceRecords: 'rebuild/r_00000000000000000000000000006001/source_records',
  }),
  batches: Object.freeze([]),
  replacements: Object.freeze([]),
  expectedSourceRecordCount: 10,
  expectedTransactionCount: 8,
});

function evidence(overrides = {}) {
  return Object.freeze({
    currentTransactionCount: 0,
    currentSourceRecordCount: 0,
    stagingDirectoryExists: false,
    stagingTransactionsExists: false,
    stagingSourceRecordsExists: false,
    ...overrides,
  });
}

test('plans parent mkdir and atomic two-table copy only from proven empty canonical current tables', () => {
  const plan = planInitialControlledRebuildSetup(controlled, evidence());

  assert.deepEqual(plan, {
    stagingDirectory: 'rebuild/r_00000000000000000000000000006001',
    createDirectory: true,
    copyItems: [
      { source: 'transactions', destination: controlled.stagingTables.transactions },
      { source: 'source_records', destination: controlled.stagingTables.sourceRecords },
    ],
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.copyItems), true);
});

test('existing empty parent directory is a safe retry point before atomic copy', () => {
  const plan = planInitialControlledRebuildSetup(
    controlled,
    evidence({ stagingDirectoryExists: true }),
  );
  assert.equal(plan.createDirectory, false);
  assert.equal(plan.copyItems.length, 2);
});

test('non-empty current state blocks initial-only copy shortcut', () => {
  for (const counts of [
    { currentTransactionCount: 1 },
    { currentSourceRecordCount: 1 },
    { currentTransactionCount: 1, currentSourceRecordCount: 1 },
  ]) {
    assert.throws(
      () => planInitialControlledRebuildSetup(controlled, evidence(counts)),
      (error) => error instanceof InitialControlledRebuildSetupError
        && error.code === 'CURRENT_STATE_NOT_EMPTY',
    );
  }
});

test('invalid count evidence fails closed instead of being coerced', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => planInitialControlledRebuildSetup(
        controlled,
        evidence({ currentTransactionCount: value }),
      ),
      (error) => error instanceof InitialControlledRebuildSetupError
        && error.code === 'INVALID_CURRENT_COUNT_EVIDENCE',
    );
  }
});

test('any existing staging table requires recovery instead of overwrite/copy retry', () => {
  for (const existing of [
    { stagingTransactionsExists: true },
    { stagingSourceRecordsExists: true },
    { stagingTransactionsExists: true, stagingSourceRecordsExists: true },
  ]) {
    assert.throws(
      () => planInitialControlledRebuildSetup(controlled, evidence(existing)),
      (error) => error instanceof InitialControlledRebuildSetupError
        && error.code === 'STAGING_TABLE_ALREADY_EXISTS',
    );
  }
});

test('rejects controlled plans whose staging paths are not the same run-scoped pair', () => {
  for (const stagingTables of [
    { ...controlled.stagingTables, transactions: 'other/transactions' },
    { ...controlled.stagingTables, sourceRecords: 'rebuild/r_00000000000000000000000000006002/source_records' },
  ]) {
    assert.throws(
      () => planInitialControlledRebuildSetup(
        Object.freeze({ ...controlled, stagingTables: Object.freeze(stagingTables) }),
        evidence(),
      ),
      (error) => error instanceof InitialControlledRebuildSetupError
        && error.code === 'INVALID_CONTROLLED_REBUILD_PATHS',
    );
  }
});
