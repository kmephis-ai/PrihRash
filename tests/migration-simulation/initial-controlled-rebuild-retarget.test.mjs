import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatement } from '../../dist/integration/ydb/adapter.js';
import {
  ControlledRebuildRetargetError,
  retargetInitialVerifiedCurrentWritesToStaging,
} from '../../dist/migration/initialControlledRebuildRetarget.js';

const tables = Object.freeze({
  transactions: 'rebuild/r_00000000000000000000000000005001/transactions',
  sourceRecords: 'rebuild/r_00000000000000000000000000005001/source_records',
});

function prepared(role, text, parameters = {}) {
  return Object.freeze({
    role,
    sourceRecordId: '00000000-0000-0000-0000-000000005101',
    statement: writeStatement(text, parameters),
    estimatedParameterBytes: 123,
  });
}

test('retargets only exact canonical prefixes and preserves typed parameters/estimate', () => {
  const parameter = Object.freeze({ type: 'Uuid', value: '00000000-0000-0000-0000-000000005201' });
  const writes = [
    prepared('TRANSACTION', 'UPSERT INTO transactions (id) VALUES ($id)', { id: parameter }),
    prepared('SOURCE_RECORD', 'UPSERT INTO source_records (id) VALUES ($id)', { id: parameter }),
  ];

  const retargeted = retargetInitialVerifiedCurrentWritesToStaging(writes, tables);

  assert.equal(retargeted[0].statement.text, 'UPSERT INTO `rebuild/r_00000000000000000000000000005001/transactions` (id) VALUES ($id)');
  assert.equal(retargeted[1].statement.text, 'UPSERT INTO `rebuild/r_00000000000000000000000000005001/source_records` (id) VALUES ($id)');
  assert.deepEqual(retargeted[0].statement.parameters.id, parameter);
  assert.equal(retargeted[0].estimatedParameterBytes, 123);
  assert.equal(Object.isFrozen(retargeted), true);
  assert.equal(Object.isFrozen(retargeted[0]), true);
  assert.equal(Object.isFrozen(retargeted[0].statement), true);
});

test('rejects statement whose leading canonical table does not match declared role', () => {
  assert.throws(
    () => retargetInitialVerifiedCurrentWritesToStaging([
      prepared('TRANSACTION', 'UPSERT INTO source_records (id) VALUES ($id)'),
    ], tables),
    (error) => error instanceof ControlledRebuildRetargetError
      && error.code === 'STATEMENT_ROLE_MISMATCH',
  );
});

test('rejects non-planner staging paths instead of escaping arbitrary identifiers', () => {
  for (const invalidTables of [
    { ...tables, transactions: 'other/transactions' },
    { ...tables, transactions: 'rebuild/r_00000000000000000000000000005001/transactions` DROP TABLE x' },
    { ...tables, sourceRecords: 'rebuild/r_NOTHEX/source_records' },
    { ...tables, sourceRecords: 'rebuild/r_00000000000000000000000000005001/transactions' },
  ]) {
    assert.throws(
      () => retargetInitialVerifiedCurrentWritesToStaging([
        prepared('TRANSACTION', 'UPSERT INTO transactions (id) VALUES ($id)'),
        prepared('SOURCE_RECORD', 'UPSERT INTO source_records (id) VALUES ($id)'),
      ], invalidTables),
      (error) => error instanceof ControlledRebuildRetargetError
        && error.code === 'INVALID_STAGING_TABLE_PATH',
    );
  }
});

test('does not mutate source writes or their parameter maps', () => {
  const original = prepared(
    'SOURCE_RECORD',
    'UPSERT INTO source_records (id, classification) VALUES ($id, $classification)',
    {
      id: Object.freeze({ type: 'Uuid', value: '00000000-0000-0000-0000-000000005201' }),
      classification: Object.freeze({ type: 'Utf8', value: 'AMBIGUOUS' }),
    },
  );
  const originalText = original.statement.text;
  const originalParameters = original.statement.parameters;

  retargetInitialVerifiedCurrentWritesToStaging([original], tables);

  assert.equal(original.statement.text, originalText);
  assert.equal(original.statement.parameters, originalParameters);
});
