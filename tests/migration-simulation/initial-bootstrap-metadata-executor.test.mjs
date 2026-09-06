import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import { prepareInitialBootstrapMetadataWrites } from '../../dist/migration/initialBootstrapPersistence.js';
import {
  InitialBootstrapMetadataExecutorError,
  executeInitialBootstrapMetadataWrites,
} from '../../dist/migration/initialBootstrapMetadataExecutor.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000801';
const RUN_ID = '00000000-0000-0000-0000-000000000802';
const SOURCE_ID = '00000000-0000-0000-0000-000000000803';

function candidate() {
  return buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-06T20:10:00Z',
    startedAt: '2026-09-06T20:10:01Z',
    snapshotDigest: 'synthetic-snapshot-digest',
    rows: [{ sourceRecordId: SOURCE_ID, rowHint: 2, digest: 'synthetic-row-digest' }],
  });
}

function expectedRows(input) {
  return {
    snapshot: {
      captured_at: input.snapshot.capturedAt,
      source_sheet: input.snapshot.sourceSheet,
      snapshot_digest: input.snapshot.snapshotDigest,
      row_count: BigInt(input.snapshot.rowCount),
    },
    run: {
      started_at: input.run.startedAt,
      finished_at: null,
      source_snapshot_digest: input.run.sourceSnapshotDigest,
      state: 'STAGING',
      rows_seen: BigInt(input.run.rowsSeen),
      rows_new: BigInt(input.run.rowsNew),
      rows_changed: 0n,
      rows_missing: 0n,
      rows_ambiguous: 0n,
      error_code: null,
    },
  };
}

function fakeTransport(rows) {
  const events = [];
  let readIndex = 0;
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            if (statement.kind === 'WRITE') {
              events.push('write');
              return { rows: [] };
            }
            events.push('readback');
            const value = readIndex === 0 ? rows.snapshot : rows.run;
            readIndex += 1;
            return { rows: value };
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

test('persists snapshot and STAGING run evidence atomically with matching read-back', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const fake = fakeTransport({ snapshot: [expected.snapshot], run: [expected.run] });

  await executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes);
  assert.deepEqual(fake.events, ['begin', 'write', 'write', 'readback', 'readback', 'commit']);
});

test('snapshot read-back mismatch rolls back both metadata writes', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const fake = fakeTransport({ snapshot: [{ ...expected.snapshot, row_count: 2n }], run: [expected.run] });

  await assert.rejects(
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
    (error) => error instanceof InitialBootstrapMetadataExecutorError
      && error.code === 'SNAPSHOT_READBACK_MISMATCH',
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('run read-back mismatch rolls back instead of accepting non-STAGING metadata', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const fake = fakeTransport({ snapshot: [expected.snapshot], run: [{ ...expected.run, state: 'VALIDATED' }] });

  await assert.rejects(
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
    (error) => error instanceof InitialBootstrapMetadataExecutorError
      && error.code === 'RUN_READBACK_MISMATCH',
  );
});

test('invalid metadata write role/order fails before transaction begin', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const fake = fakeTransport({ snapshot: [], run: [] });

  await assert.rejects(
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, [writes[1], writes[0]]),
    (error) => error instanceof InitialBootstrapMetadataExecutorError
      && error.code === 'METADATA_WRITE_SET_INVALID',
  );
  assert.deepEqual(fake.events, []);
});
