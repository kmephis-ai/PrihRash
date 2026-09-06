import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InitialBootstrapError,
  buildInitialBootstrapPlan,
  buildInitialSourceRecordCandidates,
} from '../../dist/migration/initialSnapshot.js';

const ID_1 = '00000000-0000-0000-0000-000000000101';
const ID_2 = '00000000-0000-0000-0000-000000000102';

function expectBootstrapError(code, work) {
  assert.throws(work, (error) => error instanceof InitialBootstrapError && error.code === code);
}

test('initial import preserves exact duplicate rows as separate source candidates', () => {
  const candidates = buildInitialSourceRecordCandidates([
    { sourceRecordId: ID_1, rowHint: 10, digest: 'same-digest' },
    { sourceRecordId: ID_2, rowHint: 11, digest: 'same-digest' },
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((item) => item.sourceOrdinal), [0, 1]);
  assert.deepEqual(candidates.map((item) => item.rowHint), [10, 11]);
  assert.deepEqual(candidates.map((item) => item.sourceRecordId), [ID_1, ID_2]);
});

test('initial bootstrap plan marks every observed row as new without invented ambiguity', () => {
  const plan = buildInitialBootstrapPlan([
    { sourceRecordId: ID_1, rowHint: 2, digest: 'digest-a' },
    { sourceRecordId: ID_2, rowHint: 3, digest: 'digest-b' },
  ]);

  assert.deepEqual(plan.counters, {
    rowsSeen: 2,
    rowsNew: 2,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.candidates), true);
  assert.equal(Object.isFrozen(plan.counters), true);
});

test('initial bootstrap rejects duplicate source identity even when rows differ', () => {
  expectBootstrapError('DUPLICATE_SOURCE_RECORD_ID', () => buildInitialBootstrapPlan([
    { sourceRecordId: ID_1, rowHint: 2, digest: 'digest-a' },
    { sourceRecordId: ID_1.toUpperCase(), rowHint: 3, digest: 'digest-b' },
  ]));
});

test('initial bootstrap rejects duplicate or unsafe row hints', () => {
  expectBootstrapError('DUPLICATE_ROW_HINT', () => buildInitialBootstrapPlan([
    { sourceRecordId: ID_1, rowHint: 2, digest: 'digest-a' },
    { sourceRecordId: ID_2, rowHint: 2, digest: 'digest-b' },
  ]));

  expectBootstrapError('INVALID_ROW_HINT', () => buildInitialBootstrapPlan([
    { sourceRecordId: ID_1, rowHint: Number.MAX_SAFE_INTEGER + 1, digest: 'digest-a' },
  ]));
});

test('initial bootstrap rejects invalid ids and empty digests', () => {
  expectBootstrapError('INVALID_SOURCE_RECORD_ID', () => buildInitialBootstrapPlan([
    { sourceRecordId: 'not-a-uuid', rowHint: 2, digest: 'digest-a' },
  ]));

  expectBootstrapError('EMPTY_DIGEST', () => buildInitialBootstrapPlan([
    { sourceRecordId: ID_1, rowHint: 2, digest: '   ' },
  ]));
});
