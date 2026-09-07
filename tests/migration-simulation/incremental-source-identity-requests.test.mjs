import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IncrementalLineagePlanError,
  buildIncrementalLineagePlan,
  buildIncrementalSourceRecordAssignmentRequests,
} from '../../dist/migration/incrementalLineagePlan.js';

const A = '00000000-0000-0000-0000-000000008001';
const B = '00000000-0000-0000-0000-000000008002';
const D1 = '00000000-0000-0000-0000-000000008003';
const D2 = '00000000-0000-0000-0000-000000008004';
const NEW = '00000000-0000-0000-0000-000000008005';

const previous = (sourceRecordId, rowHint, digest) => Object.freeze({ sourceRecordId, rowHint, digest });
const current = (rowHint, digest) => Object.freeze({ rowHint, digest });

test('returns only exact inserted rows as immutable source identity requests', () => {
  const previousRows = Object.freeze([
    previous(A, 2, 'A'),
    previous(B, 3, 'B'),
  ]);
  const currentRows = Object.freeze([
    current(2, 'A'),
    current(3, 'X'),
    current(4, 'B'),
  ]);

  const requests = buildIncrementalSourceRecordAssignmentRequests(previousRows, currentRows);

  assert.deepEqual(requests, [{ currentRowHint: 3, digest: 'X' }]);
  assert.equal(Object.isFrozen(requests), true);
  assert.equal(Object.isFrozen(requests[0]), true);

  const assignments = Object.freeze(requests.map((request) => Object.freeze({
    currentRowHint: request.currentRowHint,
    sourceRecordId: NEW,
  })));
  const lineage = buildIncrementalLineagePlan(previousRows, currentRows, assignments);
  assert.deepEqual(lineage.outcomes.map((outcome) => outcome.kind), [
    'UNCHANGED', 'INSERTED', 'UNCHANGED',
  ]);
  assert.equal(lineage.outcomes[1].sourceRecordId, NEW);
});

test('does not request identities for current rows inside an ambiguous duplicate block', () => {
  const requests = buildIncrementalSourceRecordAssignmentRequests(
    Object.freeze([
      previous(A, 1, 'A'),
      previous(D1, 2, 'D'),
      previous(D2, 3, 'D'),
      previous(B, 4, 'B'),
    ]),
    Object.freeze([
      current(1, 'A'),
      current(2, 'D'),
      current(3, 'D'),
      current(4, 'D'),
      current(5, 'B'),
    ]),
  );

  assert.deepEqual(requests, []);
});

test('unchanged, revised and missing operations produce no identity requests', () => {
  const requests = buildIncrementalSourceRecordAssignmentRequests(
    Object.freeze([
      previous(A, 2, 'A'),
      previous(D1, 3, 'OLD'),
      previous(D2, 4, 'MISSING'),
      previous(B, 5, 'B'),
    ]),
    Object.freeze([
      current(2, 'A'),
      current(3, 'NEW'),
      current(4, 'B'),
    ]),
  );

  assert.deepEqual(requests, []);
});

test('request phase fails closed with the same duplicate-row validation as final lineage planning', () => {
  const previousRows = Object.freeze([previous(A, 2, 'A')]);
  const duplicateCurrent = Object.freeze([
    current(2, 'A'),
    current(2, 'X'),
  ]);

  assert.throws(
    () => buildIncrementalSourceRecordAssignmentRequests(previousRows, duplicateCurrent),
    (error) => error instanceof IncrementalLineagePlanError && error.code === 'DUPLICATE_ROW_HINT',
  );
  assert.throws(
    () => buildIncrementalLineagePlan(previousRows, duplicateCurrent, []),
    (error) => error instanceof IncrementalLineagePlanError && error.code === 'DUPLICATE_ROW_HINT',
  );
});

test('final lineage planner still rejects missing and extra assignments', () => {
  const previousRows = Object.freeze([
    previous(A, 2, 'A'),
    previous(B, 3, 'B'),
  ]);
  const currentRows = Object.freeze([
    current(2, 'A'),
    current(3, 'X'),
    current(4, 'B'),
  ]);

  assert.throws(
    () => buildIncrementalLineagePlan(previousRows, currentRows, []),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'MISSING_INSERTED_SOURCE_RECORD_ASSIGNMENT',
  );
  assert.throws(
    () => buildIncrementalLineagePlan(previousRows, currentRows, [
      { currentRowHint: 3, sourceRecordId: NEW },
      { currentRowHint: 99, sourceRecordId: '00000000-0000-0000-0000-000000008006' },
    ]),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'EXTRA_INSERTED_SOURCE_RECORD_ASSIGNMENT',
  );
});
