import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMigrationRun,
  markMigrationRunCommitted,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';
import {
  buildIncrementalCommittedBaseline,
  buildIncrementalLineagePlanFromCommittedBaseline,
} from '../../dist/migration/incrementalCommittedBaseline.js';
import {
  IncrementalSourceDeltaIntentError,
  buildIncrementalSourceDeltaIntentPlan,
} from '../../dist/migration/incrementalSourceDeltaIntent.js';

const RUN_ID = '00000000-0000-0000-0000-000000002201';
const A = '00000000-0000-0000-0000-000000002202';
const B = '00000000-0000-0000-0000-000000002203';
const C = '00000000-0000-0000-0000-000000002204';
const D = '00000000-0000-0000-0000-000000002205';
const E = '00000000-0000-0000-0000-000000002206';
const NEW_ID = '00000000-0000-0000-0000-000000002207';
const HISTORICAL_MISSING = '00000000-0000-0000-0000-000000002208';
const OBSERVED_AT = '2026-09-07T05:40:00.000Z';

function committedRun() {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T05:39:00.000Z',
    sourceSnapshotDigest: 'previous-committed',
    counters: { rowsSeen: 5, rowsNew: 0, rowsChanged: 0, rowsMissing: 1, rowsAmbiguous: 0 },
  });
  return markMigrationRunCommitted(
    markMigrationRunValidated(staging),
    '2026-09-07T05:39:05.000Z',
  );
}

function sourceRecord(id, rowHint, digest, currentRevision, state = null) {
  return {
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    lastRowHint: rowHint,
    currentDigest: digest,
    state,
    currentRevision,
  };
}

function baselineAndEvidence() {
  const records = [
    sourceRecord(A, 2, 'a', 1),
    sourceRecord(B, 3, 'b', 4),
    sourceRecord(C, 4, 'c', 2),
    sourceRecord(D, 5, 'd', 3),
    sourceRecord(E, 6, 'e', 5),
    sourceRecord(HISTORICAL_MISSING, 9, 'old-missing', 2, 'MISSING'),
  ];
  const baseline = buildIncrementalCommittedBaseline(committedRun(), records);
  const previousEvidence = records
    .filter((record) => record.state === null)
    .map((record) => ({
      sourceRecordId: record.id,
      lastRowHint: record.lastRowHint,
      currentDigest: record.currentDigest,
      currentRevision: record.currentRevision,
    }));
  return { baseline, previousEvidence };
}

function mixedInputs() {
  const { baseline, previousEvidence } = baselineAndEvidence();
  const lineage = buildIncrementalLineagePlanFromCommittedBaseline(
    baseline,
    [
      { rowHint: 2, digest: 'a' },
      { rowHint: 3, digest: 'b2' },
      { rowHint: 4, digest: 'c' },
      { rowHint: 6, digest: 'e' },
      { rowHint: 7, digest: 'new' },
    ],
    [{ currentRowHint: 7, sourceRecordId: NEW_ID }],
  );
  const revisions = {
    revisions: [
      {
        sourceRecordId: B,
        revision: 5,
        migrationRunId: '00000000-0000-0000-0000-000000002209',
        observedAt: OBSERVED_AT,
        rowHint: 3,
        rowDigest: 'b2',
        changeClass: 'OWNER_CORRECTION',
        rawPayload: '{"synthetic":true}',
      },
      {
        sourceRecordId: NEW_ID,
        revision: 1,
        migrationRunId: '00000000-0000-0000-0000-000000002209',
        observedAt: OBSERVED_AT,
        rowHint: 7,
        rowDigest: 'new',
        changeClass: null,
        rawPayload: '{"synthetic":true}',
      },
    ],
  };
  return { baseline, previousEvidence, lineage, revisions };
}

test('builds exact TOUCH/REVISE/MARK_MISSING/CREATE intents without semantic fields', () => {
  const { baseline, previousEvidence, lineage, revisions } = mixedInputs();
  const plan = buildIncrementalSourceDeltaIntentPlan(
    baseline,
    lineage,
    revisions,
    previousEvidence,
    OBSERVED_AT,
  );

  assert.deepEqual(plan.intents, [
    {
      kind: 'TOUCH', sourceRecordId: A, expectedRevision: 1, expectedDigest: 'a',
      previousRowHint: 2, currentRowHint: 2, observedAt: OBSERVED_AT,
    },
    {
      kind: 'REVISE', sourceRecordId: B, expectedPreviousRevision: 4, expectedPreviousDigest: 'b',
      previousRowHint: 3, currentRevision: 5, currentDigest: 'b2', currentRowHint: 3,
      observedAt: OBSERVED_AT,
    },
    {
      kind: 'TOUCH', sourceRecordId: C, expectedRevision: 2, expectedDigest: 'c',
      previousRowHint: 4, currentRowHint: 4, observedAt: OBSERVED_AT,
    },
    {
      kind: 'MARK_MISSING', sourceRecordId: D, expectedRevision: 3,
      expectedDigest: 'd', previousRowHint: 5,
    },
    {
      kind: 'TOUCH', sourceRecordId: E, expectedRevision: 5, expectedDigest: 'e',
      previousRowHint: 6, currentRowHint: 6, observedAt: OBSERVED_AT,
    },
    {
      kind: 'CREATE', sourceRecordId: NEW_ID, currentRevision: 1,
      currentDigest: 'new', currentRowHint: 7, observedAt: OBSERVED_AT,
    },
  ]);
  assert.deepEqual(plan.unresolvedBlocks, []);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.intents), true);
  assert.equal(Object.isFrozen(plan.intents[0]), true);
  for (const intent of plan.intents) {
    assert.equal('classification' in intent, false);
    assert.equal('normalizationStatus' in intent, false);
    assert.equal('transactionId' in intent, false);
  }
});

