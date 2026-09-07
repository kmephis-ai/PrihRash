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
const OTHER_RUN_ID = '00000000-0000-0000-0000-000000000899';

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

function admissionRun(input, overrides = {}) {
  return {
    id: input.run.id,
    started_at: input.run.startedAt,
    finished_at: input.run.finishedAt,
    source_snapshot_digest: input.run.sourceSnapshotDigest,
    state: input.run.state,
    rows_seen: BigInt(input.run.rowsSeen),
    rows_new: BigInt(input.run.rowsNew),
    rows_changed: BigInt(input.run.rowsChanged),
    rows_missing: BigInt(input.run.rowsMissing),
    rows_ambiguous: BigInt(input.run.rowsAmbiguous),
    error_code: input.run.errorCode,
    ...overrides,
  };
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
    admission: admissionRun(input),
  };
}

function fakeTransport({ admissionBefore = [], snapshot = [], run = [], admissionAfter = [] }) {
  const events = [];
  let admissionReads = 0;
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
            if (statement.text.includes("FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
              events.push('admission');
              const rows = admissionReads === 0 ? admissionBefore : admissionAfter;
              admissionReads += 1;
              return { rows };
            }
            events.push('readback');
            if (statement.text.includes('FROM source_snapshots WHERE id = $id')) return { rows: snapshot };
            return { rows: run };
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

function expectExecutorError(code, work) {
  return assert.rejects(
    work,
    (error) => error instanceof InitialBootstrapMetadataExecutorError && error.code === code,
  );
}

test('atomically claims an empty bootstrap state and verifies the sole STAGING claimant', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const fake = fakeTransport({
    admissionBefore: [],
    snapshot: [expected.snapshot],
    run: [expected.run],
    admissionAfter: [expected.admission],
  });

  await executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes);
  assert.deepEqual(
    fake.events,
    ['begin', 'admission', 'write', 'write', 'readback', 'readback', 'admission', 'commit'],
  );
});

test('existing STAGING or VALIDATED run blocks the initial claim before metadata writes', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);

  for (const state of ['STAGING', 'VALIDATED']) {
    const existing = admissionRun(input, { id: OTHER_RUN_ID, state });
    const fake = fakeTransport({ admissionBefore: [existing] });

    await expectExecutorError(
      'IN_FLIGHT_RUN_EXISTS',
      () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
    );
    assert.deepEqual(fake.events, ['begin', 'admission', 'rollback']);
  }
});

test('existing COMMITTED baseline blocks a second initial bootstrap claim', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const committed = admissionRun(input, {
    id: OTHER_RUN_ID,
    state: 'COMMITTED',
    finished_at: '2026-09-06T20:11:00Z',
  });
  const fake = fakeTransport({ admissionBefore: [committed] });

  await expectExecutorError(
    'COMMITTED_BASELINE_EXISTS',
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
  );
  assert.deepEqual(fake.events, ['begin', 'admission', 'rollback']);
});

test('concurrent or stale post-admission evidence rolls back instead of accepting a second claimant', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const concurrent = admissionRun(input, { id: OTHER_RUN_ID, started_at: '2026-09-06T20:10:02Z' });
  const fake = fakeTransport({
    admissionBefore: [],
    snapshot: [expected.snapshot],
    run: [expected.run],
    admissionAfter: [concurrent, expected.admission],
  });

  await expectExecutorError(
    'CLAIM_READBACK_MISMATCH',
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('post-admission evidence for a different sole claimant rolls back', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const different = admissionRun(input, { id: OTHER_RUN_ID });
  const fake = fakeTransport({
    admissionBefore: [],
    snapshot: [expected.snapshot],
    run: [expected.run],
    admissionAfter: [different],
  });

  await expectExecutorError(
    'CLAIM_READBACK_MISMATCH',
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('snapshot read-back mismatch rolls back both metadata writes', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const fake = fakeTransport({
    admissionBefore: [],
    snapshot: [{ ...expected.snapshot, row_count: 2n }],
    run: [expected.run],
    admissionAfter: [expected.admission],
  });

  await expectExecutorError(
    'SNAPSHOT_READBACK_MISMATCH',
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('run read-back mismatch rolls back instead of accepting non-STAGING metadata', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const expected = expectedRows(input);
  const fake = fakeTransport({
    admissionBefore: [],
    snapshot: [expected.snapshot],
    run: [{ ...expected.run, state: 'VALIDATED' }],
    admissionAfter: [expected.admission],
  });

  await expectExecutorError(
    'RUN_READBACK_MISMATCH',
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, writes),
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('invalid metadata write role/order fails before transaction begin', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const fake = fakeTransport({});

  await expectExecutorError(
    'METADATA_WRITE_SET_INVALID',
    () => executeInitialBootstrapMetadataWrites(new YdbAdapter(fake.transport), input, [writes[1], writes[0]]),
  );
  assert.deepEqual(fake.events, []);
});
