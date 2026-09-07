import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalReviewMaterializationError,
  planIncrementalReviewMaterialization,
} from '../../dist/migration/incrementalReviewMaterialization.js';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function transition(decisions, unresolvedObservations = []) {
  return Object.freeze({
    decisions: Object.freeze(decisions),
    unresolvedObservations: Object.freeze(unresolvedObservations),
  });
}

function previous(sourceRecordId, classification, transactionId = null, overrides = {}) {
  return Object.freeze({
    sourceRecordId,
    classification,
    transactionId,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  });
}

test('identified review is materialized as AMBIGUOUS while preserving exact canonical link', () => {
  const result = planIncrementalReviewMaterialization(
    transition([
      Object.freeze({
        kind: 'REVIEW_REQUIRED_PRESERVE',
        sourceRecordId: id(1),
        reason: 'AMBIGUOUS_CHANGE',
        previousClassification: 'FINANCIAL_RECORD',
        currentClassification: 'NON_FINANCIAL',
        transactionId: id(101),
        changeClass: 'AMBIGUOUS_CHANGE',
      }),
    ]),
    [previous(id(1), 'FINANCIAL_RECORD', id(101))],
  );

  assert.deepEqual(result, {
    directives: [{
      kind: 'IDENTIFIED_AMBIGUITY',
      sourceRecordId: id(1),
      state: null,
      classification: 'AMBIGUOUS',
      transactionId: id(101),
      resolutionCode: null,
      resolvedAt: null,
      resolvedBy: null,
    }],
    promotionBlocker: null,
    unresolvedRowHints: [],
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.directives), true);
});

test('new ambiguous source gets identified review state without invented transaction link', () => {
  const result = planIncrementalReviewMaterialization(
    transition([{ kind: 'CREATE_REVIEW_REQUIRED', sourceRecordId: id(2), classification: 'AMBIGUOUS' }]),
    [],
  );

  assert.deepEqual(result.directives[0], {
    kind: 'IDENTIFIED_AMBIGUITY',
    sourceRecordId: id(2),
    state: null,
    classification: 'AMBIGUOUS',
    transactionId: null,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
});

test('missing source materializes state=MISSING and preserves previous classification and canonical link', () => {
  const result = planIncrementalReviewMaterialization(
    transition([{ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(3), transactionId: id(103) }]),
    [previous(id(3), 'FINANCIAL_RECORD', id(103))],
  );

  assert.deepEqual(result.directives[0], {
    kind: 'MISSING',
    sourceRecordId: id(3),
    state: 'MISSING',
    classification: 'FINANCIAL_RECORD',
    transactionId: id(103),
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
});

test('unresolved lineage is retained as explicit promotion blocker without guessed SourceRecord identity', () => {
  const result = planIncrementalReviewMaterialization(
    transition([], [
      { currentRowHint: 22, sourceOrdinal: 9, classification: 'AMBIGUOUS', blocksValidation: false },
      { currentRowHint: 21, sourceOrdinal: 8, classification: 'INVALID', blocksValidation: true },
    ]),
    [],
  );

  assert.equal(result.promotionBlocker, 'UNRESOLVED_LINEAGE');
  assert.deepEqual(result.unresolvedRowHints, [21, 22]);
  assert.deepEqual(result.directives, []);
});

test('previous resolution audit cannot be silently erased to open another review epoch', () => {
  assert.throws(
    () => planIncrementalReviewMaterialization(
      transition([{ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(4), transactionId: id(104) }]),
      [previous(id(4), 'FINANCIAL_RECORD', id(104), {
        resolutionCode: 'KEEP_CANONICAL',
        resolvedAt: '2026-09-06T12:00:00.000Z',
        resolvedBy: 'OWNER',
      })],
    ),
    (error) => error instanceof IncrementalReviewMaterializationError
      && error.code === 'RESOLUTION_EPOCH_ROLLOVER_REQUIRED',
  );
});

for (const [name, transitionPlan, evidence, code] of [
  [
    'missing previous review evidence',
    transition([{ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(5), transactionId: null }]),
    [],
    'MISSING_PREVIOUS_REVIEW_EVIDENCE',
  ],
  [
    'mismatched previous canonical link',
    transition([{ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(6), transactionId: id(106) }]),
    [previous(id(6), 'FINANCIAL_RECORD', id(999))],
    'PREVIOUS_EVIDENCE_MISMATCH',
  ],
  [
    'partial previous resolution audit',
    transition([{ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(7), transactionId: null }]),
    [previous(id(7), 'NON_FINANCIAL', null, { resolutionCode: 'RESOLVED_NO_CHANGE' })],
    'INCONSISTENT_RESOLUTION_AUDIT',
  ],
]) {
  test(`fails closed for ${name}`, () => {
    assert.throws(
      () => planIncrementalReviewMaterialization(transitionPlan, evidence),
      (error) => error instanceof IncrementalReviewMaterializationError && error.code === code,
    );
  });
}
