import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalSourceCurrentCandidateError,
  buildIncrementalSourceCurrentCandidatePlan,
} from '../../dist/migration/incrementalSourceCurrentCandidate.js';
import {
  create, id, observedAt, previous, revise, touch, transaction,
} from './incremental-source-current-candidate-fixtures.mjs';

function expectCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof IncrementalSourceCurrentCandidateError && error.code === code,
  );
}

function singleTouch(overrides = {}) {
  const delta = Object.freeze({
    intents: Object.freeze([touch(1, 11)]),
    unresolvedBlocks: Object.freeze([]),
    ...overrides.delta,
  });
  const transition = Object.freeze({
    decisions: Object.freeze([
      Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: id(1), classification: 'FINANCIAL_RECORD' }),
    ]),
    unresolvedObservations: Object.freeze([]),
    ...overrides.transition,
  });
  return {
    delta,
    transition,
    previousRecords: overrides.previousRecords ?? [previous(1)],
    assignments: overrides.assignments ?? [],
    existingTransactionIds: overrides.existingTransactionIds ?? [id(101)],
    at: overrides.at ?? observedAt,
  };
}

function run(input) {
  return buildIncrementalSourceCurrentCandidatePlan(
    input.delta,
    input.transition,
    input.previousRecords,
    input.assignments,
    input.existingTransactionIds,
    input.at,
  );
}

test('fails closed when an intent has no semantic transition decision', () => {
  const input = singleTouch({
    transition: Object.freeze({ decisions: Object.freeze([]), unresolvedObservations: Object.freeze([]) }),
  });
  expectCode(() => run(input), 'MISSING_TRANSITION_DECISION');
});

test('fails closed when transition contains a decision outside delta intent coverage', () => {
  const input = singleTouch({
    transition: Object.freeze({
      decisions: Object.freeze([
        Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: id(1), classification: 'FINANCIAL_RECORD' }),
        Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: id(2), classification: 'FINANCIAL_RECORD' }),
      ]),
      unresolvedObservations: Object.freeze([]),
    }),
  });
  expectCode(() => run(input), 'EXTRA_TRANSITION_DECISION');
});

test('fails closed when active verified source state is neither intent-covered nor unresolved', () => {
  const input = singleTouch({ previousRecords: [previous(1), previous(2)] });
  expectCode(() => run(input), 'PREVIOUS_ACTIVE_COVERAGE_MISMATCH');
});

test('fails closed when unresolved previous identity does not exist in active verified state', () => {
  const input = singleTouch({
    delta: Object.freeze({
      intents: Object.freeze([touch(1, 11)]),
      unresolvedBlocks: Object.freeze([
        Object.freeze({
          previousSourceRecordIds: Object.freeze([id(2)]),
          previousRowHints: Object.freeze([20]),
          currentRowHints: Object.freeze([21]),
        }),
      ]),
    }),
    transition: Object.freeze({
      decisions: Object.freeze([
        Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: id(1), classification: 'FINANCIAL_RECORD' }),
      ]),
      unresolvedObservations: Object.freeze([
        Object.freeze({ currentRowHint: 21, sourceOrdinal: 2, classification: 'AMBIGUOUS', blocksValidation: false }),
      ]),
    }),
  });
  expectCode(() => run(input), 'UNRESOLVED_PREVIOUS_EVIDENCE_MISMATCH');
});

test('fails closed on observedAt drift between candidate assembly and source intent', () => {
  const input = singleTouch({ at: '2026-09-07T07:05:00.000Z' });
  expectCode(() => run(input), 'INTENT_OBSERVED_AT_MISMATCH');
});

test('BLOCK_VALIDATION semantic transition cannot enter current candidate state', () => {
  const input = singleTouch({
    transition: Object.freeze({
      decisions: Object.freeze([
        Object.freeze({ kind: 'BLOCK_VALIDATION', sourceRecordId: id(1), reason: 'INVALID_CURRENT_OBSERVATION' }),
      ]),
      unresolvedObservations: Object.freeze([]),
    }),
  });
  expectCode(() => run(input), 'TRANSITION_BLOCKS_CANDIDATE');
});

test('new review cycle over persisted owner resolution audit fails closed', () => {
  const delta = Object.freeze({
    intents: Object.freeze([revise(1, 11, 1)]),
    unresolvedBlocks: Object.freeze([]),
  });
  const transition = Object.freeze({
    decisions: Object.freeze([
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
    unresolvedObservations: Object.freeze([]),
  });
  const previousRecords = [previous(1, {
    resolutionCode: 'RESOLVED_NO_CHANGE',
    resolvedAt: '2026-09-06T12:00:00.000Z',
    resolvedBy: 'OWNER',
  })];

  assert.throws(
    () => buildIncrementalSourceCurrentCandidatePlan(
      delta, transition, previousRecords, [], [id(101)], observedAt,
    ),
    (error) => error?.code === 'RESOLUTION_EPOCH_ROLLOVER_REQUIRED',
  );
});

test('financial CREATE assignment cannot collide with an existing Transaction ID', () => {
  const delta = Object.freeze({
    intents: Object.freeze([create(2, 21)]),
    unresolvedBlocks: Object.freeze([]),
  });
  const transition = Object.freeze({
    decisions: Object.freeze([
      Object.freeze({
        kind: 'CREATE_FINANCIAL_CANDIDATE',
        sourceRecordId: id(2),
        transaction: transaction(2000),
        transactionIdentityAssignmentRequired: true,
      }),
    ]),
    unresolvedObservations: Object.freeze([]),
  });
  expectCode(
    () => buildIncrementalSourceCurrentCandidatePlan(
      delta,
      transition,
      [],
      [Object.freeze({ sourceRecordId: id(2), transactionId: id(101) })],
      [id(101)],
      observedAt,
    ),
    'TRANSACTION_ASSIGNMENT_COLLISION',
  );
});

test('transaction assignment cannot be attached to non-financial CREATE', () => {
  const delta = Object.freeze({
    intents: Object.freeze([create(2, 21)]),
    unresolvedBlocks: Object.freeze([]),
  });
  const transition = Object.freeze({
    decisions: Object.freeze([
      Object.freeze({ kind: 'CREATE_SOURCE_ONLY', sourceRecordId: id(2), classification: 'NON_FINANCIAL' }),
    ]),
    unresolvedObservations: Object.freeze([]),
  });
  expectCode(
    () => buildIncrementalSourceCurrentCandidatePlan(
      delta,
      transition,
      [],
      [Object.freeze({ sourceRecordId: id(2), transactionId: id(202) })],
      [id(101)],
      observedAt,
    ),
    'EXTRA_TRANSACTION_ASSIGNMENT',
  );
});
