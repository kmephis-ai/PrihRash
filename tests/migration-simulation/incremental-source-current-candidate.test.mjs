import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncrementalSourceCurrentCandidatePlan,
} from '../../dist/migration/incrementalSourceCurrentCandidate.js';
import {
  create, id, missing, observedAt, previous, revise, touch, transaction,
} from './incremental-source-current-candidate-fixtures.mjs';

test('assembles full source current candidate while preserving untouched and unresolved previous state', () => {
  const previousRecords = [
    previous(1, {
      resolutionCode: 'RESOLVED_NO_CHANGE',
      resolvedAt: '2026-09-05T10:00:00.000Z',
      resolvedBy: 'OWNER',
    }),
    previous(2, { currentRevision: 2 }),
    previous(3, { currentRevision: 4 }),
    previous(4),
    previous(5, { currentRevision: 3 }),
    previous(6, {
      state: 'MISSING',
      classification: 'AMBIGUOUS',
      resolutionCode: 'KEEP_CANONICAL',
      resolvedAt: '2026-09-05T11:00:00.000Z',
      resolvedBy: 'OWNER',
    }),
    previous(7),
  ];

  const delta = Object.freeze({
    intents: Object.freeze([
      touch(1, 11),
      revise(2, 21, 2),
      revise(3, 31, 4),
      revise(4, 41, 1),
      missing(5, 3),
      create(8, 81),
      create(9, 91),
      create(10, 101),
    ]),
    unresolvedBlocks: Object.freeze([
      Object.freeze({
        previousSourceRecordIds: Object.freeze([id(7)]),
        previousRowHints: Object.freeze([70]),
        currentRowHints: Object.freeze([71]),
      }),
    ]),
  });

  const transition = Object.freeze({
    decisions: Object.freeze([
      Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: id(1), classification: 'FINANCIAL_RECORD' }),
      Object.freeze({
        kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE', sourceRecordId: id(2), transactionId: id(102),
        expectedTransactionVersion: 2, transaction: transaction(2000),
      }),
      Object.freeze({ kind: 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL', sourceRecordId: id(3), transactionId: id(103) }),
      Object.freeze({
        kind: 'REVIEW_REQUIRED_PRESERVE', sourceRecordId: id(4), reason: 'AMBIGUOUS_CHANGE',
        previousClassification: 'FINANCIAL_RECORD', currentClassification: 'NON_FINANCIAL',
        transactionId: id(104), changeClass: 'AMBIGUOUS_CHANGE',
      }),
      Object.freeze({ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(5), transactionId: id(105) }),
      Object.freeze({
        kind: 'CREATE_FINANCIAL_CANDIDATE', sourceRecordId: id(8), transaction: transaction(8000),
        transactionIdentityAssignmentRequired: true,
      }),
      Object.freeze({ kind: 'CREATE_SOURCE_ONLY', sourceRecordId: id(9), classification: 'NON_FINANCIAL' }),
      Object.freeze({ kind: 'CREATE_REVIEW_REQUIRED', sourceRecordId: id(10), classification: 'AMBIGUOUS' }),
    ]),
    unresolvedObservations: Object.freeze([
      Object.freeze({ currentRowHint: 71, sourceOrdinal: 7, classification: 'AMBIGUOUS', blocksValidation: false }),
    ]),
  });

  const result = buildIncrementalSourceCurrentCandidatePlan(
    delta,
    transition,
    previousRecords,
    [Object.freeze({ sourceRecordId: id(8), transactionId: id(108) })],
    [id(101), id(102), id(103), id(104), id(105), id(106), id(107)],
    observedAt,
  );

  assert.equal(result.promotionBlocker, 'UNRESOLVED_LINEAGE');
  assert.deepEqual(result.unresolvedRowHints, [71]);
  assert.equal(result.sourceRecords.length, 10);

  const byId = new Map(result.sourceRecords.map((record) => [record.id, record]));

  assert.deepEqual(byId.get(id(1)), {
    ...previousRecords[0],
    lastSeenAt: observedAt,
    lastRowHint: 11,
  });

  assert.deepEqual(byId.get(id(2)), {
    ...previousRecords[1],
    lastSeenAt: observedAt,
    lastRowHint: 21,
    currentDigest: 'new-2',
    currentRevision: 3,
  });

  assert.deepEqual(byId.get(id(3)), {
    ...previousRecords[2],
    lastSeenAt: observedAt,
    lastRowHint: 31,
    currentDigest: 'new-3',
    currentRevision: 5,
  });

  assert.deepEqual(byId.get(id(4)), {
    ...previousRecords[3],
    lastSeenAt: observedAt,
    lastRowHint: 41,
    currentDigest: 'new-4',
    currentRevision: 2,
    classification: 'AMBIGUOUS',
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });

  assert.deepEqual(byId.get(id(5)), {
    ...previousRecords[4],
    state: 'MISSING',
  });

  assert.deepEqual(byId.get(id(6)), previousRecords[5]);
  assert.deepEqual(byId.get(id(7)), previousRecords[6]);

  assert.deepEqual(byId.get(id(8)), {
    id: id(8),
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    lastRowHint: 81,
    currentDigest: 'new-8',
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalizationStatus: null,
    transactionId: id(108),
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
  assert.equal(byId.get(id(9)).classification, 'NON_FINANCIAL');
  assert.equal(byId.get(id(9)).transactionId, null);
  assert.equal(byId.get(id(10)).classification, 'AMBIGUOUS');
  assert.equal(byId.get(id(10)).transactionId, null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.sourceRecords), true);
  assert.equal(Object.isFrozen(byId.get(id(8))), true);
});