test('AMBIGUOUS_BLOCK creates immutable unresolved evidence and no mutation intents', () => {
  const records = [
    sourceRecord(A, 2, 'old-a', 1),
    sourceRecord(B, 3, 'old-b', 2),
  ];
  const baseline = buildIncrementalCommittedBaseline(committedRun(), records);
  const lineage = buildIncrementalLineagePlanFromCommittedBaseline(
    baseline,
    [
      { rowHint: 2, digest: 'new-a' },
      { rowHint: 3, digest: 'new-b' },
    ],
    [],
  );
  const previousEvidence = records.map((record) => ({
    sourceRecordId: record.id,
    lastRowHint: record.lastRowHint,
    currentDigest: record.currentDigest,
    currentRevision: record.currentRevision,
  }));
  const plan = buildIncrementalSourceDeltaIntentPlan(
    baseline, lineage, { revisions: [] }, previousEvidence, OBSERVED_AT,
  );

  assert.deepEqual(plan.intents, []);
  assert.deepEqual(plan.unresolvedBlocks, [{
    previousSourceRecordIds: [A, B],
    previousRowHints: [2, 3],
    currentRowHints: [2, 3],
  }]);
  assert.equal(Object.isFrozen(plan.unresolvedBlocks[0]), true);
  assert.equal(Object.isFrozen(plan.unresolvedBlocks[0].previousSourceRecordIds), true);
});

test('previous active evidence must exactly match the committed baseline', () => {
  const { baseline, previousEvidence, lineage, revisions } = mixedInputs();

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage, revisions,
      previousEvidence.filter((item) => item.sourceRecordId !== B), OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'MISSING_PREVIOUS_SOURCE_EVIDENCE',
  );

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage, revisions,
      previousEvidence.map((item) => item.sourceRecordId === B
        ? { ...item, currentDigest: 'wrong' }
        : item), OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'PREVIOUS_BASELINE_EVIDENCE_MISMATCH',
  );

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage, revisions,
      [...previousEvidence, {
        sourceRecordId: HISTORICAL_MISSING,
        lastRowHint: 9,
        currentDigest: 'old-missing',
        currentRevision: 2,
      }], OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'EXTRA_PREVIOUS_SOURCE_EVIDENCE',
  );
});

test('revision evidence must exactly cover INSERTED and REVISED lineage outcomes', () => {
  const { baseline, previousEvidence, lineage, revisions } = mixedInputs();

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage,
      { revisions: revisions.revisions.filter((revision) => revision.sourceRecordId !== B) },
      previousEvidence, OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'MISSING_REVISION_EVIDENCE',
  );

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage,
      { revisions: revisions.revisions.map((revision) => revision.sourceRecordId === B
        ? { ...revision, revision: 6 }
        : revision) },
      previousEvidence, OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'REVISION_LINEAGE_MISMATCH',
  );

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage,
      { revisions: [...revisions.revisions, {
        sourceRecordId: A,
        revision: 2,
        migrationRunId: '00000000-0000-0000-0000-000000002209',
        observedAt: OBSERVED_AT,
        rowHint: 2,
        rowDigest: 'a',
        changeClass: 'OWNER_CORRECTION',
        rawPayload: '{"synthetic":true}',
      }] },
      previousEvidence, OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'EXTRA_REVISION_EVIDENCE',
  );
});

test('INSERTED identity cannot bypass committed baseline reserved-ID protection', () => {
  const { baseline, previousEvidence } = baselineAndEvidence();
  const lineage = {
    outcomes: [{
      kind: 'INSERTED',
      sourceRecordId: HISTORICAL_MISSING,
      currentRowHint: 10,
      digest: 'attempted-reuse',
    }],
    counters: { rowsSeen: 1, rowsNew: 1, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  };
  const revisions = { revisions: [{
    sourceRecordId: HISTORICAL_MISSING,
    revision: 1,
    migrationRunId: '00000000-0000-0000-0000-000000002209',
    observedAt: OBSERVED_AT,
    rowHint: 10,
    rowDigest: 'attempted-reuse',
    changeClass: null,
    rawPayload: '{"synthetic":true}',
  }] };

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline, lineage, revisions, previousEvidence, OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'RESERVED_INSERTED_SOURCE_ID',
  );
});
