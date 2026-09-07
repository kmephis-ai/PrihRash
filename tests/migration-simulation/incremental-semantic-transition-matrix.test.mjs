import test from 'node:test';
import assert from 'node:assert/strict';
import {
  create, id, missing, outcome, previous, revise, revision, runPlan, touch, transaction,
} from './incremental-semantic-transition-fixtures.mjs';

test('transition matrix preserves verified history and exposes only deterministic candidates', () => {
  const intents = [
    touch(id(1), 11), touch(id(2), 12), create(id(3), 13), create(id(4), 14), create(id(5), 15),
    revise(id(6), 16), revise(id(7), 17), revise(id(8), 18), missing(id(9), 19),
  ];
  const outcomes = [
    outcome({ currentRowHint: 11, sourceRecordId: id(1), lineageKind: 'TOUCH', classification: 'FINANCIAL_RECORD', projection: { status: 'NOT_EVALUATED', reason: 'TOUCH_NO_REVISION' } }),
    outcome({ currentRowHint: 12, sourceRecordId: id(2), lineageKind: 'TOUCH', classification: 'AMBIGUOUS', projection: { status: 'NOT_EVALUATED', reason: 'TOUCH_NO_REVISION' } }),
    outcome({ currentRowHint: 13, sourceRecordId: id(3), lineageKind: 'CREATE', classification: 'FINANCIAL_RECORD', projection: { status: 'CANDIDATE', transaction: transaction(1300) } }),
    outcome({ currentRowHint: 14, sourceRecordId: id(4), lineageKind: 'CREATE', classification: 'NON_FINANCIAL' }),
    outcome({ currentRowHint: 15, sourceRecordId: id(5), lineageKind: 'CREATE', classification: 'AMBIGUOUS' }),
    outcome({ currentRowHint: 16, sourceRecordId: id(6), lineageKind: 'REVISE', classification: 'FINANCIAL_RECORD', projection: { status: 'CANDIDATE', transaction: transaction(1600) } }),
    outcome({ currentRowHint: 17, sourceRecordId: id(7), lineageKind: 'REVISE', classification: 'FINANCIAL_RECORD', projection: { status: 'CANDIDATE', transaction: transaction(1700) } }),
    outcome({ currentRowHint: 18, sourceRecordId: id(8), lineageKind: 'REVISE', classification: 'NON_FINANCIAL' }),
    outcome({ currentRowHint: 20, sourceRecordId: null, lineageKind: 'UNRESOLVED', classification: 'AMBIGUOUS' }),
    outcome({ currentRowHint: 21, sourceRecordId: null, lineageKind: 'UNRESOLVED', classification: 'INVALID' }),
  ];
  const result = runPlan(
    intents,
    outcomes,
    [revision(id(6), 16, 'OWNER_CORRECTION'), revision(id(7), 17, 'WORKFLOW_TRANSFORM'), revision(id(8), 18, 'AMBIGUOUS_CHANGE')],
    [
      previous(id(1), 'FINANCIAL_RECORD', id(101), 3), previous(id(2), 'NON_FINANCIAL'),
      previous(id(6), 'FINANCIAL_RECORD', id(106), 4), previous(id(7), 'FINANCIAL_RECORD', id(107), 5),
      previous(id(8), 'FINANCIAL_RECORD', id(108), 6), previous(id(9), 'AMBIGUOUS', id(109), 7),
    ],
    [Object.freeze({ previousSourceRecordIds: Object.freeze([id(30)]), previousRowHints: Object.freeze([30]), currentRowHints: Object.freeze([20, 21]) })],
  );

  assert.deepEqual(result.decisions.map((item) => item.kind), [
    'TOUCH_PRESERVE', 'REVIEW_REQUIRED_PRESERVE', 'CREATE_FINANCIAL_CANDIDATE',
    'CREATE_SOURCE_ONLY', 'CREATE_REVIEW_REQUIRED', 'OWNER_CORRECTION_REPLACE_CANDIDATE',
    'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL', 'REVIEW_REQUIRED_PRESERVE',
    'MARK_MISSING_PRESERVE_CANONICAL',
  ]);
  assert.deepEqual(result.decisions[1], {
    kind: 'REVIEW_REQUIRED_PRESERVE', sourceRecordId: id(2), reason: 'CONTEXTUAL_CLASSIFICATION_DRIFT',
    previousClassification: 'NON_FINANCIAL', currentClassification: 'AMBIGUOUS', transactionId: null, changeClass: null,
  });
  assert.equal(result.decisions[2].transactionIdentityAssignmentRequired, true);
  assert.equal(result.decisions[5].transactionId, id(106));
  assert.equal(result.decisions[5].expectedTransactionVersion, 4);
  assert.equal(result.decisions[6].transactionId, id(107));
  assert.equal(result.decisions[7].reason, 'AMBIGUOUS_CHANGE');
  assert.equal(result.decisions[7].transactionId, id(108));
  assert.equal(result.decisions[8].transactionId, id(109));
  assert.deepEqual(result.unresolvedObservations, [
    { currentRowHint: 20, sourceOrdinal: 20, classification: 'AMBIGUOUS', blocksValidation: false },
    { currentRowHint: 21, sourceOrdinal: 21, classification: 'INVALID', blocksValidation: true },
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.decisions), true);
});

