import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatement, YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ControlledRebuildStagingExecutorError,
  executeControlledRebuildStagingBatches,
  prepareControlledRebuildStagingBatches,
} from '../../dist/migration/initialControlledRebuildStagingExecutor.js';

const tables = Object.freeze({
  transactions: 'rebuild/r_00000000000000000000000000007001/transactions',
  sourceRecords: 'rebuild/r_00000000000000000000000000007001/source_records',
});

function prepared(role, sourceRecordId, bytes = 100) {
  return Object.freeze({
    role,
    sourceRecordId,
    statement: writeStatement(
      role === 'TRANSACTION'
        ? 'UPSERT INTO transactions (id) VALUES ($id)'
        : 'UPSERT INTO source_records (id) VALUES ($id)',
      { id: Object.freeze({ type: 'Uuid', value: sourceRecordId }) },
    ),
    estimatedParameterBytes: bytes,
  });
}

function controlled() {
  const first = prepared('TRANSACTION', '00000000-0000-0000-0000-000000007101');
  const second = prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000007101');
  const third = prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000007102');
  return Object.freeze({
    runId: '00000000-0000-0000-0000-000000007001',
    stagingTables: tables,
    batches: Object.freeze([
      Object.freeze({ index: 0, writes: Object.freeze([first, second]), estimatedParameterBytes: 456 }),
      Object.freeze({ index: 1, writes: Object.freeze([third]), estimatedParameterBytes: 356 }),
    ]),
    replacements: Object.freeze([]),
    expectedSourceRecordCount: 2,
    expectedTransactionCount: 1,
  });
}

function fakeTransport(failOnWriteOrdinal = null) {
  const events = [];
  let writeOrdinal = 0;
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            writeOrdinal += 1;
            events.push(statement.text);
            if (writeOrdinal === failOnWriteOrdinal) throw new Error('synthetic staging write failure');
            return { rows: [] };
          },
        };
        try {
          const result = await work(transaction);
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

test('prepares exact run-scoped staging targets and rechecks calibrated batch eligibility', () => {
  const batches = prepareControlledRebuildStagingBatches(controlled());

  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map((batch) => batch.index), [0, 1]);
  assert.equal(batches[0].writes[0].statement.text.startsWith('UPSERT INTO `rebuild/r_00000000000000000000000000007001/transactions` '), true);
  assert.equal(batches[0].writes[1].statement.text.startsWith('UPSERT INTO `rebuild/r_00000000000000000000000000007001/source_records` '), true);
  assert.equal(batches.every((batch) => batch.estimatedParameterBytes > 0), true);
  assert.equal(Object.isFrozen(batches), true);
});

test('executes each prepared batch in its own serializable transaction', async () => {
  const batches = prepareControlledRebuildStagingBatches(controlled());
  const fake = fakeTransport();
  const result = await executeControlledRebuildStagingBatches(new YdbAdapter(fake.transport), batches);

  assert.deepEqual(result, { completedBatchIndexes: [0, 1], completedWriteCount: 3 });
  assert.deepEqual(fake.events.filter((event) => event === 'begin'), ['begin', 'begin']);
  assert.deepEqual(fake.events.filter((event) => event === 'commit'), ['commit', 'commit']);
  assert.equal(fake.events.some((event) => typeof event === 'string' && event.includes('UPSERT INTO transactions ')), false);
  assert.equal(Object.isFrozen(result), true);
});

test('later batch failure rolls back only that staging transaction and never runs a swap/marker', async () => {
  const batches = prepareControlledRebuildStagingBatches(controlled());
  const fake = fakeTransport(3);

  await assert.rejects(
    () => executeControlledRebuildStagingBatches(new YdbAdapter(fake.transport), batches),
    /synthetic staging write failure/,
  );
  assert.deepEqual(fake.events.filter((event) => event === 'commit'), ['commit']);
  assert.deepEqual(fake.events.at(-1), 'rollback');
  assert.equal(fake.events.some((event) => typeof event === 'string' && event.includes('migration_runs')), false);
  assert.equal(fake.events.some((event) => typeof event === 'string' && event.includes('RENAME')), false);
});

test('rejects non-contiguous batch indexes before execution', async () => {
  const invalid = Object.freeze([
    Object.freeze({ index: 1, writes: Object.freeze([prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000007101')]), estimatedParameterBytes: 100 }),
  ]);

  assert.throws(
    () => prepareControlledRebuildStagingBatches(Object.freeze({ ...controlled(), batches: invalid })),
    (error) => error instanceof ControlledRebuildStagingExecutorError && error.code === 'INVALID_BATCH_INDEX',
  );
});

test('rejects a retargeted batch that no longer fits calibrated atomic preflight', () => {
  const huge = Object.freeze([
    Object.freeze({
      index: 0,
      writes: Object.freeze([prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000007101', 600_000)]),
      estimatedParameterBytes: 600_000,
    }),
  ]);

  assert.throws(
    () => prepareControlledRebuildStagingBatches(Object.freeze({ ...controlled(), batches: huge })),
    (error) => error instanceof ControlledRebuildStagingExecutorError
      && error.code === 'STAGING_BATCH_NOT_ATOMIC_ELIGIBLE',
  );
});
