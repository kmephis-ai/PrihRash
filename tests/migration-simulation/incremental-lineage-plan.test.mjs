import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalLineagePlanError,
  buildIncrementalLineagePlan,
} from '../../dist/migration/incrementalLineagePlan.js';

const ID_A = '00000000-0000-0000-0000-000000001801';
const ID_B = '00000000-0000-0000-0000-000000001802';
const ID_C = '00000000-0000-0000-0000-000000001803';
const ID_NEW = '00000000-0000-0000-0000-000000001804';

function previous(sourceRecordId, rowHint, digest) {
  return { sourceRecordId, rowHint, digest };
}

function current(rowHint, digest) {
  return { rowHint, digest };
}

test('unchanged full snapshot preserves lineage and produces zero delta counters', () => {
  const plan = buildIncrementalLineagePlan(
    [previous(ID_A.toUpperCase(), 2, 'a'), previous(ID_B, 3, 'b')],
    [current(2, 'a'), current(3, 'b')],
    [],
  );

  assert.deepEqual(plan.counters, {
    rowsSeen: 2,
    rowsNew: 0,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
  });
  assert.deepEqual(plan.outcomes.map((outcome) => outcome.kind), ['UNCHANGED', 'UNCHANGED']);
  assert.equal(plan.outcomes[0].sourceRecordId, ID_A);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.outcomes), true);
});

test('insertion requires exact explicit SourceRecord assignment and never generates identity', () => {
  const plan = buildIncrementalLineagePlan(
    [previous(ID_A, 2, 'a'), previous(ID_C, 4, 'c')],
    [current(2, 'a'), current(3, 'b'), current(4, 'c')],
    [{ currentRowHint: 3, sourceRecordId: ID_NEW.toUpperCase() }],
  );

  const inserted = plan.outcomes.find((outcome) => outcome.kind === 'INSERTED');
  assert.deepEqual(inserted, {
    kind: 'INSERTED',
    sourceRecordId: ID_NEW,
    currentRowHint: 3,
    digest: 'b',
  });
  assert.deepEqual(plan.counters, {
    rowsSeen: 3,
    rowsNew: 1,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
  });
});

test('single anchored revision preserves SourceRecord identity and increments rowsChanged only', () => {
  const plan = buildIncrementalLineagePlan(
    [previous(ID_A, 2, 'a'), previous(ID_B, 3, 'b'), previous(ID_C, 4, 'c')],
    [current(2, 'a'), current(3, 'b2'), current(4, 'c')],
    [],
  );

  const revised = plan.outcomes.find((outcome) => outcome.kind === 'REVISED');
  assert.equal(revised.sourceRecordId, ID_B);
  assert.equal(revised.previousDigest, 'b');
  assert.equal(revised.currentDigest, 'b2');
  assert.deepEqual(plan.counters, {
    rowsSeen: 3,
    rowsNew: 0,
    rowsChanged: 1,
    rowsMissing: 0,
    rowsAmbiguous: 0,
  });
});

test('explicit missing row is counted only when sequence diff proves MISSING', () => {
  const plan = buildIncrementalLineagePlan(
    [previous(ID_A, 2, 'a'), previous(ID_B, 3, 'b'), previous(ID_C, 4, 'c')],
    [current(2, 'a'), current(4, 'c')],
    [],
  );

  assert.equal(plan.outcomes.find((outcome) => outcome.kind === 'MISSING').sourceRecordId, ID_B);
  assert.deepEqual(plan.counters, {
    rowsSeen: 2,
    rowsNew: 0,
    rowsChanged: 0,
    rowsMissing: 1,
    rowsAmbiguous: 0,
  });
});

test('ambiguous block counts current observations without inventing missing/changed previous rows', () => {
  const plan = buildIncrementalLineagePlan(
    [previous(ID_A, 2, 'old-a'), previous(ID_B, 3, 'old-b'), previous(ID_C, 4, 'anchor')],
    [current(2, 'new-a'), current(3, 'new-b'), current(4, 'anchor')],
    [],
  );

  const ambiguous = plan.outcomes.find((outcome) => outcome.kind === 'AMBIGUOUS_BLOCK');
  assert.deepEqual(ambiguous.previousSourceRecordIds, [ID_A, ID_B]);
  assert.deepEqual(ambiguous.currentRowHints, [2, 3]);
  assert.deepEqual(plan.counters, {
    rowsSeen: 3,
    rowsNew: 0,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 2,
  });
  assert.equal(plan.outcomes.some((outcome) => outcome.kind === 'MISSING'), false);
  assert.equal(plan.outcomes.some((outcome) => outcome.kind === 'REVISED'), false);
});

test('inserted assignments must exactly cover inserted row hints', () => {
  const previousRows = [previous(ID_A, 2, 'a'), previous(ID_C, 4, 'c')];
  const currentRows = [current(2, 'a'), current(3, 'b'), current(4, 'c')];

  assert.throws(
    () => buildIncrementalLineagePlan(previousRows, currentRows, []),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'MISSING_INSERTED_SOURCE_RECORD_ASSIGNMENT',
  );

  assert.throws(
    () => buildIncrementalLineagePlan(previousRows, currentRows, [
      { currentRowHint: 3, sourceRecordId: ID_NEW },
      { currentRowHint: 99, sourceRecordId: '00000000-0000-0000-0000-000000001805' },
    ]),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'EXTRA_INSERTED_SOURCE_RECORD_ASSIGNMENT',
  );
});

test('assignment identity cannot collide with existing or another inserted SourceRecord', () => {
  assert.throws(
    () => buildIncrementalLineagePlan(
      [previous(ID_A, 2, 'a'), previous(ID_C, 5, 'c')],
      [current(2, 'a'), current(3, 'b'), current(4, 'd'), current(5, 'c')],
      [
        { currentRowHint: 3, sourceRecordId: ID_A },
        { currentRowHint: 4, sourceRecordId: ID_NEW },
      ],
    ),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'ASSIGNMENT_SOURCE_RECORD_ID_COLLISION',
  );

  assert.throws(
    () => buildIncrementalLineagePlan(
      [previous(ID_A, 2, 'a'), previous(ID_C, 5, 'c')],
      [current(2, 'a'), current(3, 'b'), current(4, 'd'), current(5, 'c')],
      [
        { currentRowHint: 3, sourceRecordId: ID_NEW },
        { currentRowHint: 4, sourceRecordId: ID_NEW.toUpperCase() },
      ],
    ),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'DUPLICATE_ASSIGNMENT_SOURCE_RECORD_ID',
  );
});

test('malformed previous/current evidence fails closed before sequence diff', () => {
  assert.throws(
    () => buildIncrementalLineagePlan(
      [previous('not-a-uuid', 2, 'a')],
      [current(2, 'a')],
      [],
    ),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'INVALID_SOURCE_RECORD_ID',
  );

  assert.throws(
    () => buildIncrementalLineagePlan(
      [previous(ID_A, 2, 'a')],
      [current(2, 'a'), current(2, 'b')],
      [],
    ),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'DUPLICATE_ROW_HINT',
  );

  assert.throws(
    () => buildIncrementalLineagePlan(
      [previous(ID_A, 2, 'a')],
      [current(2, '   ')],
      [],
    ),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'EMPTY_DIGEST',
  );
});
