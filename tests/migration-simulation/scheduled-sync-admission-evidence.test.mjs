import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ScheduledSyncAdmissionEvidenceError,
  readScheduledSyncAdmissionEvidence,
} from '../../dist/migration/scheduledSyncAdmissionEvidence.js';

function row(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000a01',
    started_at: '2026-09-07T10:00:00.000Z',
    finished_at: '2026-09-07T10:00:05.000Z',
    source_snapshot_digest: 'digest-a',
    state: 'COMMITTED',
    rows_seen: 10n,
    rows_new: 1n,
    rows_changed: 2n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
    ...overrides,
  };
}

function adapterFor(rows, observed = {}) {
  const transport = {
    async executeRead(statement) {
      observed.statement = statement;
      return { rows };
    },
    async serializableReadWrite() {
      observed.writeCalled = true;
      throw new Error('write path must not be called');
    },
  };
  return new YdbAdapter(transport);
}

test('reads only admission fields and returns latest committed baseline deterministically', async () => {
  const observed = {};
  const rows = [
    row({ id: '00000000-0000-0000-0000-000000000a02', finished_at: '2026-09-07T11:00:00.000Z', started_at: '2026-09-07T10:30:00.000Z', source_snapshot_digest: 'digest-b' }),
    row({ id: '00000000-0000-0000-0000-000000000a03', finished_at: '2026-09-07T11:00:00.000Z', started_at: '2026-09-07T10:31:00.000Z', source_snapshot_digest: 'digest-c' }),
    row(),
  ];

  const evidence = await readScheduledSyncAdmissionEvidence(adapterFor(rows, observed));
  assert.equal(evidence.committedBaselineRun.id, '00000000-0000-0000-0000-000000000a03');
  assert.equal(evidence.committedBaselineRun.sourceSnapshotDigest, 'digest-c');
  assert.deepEqual(evidence.incompleteRuns, []);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.incompleteRuns), true);
  assert.equal(observed.statement.kind, 'READ');
  assert.match(observed.statement.text, /FROM migration_runs WHERE state IN \('COMMITTED', 'STAGING', 'VALIDATED'\)$/);
  assert.doesNotMatch(observed.statement.text, /raw_payload|transaction|source_records/i);
  assert.equal(observed.writeCalled, undefined);
});

test('returns all incomplete runs in stable order and ignores FAILED by query contract', async () => {
  const rows = [
    row({ id: '00000000-0000-0000-0000-000000000a12', state: 'VALIDATED', started_at: '2026-09-07T12:00:02.000Z', finished_at: null, source_snapshot_digest: 'digest-v' }),
    row({ id: '00000000-0000-0000-0000-000000000a11', state: 'STAGING', started_at: '2026-09-07T12:00:01.000Z', finished_at: null, source_snapshot_digest: 'digest-s' }),
    row(),
  ];
  const evidence = await readScheduledSyncAdmissionEvidence(adapterFor(rows));
  assert.deepEqual(evidence.incompleteRuns.map((run) => run.id), [
    '00000000-0000-0000-0000-000000000a11',
    '00000000-0000-0000-0000-000000000a12',
  ]);
  assert.equal(evidence.committedBaselineRun.id, '00000000-0000-0000-0000-000000000a01');
});

test('empty relevant history returns null baseline and no incomplete runs', async () => {
  const evidence = await readScheduledSyncAdmissionEvidence(adapterFor([]));
  assert.deepEqual(evidence, { committedBaselineRun: null, incompleteRuns: [] });
});

test('malformed lifecycle evidence fails closed', async () => {
  const malformed = [
    row({ state: 'FAILED' }),
    row({ state: 'COMMITTED', finished_at: null }),
    row({ state: 'STAGING', finished_at: '2026-09-07T10:00:05.000Z' }),
    row({ source_snapshot_digest: '' }),
    row({ rows_seen: -1n }),
    row({ started_at: 'not-a-timestamp' }),
  ];

  for (const value of malformed) {
    await assert.rejects(
      () => readScheduledSyncAdmissionEvidence(adapterFor([value])),
      (error) => error instanceof ScheduledSyncAdmissionEvidenceError && error.code === 'MALFORMED_RUN_EVIDENCE',
    );
  }
});

test('duplicate run ids fail closed', async () => {
  await assert.rejects(
    () => readScheduledSyncAdmissionEvidence(adapterFor([row(), row()])),
    (error) => error instanceof ScheduledSyncAdmissionEvidenceError && error.code === 'DUPLICATE_RUN_EVIDENCE',
  );
});
