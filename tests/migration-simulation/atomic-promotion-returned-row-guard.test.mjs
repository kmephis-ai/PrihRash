import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter, writeStatement } from '../../dist/integration/ydb/adapter.js';
import { uuidParameter } from '../../dist/integration/ydb/parameters.js';
import { AtomicPromotionError, assessAtomicPromotionWrites, promoteAtomicDelta } from '../../dist/migration/atomicPromotion.js';
import { createMigrationRun, markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';

const RUN_ID = '00000000-0000-0000-0000-000000009001';
const ENTITY_ID = '00000000-0000-0000-0000-000000009002';
const FINISHED_AT = '2026-09-07T09:30:00.000Z';

function run() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T09:29:00.000Z',
    sourceSnapshotDigest: 'synthetic-guard',
    counters: { rowsSeen: 1, rowsNew: 0, rowsChanged: 1, rowsMissing: 0, rowsAmbiguous: 0 },
  }));
}

function guardedWrite(expectedReturnedRowCount = 1) {
  return Object.freeze({
    statement: writeStatement(
      'UPDATE source_records SET state = $state WHERE id = $id RETURNING id',
      { id: uuidParameter(ENTITY_ID), state: { type: 'Utf8', value: 'MISSING' } },
    ),
    estimatedParameterBytes: 64,
    expectedReturnedRowCount,
  });
}

function transportForRows(rows) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        try {
          const result = await work({
            async execute(statement) {
              events.push(statement.text.startsWith('UPDATE migration_runs ') ? 'marker' : 'guarded-write');
              return statement.text.startsWith('UPDATE migration_runs ') ? { rows: [] } : { rows };
            },
          });
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    },
  };
}

test('zero returned rows aborts the atomic transaction before COMMITTED marker', async () => {
  const fake = transportForRows([]);
  const validated = run();

  await assert.rejects(
    () => promoteAtomicDelta(new YdbAdapter(fake.transport), validated, [guardedWrite()], FINISHED_AT),
    (error) => error instanceof AtomicPromotionError && error.code === 'PROMOTION_WRITE_PRECONDITION_FAILED',
  );

  assert.equal(validated.state, 'VALIDATED');
  assert.deepEqual(fake.events, ['begin', 'guarded-write', 'rollback']);
});

test('exact returned row count permits marker and commit', async () => {
  const fake = transportForRows([{ id: ENTITY_ID }]);
  const result = await promoteAtomicDelta(new YdbAdapter(fake.transport), run(), [guardedWrite()], FINISHED_AT);

  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(fake.events, ['begin', 'guarded-write', 'marker', 'commit']);
});

test('invalid returned-row guard fails preflight before opening a transaction', async () => {
  assert.throws(
    () => assessAtomicPromotionWrites([guardedWrite(-1)]),
    (error) => error instanceof AtomicPromotionError && error.code === 'INVALID_RETURNED_ROW_GUARD',
  );

  const fake = transportForRows([{ id: ENTITY_ID }]);
  await assert.rejects(
    () => promoteAtomicDelta(new YdbAdapter(fake.transport), run(), [guardedWrite(1.5)], FINISHED_AT),
    (error) => error instanceof AtomicPromotionError && error.code === 'INVALID_RETURNED_ROW_GUARD',
  );
  assert.deepEqual(fake.events, []);
});
