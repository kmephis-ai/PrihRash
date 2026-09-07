import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalTransactionCurrentCandidateError,
  buildIncrementalTransactionCurrentCandidatePlan,
} from '../../dist/migration/incrementalTransactionCurrentCandidate.js';
import { id, transaction } from './incremental-source-current-candidate-fixtures.mjs';

const prev = (n, version = 1) => Object.freeze({ id: id(100 + n), transaction: transaction(n * 1000), version });
const src = (n, classification = 'FINANCIAL_RECORD', transactionId = id(100 + n), state = null) => Object.freeze({ id: id(n), classification, transactionId, state });
const plan = (sourceRecords, promotionBlocker = null) => Object.freeze({ sourceRecords: Object.freeze(sourceRecords), promotionBlocker, unresolvedRowHints: Object.freeze([]) });
const transition = (decisions) => Object.freeze({ decisions: Object.freeze(decisions), unresolvedObservations: Object.freeze([]) });
const expectCode = (fn, code) => assert.throws(fn, (e) => e instanceof IncrementalTransactionCurrentCandidateError && e.code === code);

test('owner correction requires exact previous transaction version', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [prev(1, 2)],
      transition([Object.freeze({ kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE', sourceRecordId: id(1), transactionId: id(101), expectedTransactionVersion: 3, transaction: transaction(9999) })]),
      plan([src(1)]),
    ),
    'TRANSACTION_VERSION_MISMATCH',
  );
});

test('create financial cannot reuse an existing transaction identity', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [prev(1)],
      transition([Object.freeze({ kind: 'CREATE_FINANCIAL_CANDIDATE', sourceRecordId: id(2), transaction: transaction(2000), transactionIdentityAssignmentRequired: true })]),
      plan([src(2, 'FINANCIAL_RECORD', id(101))]),
    ),
    'CREATE_TRANSACTION_ALREADY_EXISTS',
  );
});

test('review preserve requires AMBIGUOUS materialized source semantics', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [prev(1)],
      transition([Object.freeze({ kind: 'REVIEW_REQUIRED_PRESERVE', sourceRecordId: id(1), reason: 'AMBIGUOUS_CHANGE', previousClassification: 'FINANCIAL_RECORD', currentClassification: 'NON_FINANCIAL', transactionId: id(101), changeClass: 'AMBIGUOUS_CHANGE' })]),
      plan([src(1, 'FINANCIAL_RECORD')]),
    ),
    'SOURCE_SEMANTIC_MISMATCH',
  );
});

test('missing transition requires source state MISSING', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [prev(1)],
      transition([Object.freeze({ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(1), transactionId: id(101) })]),
      plan([src(1)]),
    ),
    'SOURCE_SEMANTIC_MISMATCH',
  );
});

test('source-only create cannot carry a transaction link', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [],
      transition([Object.freeze({ kind: 'CREATE_SOURCE_ONLY', sourceRecordId: id(2), classification: 'NON_FINANCIAL' })]),
      plan([src(2, 'NON_FINANCIAL', id(202))]),
    ),
    'SOURCE_ONLY_TRANSACTION_LINK_PRESENT',
  );
});

test('source link must resolve in resulting transaction candidate even without a transition decision', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan([], transition([]), plan([src(7, 'FINANCIAL_RECORD', id(107))])),
    'SOURCE_TRANSACTION_NOT_FOUND',
  );
});

test('semantic transition link must match materialized source link exactly', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [prev(1), prev(2)],
      transition([Object.freeze({ kind: 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL', sourceRecordId: id(1), transactionId: id(101) })]),
      plan([src(1, 'FINANCIAL_RECORD', id(102))]),
    ),
    'SOURCE_TRANSACTION_LINK_MISMATCH',
  );
});

test('BLOCK_VALIDATION cannot enter transaction current candidate', () => {
  expectCode(
    () => buildIncrementalTransactionCurrentCandidatePlan(
      [prev(1)],
      transition([Object.freeze({ kind: 'BLOCK_VALIDATION', sourceRecordId: id(1), reason: 'INVALID_CURRENT_OBSERVATION' })]),
      plan([src(1)]),
    ),
    'TRANSITION_BLOCKS_CANDIDATE',
  );
});
