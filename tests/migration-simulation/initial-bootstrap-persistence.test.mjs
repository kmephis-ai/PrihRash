import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import {
  InitialBootstrapPersistenceError,
  prepareInitialBootstrapMetadataWrites,
} from '../../dist/migration/initialBootstrapPersistence.js';
import { markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000301';
const RUN_ID = '00000000-0000-0000-0000-000000000302';
const SOURCE_ID = '00000000-0000-0000-0000-000000000303';

function candidate() {
  return buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-06T19:40:00Z',
    startedAt: '2026-09-06T19:40:01Z',
    snapshotDigest: 'synthetic-snapshot-digest',
    rows: [
      { sourceRecordId: SOURCE_ID, rowHint: 2, digest: 'synthetic-row-digest' },
    ],
  });
}

function expectPersistenceError(code, work) {
  assert.throws(
    work,
    (error) => error instanceof InitialBootstrapPersistenceError && error.code === code,
  );
}

test('prepares deterministic non-overwriting source snapshot and STAGING migration run writes', () => {
  const writes = prepareInitialBootstrapMetadataWrites(candidate());

  assert.equal(writes.length, 2);
  assert.equal(Object.isFrozen(writes), true);
  assert.equal(writes.every((write) => Object.isFrozen(write)), true);
  assert.equal(writes.every((write) => write.statement.kind === 'WRITE'), true);
  assert.equal(writes.every((write) => write.estimatedParameterBytes > 0), true);

  const [snapshotWrite, runWrite] = writes;
  assert.match(snapshotWrite.statement.text, /^INSERT INTO source_snapshots /);
  assert.deepEqual(snapshotWrite.statement.parameters, {
    id: { type: 'Uuid', value: SNAPSHOT_ID },
    captured_at: { type: 'Timestamp', value: '2026-09-06T19:40:00Z' },
    source_sheet: { type: 'Utf8', value: 'Ответы на форму (11)' },
    snapshot_digest: { type: 'String', value: 'synthetic-snapshot-digest' },
    row_count: { type: 'Uint64', value: 1n },
  });

  assert.match(runWrite.statement.text, /^INSERT INTO migration_runs /);
  assert.deepEqual(runWrite.statement.parameters, {
    id: { type: 'Uuid', value: RUN_ID },
    started_at: { type: 'Timestamp', value: '2026-09-06T19:40:01Z' },
    finished_at: { type: 'Timestamp', value: null },
    source_snapshot_digest: { type: 'String', value: 'synthetic-snapshot-digest' },
    state: { type: 'Utf8', value: 'STAGING' },
    rows_seen: { type: 'Uint64', value: 1n },
    rows_new: { type: 'Uint64', value: 1n },
    rows_changed: { type: 'Uint64', value: 0n },
    rows_missing: { type: 'Uint64', value: 0n },
    rows_ambiguous: { type: 'Uint64', value: 0n },
    error_code: { type: 'Utf8', value: null },
  });
});

test('rejects a non-STAGING candidate before persistence preparation', () => {
  const base = candidate();
  const invalid = {
    ...base,
    run: markMigrationRunValidated(base.run),
  };

  expectPersistenceError(
    'RUN_NOT_STAGING',
    () => prepareInitialBootstrapMetadataWrites(invalid),
  );
});

test('rejects snapshot/run digest mismatch', () => {
  const base = candidate();
  const invalid = {
    ...base,
    snapshot: { ...base.snapshot, snapshotDigest: 'other-digest' },
  };

  expectPersistenceError(
    'SNAPSHOT_RUN_DIGEST_MISMATCH',
    () => prepareInitialBootstrapMetadataWrites(invalid),
  );
});

test('rejects snapshot row count mismatch', () => {
  const base = candidate();
  const invalid = {
    ...base,
    snapshot: { ...base.snapshot, rowCount: 2 },
  };

  expectPersistenceError(
    'SNAPSHOT_ROW_COUNT_MISMATCH',
    () => prepareInitialBootstrapMetadataWrites(invalid),
  );
});

test('rejects migration run counters inconsistent with bootstrap plan', () => {
  const base = candidate();
  const invalid = {
    ...base,
    run: { ...base.run, rowsNew: 0 },
  };

  expectPersistenceError(
    'RUN_COUNTERS_MISMATCH',
    () => prepareInitialBootstrapMetadataWrites(invalid),
  );
});
