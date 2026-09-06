import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InitialBootstrapCandidateError,
  buildInitialBootstrapCandidate,
} from '../../dist/migration/initialBootstrapCandidate.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000201';
const RUN_ID = '00000000-0000-0000-0000-000000000202';
const SOURCE_ID_1 = '00000000-0000-0000-0000-000000000203';
const SOURCE_ID_2 = '00000000-0000-0000-0000-000000000204';

function build(overrides = {}) {
  return buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-06T19:30:00Z',
    startedAt: '2026-09-06T19:30:01Z',
    snapshotDigest: 'snapshot-digest',
    rows: [
      { sourceRecordId: SOURCE_ID_1, rowHint: 2, digest: 'same-digest' },
      { sourceRecordId: SOURCE_ID_2, rowHint: 3, digest: 'same-digest' },
    ],
    ...overrides,
  });
}

test('initial bootstrap candidate keeps snapshot manifest, plan and STAGING run consistent', () => {
  const candidate = build();

  assert.equal(candidate.snapshot.sourceSheet, 'Ответы на форму (11)');
  assert.equal(candidate.snapshot.rowCount, 2);
  assert.equal(candidate.plan.candidates.length, 2);
  assert.deepEqual(candidate.run, {
    id: RUN_ID,
    startedAt: '2026-09-06T19:30:01Z',
    finishedAt: null,
    sourceSnapshotDigest: 'snapshot-digest',
    state: 'STAGING',
    rowsSeen: 2,
    rowsNew: 2,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
  });
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.snapshot), true);
  assert.equal(Object.isFrozen(candidate.plan), true);
  assert.equal(Object.isFrozen(candidate.run), true);
});

test('exact duplicate row digests stay as separate bootstrap candidates', () => {
  const candidate = build();
  assert.deepEqual(candidate.plan.candidates.map((row) => row.sourceRecordId), [SOURCE_ID_1, SOURCE_ID_2]);
});

for (const [name, overrides, code] of [
  ['invalid snapshot UUID', { snapshotId: 'bad-id' }, 'INVALID_SNAPSHOT_ID'],
  ['invalid MigrationRun UUID', { migrationRunId: 'bad-id' }, 'INVALID_MIGRATION_RUN_ID'],
  ['empty snapshot digest', { snapshotDigest: '   ' }, 'EMPTY_SNAPSHOT_DIGEST'],
]) {
  test(`initial bootstrap candidate fails closed for ${name}`, () => {
    assert.throws(
      () => build(overrides),
      (error) => error instanceof InitialBootstrapCandidateError && error.code === code,
    );
  });
}