test('invalid or unavailable current financial semantics block validation', () => {
  const result = runPlan(
    [create(id(40), 40), create(id(41), 41), revise(id(42), 42)],
    [
      outcome({ currentRowHint: 40, sourceRecordId: id(40), lineageKind: 'CREATE', classification: 'INVALID' }),
      outcome({ currentRowHint: 41, sourceRecordId: id(41), lineageKind: 'CREATE', classification: 'FINANCIAL_RECORD', projection: { status: 'FAILED', stage: 'NORMALIZATION', errorCode: 'UNKNOWN_ACCOUNT' } }),
      outcome({ currentRowHint: 42, sourceRecordId: id(42), lineageKind: 'REVISE', classification: 'FINANCIAL_RECORD', projection: { status: 'BLOCKED', reason: 'PREVIOUS_FINANCIAL_QUALITY_REQUIRED' } }),
    ],
    [revision(id(42), 42, 'OWNER_CORRECTION')],
    [previous(id(42), 'FINANCIAL_RECORD', id(142), 2)],
  );
  assert.deepEqual(result.decisions, [
    { kind: 'BLOCK_VALIDATION', sourceRecordId: id(40), reason: 'INVALID_CURRENT_OBSERVATION' },
    { kind: 'BLOCK_VALIDATION', sourceRecordId: id(41), reason: 'FINANCIAL_PROJECTION_FAILED' },
    { kind: 'BLOCK_VALIDATION', sourceRecordId: id(42), reason: 'FINANCIAL_PROJECTION_BLOCKED' },
  ]);
});

test('workflow transform without canonical link stays review-required', () => {
  const result = runPlan(
    [revise(id(50), 50)],
    [outcome({ currentRowHint: 50, sourceRecordId: id(50), lineageKind: 'REVISE', classification: 'FINANCIAL_RECORD', projection: { status: 'CANDIDATE', transaction: transaction(5000) } })],
    [revision(id(50), 50, 'WORKFLOW_TRANSFORM')],
    [previous(id(50), 'FINANCIAL_RECORD')],
  );
  assert.deepEqual(result.decisions[0], {
    kind: 'REVIEW_REQUIRED_PRESERVE', sourceRecordId: id(50), reason: 'SEMANTIC_TRANSITION',
    previousClassification: 'FINANCIAL_RECORD', currentClassification: 'FINANCIAL_RECORD', transactionId: null,
    changeClass: 'WORKFLOW_TRANSFORM',
  });
});
