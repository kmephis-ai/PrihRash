import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMigrationRun,
  markMigrationRunCommitted,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';
import {
  IncrementalCommittedBaselineError,
  buildIncrementalCommittedBaseline,
  buildIncrementalLineagePlanFromCommittedBaseline,
} from '../../dist/migration/incrementalCommittedBaseline.js';

const RUN_ID = '00000000-0000-0000-0000-000000002101';
const ACTIVE_A = '00000000-0000-0000-0000-000000002102';
const ACTIVE_B = '00000000-0000-0000-0000-000000002103';
const MISSING_ID = '00000000-0000-0000-0000-000000002104';
const NEW_ID = '00000000-0000-0000-0000-000000002105';

function committedRun() {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T05:30:00.000Z',
    sourceSnapshotDigest: 'committed-snapshot',
    counters: { rowsSeen: 2, rowsNew: 0, rowsChanged: 0, rowsMissing: 1, rowsAmbiguous: 0 },
  });
  return markMigrationRunCommitted(
    markMigrationRunValidated(staging),
    '2026-09-07T05:30:05.000Z',
  );
}

function record(overrides = {}) {
  return {
    id: ACTIVE_A,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    lastRowHint: 2,
    currentDigest: 'digest-a',
    state: null,
    currentRevision: 3,
    ...overrides,
  };
}

test('derives ordered active previous sequence while reserving active and MISSING identities', () => {
  const baseline = buildIncrementalCommittedBaseline(committedRun(), [
    record({ id: ACTIVE_B, lastRowHint: 5, currentDigest: 'digest-b', currentRevision: 2 }),
    record({ id: MISSING_ID, lastRowHint: 2, currentDigest: 'digest-missing', state: 'MISSING', currentRevision: 4 }),
    record({ id: ACTIVE_A, lastRowHint: 3, currentDigest: 'digest-a', currentRevision: 3 }),
  ]);

  assert.deepEqual(baseline.previousSequence, [
    { sourceRecordId: ACTIVE_A, rowHint: 3, digest: 'digest-a' },
    { sourceRecordId: ACTIVE_B, rowHint: 5, digest: 'digest-b' },
  ]);
  assert.deepEqual(baseline.reservedSourceRecordIds, [ACTIVE_A, ACTIVE_B, MISSING_ID].sort());
  assert.equal(Object.isFrozen(baseline), true);
  assert.equal(Object.isFrozen(baseline.previousSequence), true);
  assert.equal(Object.isFrozen(baseline.reservedSourceRecordIds), true);
});

test('MISSING row hint may overlap active locator without entering the observed previous sequence', () => {
  const baseline = buildIncrementalCommittedBaseline(committedRun(), [
    record({ id: ACTIVE_A, lastRowHint: 2 }),
    record({ id: MISSING_ID, lastRowHint: 2, currentDigest: 'old', state: 'MISSING' }),
  ]);
  assert.equal(baseline.previousSequence.length, 1);
  assert.equal(baseline.reservedSourceRecordIds.length, 2);
});

test('baseline requires exact COMMITTED run evidence', () => {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T05:30:00.000Z',
    sourceSnapshotDigest: 'not-committed',
    counters: { rowsSeen: 0, rowsNew: 0, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  });
  assert.throws(
    () => buildIncrementalCommittedBaseline(staging, []),
    (error) => error instanceof IncrementalCommittedBaselineError
      && error.code === 'RUN_NOT_COMMITTED',
  );
});

test('invalid source lineage metadata fails closed before diff construction', () => {
  const run = committedRun();
  const cases = [
    [record({ id: 'not-a-uuid' }), 'INVALID_SOURCE_RECORD_ID'],
    [[record(), record({ id: ACTIVE_A.toUpperCase(), lastRowHint: 3 })], 'DUPLICATE_SOURCE_RECORD_ID'],
    [record({ sourceType: 'OTHER' }), 'INVALID_SOURCE_TYPE'],
    [record({ sourceSheet: 'Other sheet' }), 'INVALID_SOURCE_SHEET'],
    [record({ state: 'UNKNOWN' }), 'INVALID_SOURCE_STATE'],
    [record({ lastRowHint: 0 }), 'INVALID_ROW_HINT'],
    [record({ currentDigest: '   ' }), 'EMPTY_DIGEST'],
    [record({ currentRevision: 0 }), 'INVALID_CURRENT_REVISION'],
  ];

  for (const [input, code] of cases) {
    const records = Array.isArray(input) ? input : [input];
    assert.throws(
      () => buildIncrementalCommittedBaseline(run, records),
      (error) => error instanceof IncrementalCommittedBaselineError && error.code === code,
    );
  }

  assert.throws(
    () => buildIncrementalCommittedBaseline(run, [
      record({ id: ACTIVE_A, lastRowHint: 2 }),
      record({ id: ACTIVE_B, lastRowHint: 2 }),
    ]),
    (error) => error instanceof IncrementalCommittedBaselineError
      && error.code === 'DUPLICATE_ACTIVE_ROW_HINT',
  );
});

test('new INSERTED assignment cannot reuse any reserved historical identity including MISSING', () => {
  const baseline = buildIncrementalCommittedBaseline(committedRun(), [
    record({ id: ACTIVE_A, lastRowHint: 2, currentDigest: 'anchor' }),
    record({ id: MISSING_ID, lastRowHint: 7, currentDigest: 'old-missing', state: 'MISSING' }),
  ]);

  assert.throws(
    () => buildIncrementalLineagePlanFromCommittedBaseline(
      baseline,
      [
        { rowHint: 2, digest: 'anchor' },
        { rowHint: 3, digest: 'new-row' },
      ],
      [{ currentRowHint: 3, sourceRecordId: MISSING_ID }],
    ),
    (error) => error instanceof IncrementalCommittedBaselineError
      && error.code === 'RESERVED_SOURCE_RECORD_ID_ASSIGNMENT',
  );
});

test('unreserved explicit INSERTED identity proceeds through the existing lineage planner', () => {
  const baseline = buildIncrementalCommittedBaseline(committedRun(), [
    record({ id: ACTIVE_A, lastRowHint: 2, currentDigest: 'anchor' }),
    record({ id: MISSING_ID, lastRowHint: 7, currentDigest: 'old-missing', state: 'MISSING' }),
  ]);
  const lineage = buildIncrementalLineagePlanFromCommittedBaseline(
    baseline,
    [
      { rowHint: 2, digest: 'anchor' },
      { rowHint: 3, digest: 'new-row' },
    ],
    [{ currentRowHint: 3, sourceRecordId: NEW_ID }],
  );

  assert.equal(lineage.counters.rowsNew, 1);
  assert.deepEqual(lineage.outcomes.at(-1), {
    kind: 'INSERTED',
    sourceRecordId: NEW_ID,
    currentRowHint: 3,
    digest: 'new-row',
  });
});
