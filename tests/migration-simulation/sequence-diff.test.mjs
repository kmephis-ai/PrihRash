import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSequences } from '../../dist/migration/sequenceDiff.js';

const old = (id, rowHint, digest) => ({ sourceRecordId: id, rowHint, digest });
const current = (rowHint, digest) => ({ rowHint, digest });

test('unchanged exact duplicates preserve independent source identities', () => {
  const ops = diffSequences(
    [old('a', 10, 'same'), old('b', 11, 'same')],
    [current(10, 'same'), current(11, 'same')],
  );
  assert.deepEqual(ops.map((op) => [op.kind, op.sourceRecordId]), [
    ['UNCHANGED', 'a'],
    ['UNCHANGED', 'b'],
  ]);
});

test('insertion between unique anchors creates one new candidate', () => {
  const ops = diffSequences(
    [old('a', 1, 'A'), old('b', 2, 'B')],
    [current(1, 'A'), current(2, 'X'), current(3, 'B')],
  );
  assert.deepEqual(ops.map((op) => op.kind), ['UNCHANGED', 'INSERTED', 'UNCHANGED']);
});

test('deletion between unique anchors marks source record MISSING', () => {
  const ops = diffSequences(
    [old('a', 1, 'A'), old('x', 2, 'X'), old('b', 3, 'B')],
    [current(1, 'A'), current(2, 'B')],
  );
  assert.deepEqual(ops.map((op) => op.kind), ['UNCHANGED', 'MISSING', 'UNCHANGED']);
  assert.equal(ops[1].sourceRecordId, 'x');
});

test('single change between anchors is a revision of the same source record', () => {
  const ops = diffSequences(
    [old('a', 1, 'A'), old('x', 2, 'OLD'), old('b', 3, 'B')],
    [current(1, 'A'), current(2, 'NEW'), current(3, 'B')],
  );
  assert.deepEqual(ops.map((op) => op.kind), ['UNCHANGED', 'REVISED', 'UNCHANGED']);
  assert.equal(ops[1].sourceRecordId, 'x');
});

test('insertion into a duplicate run fails closed as ambiguous', () => {
  const ops = diffSequences(
    [old('a', 1, 'A'), old('d1', 2, 'D'), old('d2', 3, 'D'), old('b', 4, 'B')],
    [current(1, 'A'), current(2, 'D'), current(3, 'D'), current(4, 'D'), current(5, 'B')],
  );
  assert.deepEqual(ops.map((op) => op.kind), ['UNCHANGED', 'AMBIGUOUS_BLOCK', 'UNCHANGED']);
});

test('reordered unique anchors fail closed instead of guessing identity', () => {
  const ops = diffSequences(
    [old('a', 1, 'A'), old('b', 2, 'B'), old('c', 3, 'C')],
    [current(1, 'B'), current(2, 'A'), current(3, 'C')],
  );
  assert.deepEqual(ops.map((op) => op.kind), ['AMBIGUOUS_BLOCK']);
});
