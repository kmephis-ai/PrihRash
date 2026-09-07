import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalSourceDeltaIntentError,
  buildIncrementalSourceDeltaIntentPlan,
} from '../../dist/migration/incrementalSourceDeltaIntent.js';

const A = '00000000-0000-0000-0000-000000002301';
const B = '00000000-0000-0000-0000-000000002302';
const NEW_ID = '00000000-0000-0000-0000-000000002303';
const OBSERVED_AT = '2026-09-07T05:45:00.000Z';

function baseline() {
  return {
    previousSequence: [
      { sourceRecordId: A, rowHint: 2, digest: 'a' },
      { sourceRecordId: B, rowHint: 3, digest: 'b' },
    ],
    reservedSourceRecordIds: [A, B],
  };
}

function previousEvidence() {
  return [
    { sourceRecordId: A, lastRowHint: 2, currentDigest: 'a', currentRevision: 1 },
    { sourceRecordId: B, lastRowHint: 3, currentDigest: 'b', currentRevision: 2 },
  ];
}

test('partial lineage cannot silently omit an active committed source record', () => {
  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline(),
      {
        outcomes: [{
          kind: 'UNCHANGED',
          sourceRecordId: A,
          previousRowHint: 2,
          currentRowHint: 2,
          digest: 'a',
        }],
        counters: { rowsSeen: 1, rowsNew: 0, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
      },
      { revisions: [] },
      previousEvidence(),
      OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'LINEAGE_PREVIOUS_COVERAGE_MISMATCH',
  );
});

test('ambiguous previous-side lineage evidence must match committed IDs and row hints exactly', () => {
  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      baseline(),
      {
        outcomes: [{
          kind: 'AMBIGUOUS_BLOCK',
          previousSourceRecordIds: [A, B],
          previousRowHints: [2, 99],
          currentRowHints: [2, 3],
        }],
        counters: { rowsSeen: 2, rowsNew: 0, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 2 },
      },
      { revisions: [] },
      previousEvidence(),
      OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'AMBIGUOUS_BLOCK_PREVIOUS_EVIDENCE_MISMATCH',
  );
});

test('revision observation timestamp must be the same snapshot observation as the intent', () => {
  const singleBaseline = {
    previousSequence: [{ sourceRecordId: A, rowHint: 2, digest: 'a' }],
    reservedSourceRecordIds: [A],
  };
  const lineage = {
    outcomes: [
      {
        kind: 'REVISED',
        sourceRecordId: A,
        previousRowHint: 2,
        currentRowHint: 2,
        previousDigest: 'a',
        currentDigest: 'a2',
      },
      {
        kind: 'INSERTED',
        sourceRecordId: NEW_ID,
        currentRowHint: 3,
        digest: 'new',
      },
    ],
    counters: { rowsSeen: 2, rowsNew: 1, rowsChanged: 1, rowsMissing: 0, rowsAmbiguous: 0 },
  };
  const revisions = {
    revisions: [
      {
        sourceRecordId: A,
        revision: 2,
        migrationRunId: '00000000-0000-0000-0000-000000002304',
        observedAt: '2026-09-07T05:44:59.000Z',
        rowHint: 2,
        rowDigest: 'a2',
        changeClass: 'OWNER_CORRECTION',
        rawPayload: '{"synthetic":true}',
      },
      {
        sourceRecordId: NEW_ID,
        revision: 1,
        migrationRunId: '00000000-0000-0000-0000-000000002304',
        observedAt: OBSERVED_AT,
        rowHint: 3,
        rowDigest: 'new',
        changeClass: null,
        rawPayload: '{"synthetic":true}',
      },
    ],
  };

  assert.throws(
    () => buildIncrementalSourceDeltaIntentPlan(
      singleBaseline,
      lineage,
      revisions,
      [{ sourceRecordId: A, lastRowHint: 2, currentDigest: 'a', currentRevision: 1 }],
      OBSERVED_AT,
    ),
    (error) => error instanceof IncrementalSourceDeltaIntentError
      && error.code === 'REVISION_LINEAGE_MISMATCH',
  );
});
