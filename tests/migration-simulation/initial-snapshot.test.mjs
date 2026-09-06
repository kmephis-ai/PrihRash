import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialSourceRecordCandidates } from '../../dist/migration/initialSnapshot.js';

test('initial import preserves exact duplicate rows as separate source candidates', () => {
  const candidates = buildInitialSourceRecordCandidates([
    { rowHint: 10, digest: 'same-digest' },
    { rowHint: 11, digest: 'same-digest' },
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((item) => item.sourceOrdinal), [0, 1]);
  assert.deepEqual(candidates.map((item) => item.rowHint), [10, 11]);
});
