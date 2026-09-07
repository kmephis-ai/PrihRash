import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncrementalCurrentCandidatePreparation,
} from '../../dist/migration/incrementalCurrentCandidatePreparation.js';
import { IncrementalSourceCurrentCandidateError } from '../../dist/migration/incrementalSourceCurrentCandidate.js';

const A = '00000000-0000-0000-0000-000000004001';
const B = '00000000-0000-0000-0000-000000004002';
const D = '00000000-0000-0000-0000-000000004004';
const NEW = '00000000-0000-0000-0000-000000004005';
const TX_A = '00000000-0000-0000-0000-000000004101';
const TX_B = '00000000-0000-0000-0000-000000004102';
const TX_D = '00000000-0000-0000-0000-000000004104';
const TX_NEW = '00000000-0000-0000-0000-000000004105';
const ACCOUNT = '00000000-0000-0000-0000-000000004201';
const CATEGORY = '00000000-0000-0000-0000-000000004301';
const OBSERVED_AT = '2026-09-07T14:00:00.000Z';

function transaction(amountMinor, description) {
  return Object.freeze({
    type: 'EXPENSE',
    occurredOn: '2024-07-28',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor,
    currency: 'RUB',
    fromAccountId: ACCOUNT,
    toAccountId: null,
    categoryId: CATEGORY,
    paidByMemberId: null,
    description,
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
  });
}

function source(id, rowHint, digest, transactionId) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-01T10:00:00.000Z',
    lastSeenAt: '2026-09-06T10:00:00.000Z',
    lastRowHint: rowHint,
    currentDigest: digest,
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalizationStatus: 'NORMALIZED',
    transactionId,
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

function previousTransactions() {
  return Object.freeze([
    Object.freeze({ id: TX_A, transaction: transaction(10000, 'touch previous'), version: 1 }),
    Object.freeze({ id: TX_B, transaction: transaction(10000, 'revise previous'), version: 7 }),
    Object.freeze({ id: TX_D, transaction: transaction(30000, 'missing previous'), version: 2 }),
  ]);
}

function previousSources() {
  return Object.freeze([
    source(A, 2, 'a', TX_A),
    source(B, 3, 'b', TX_B),
    source(D, 5, 'd', TX_D),
  ]);
}

function structural() {
  return Object.freeze({
    lineage: Object.freeze({ outcomes: Object.freeze([]), counters: Object.freeze({}) }),
    changeEvidence: Object.freeze({ changeEvidence: Object.freeze([]), contextDependentSourceRecordIds: Object.freeze([]) }),
    revisions: Object.freeze({ revisions: Object.freeze([]) }),
    sourceDelta: Object.freeze({
      intents: Object.freeze([
        Object.freeze({ kind: 'TOUCH', sourceRecordId: A, expectedRevision: 1, expectedDigest: 'a', previousRowHint: 2, currentRowHint: 2, observedAt: OBSERVED_AT }),
        Object.freeze({ kind: 'REVISE', sourceRecordId: B, expectedPreviousRevision: 1, expectedPreviousDigest: 'b', previousRowHint: 3, currentRevision: 2, currentDigest: 'b2', currentRowHint: 3, observedAt: OBSERVED_AT }),
        Object.freeze({ kind: 'CREATE', sourceRecordId: NEW, currentRevision: 1, currentDigest: 'new', currentRowHint: 4, observedAt: OBSERVED_AT }),
        Object.freeze({ kind: 'MARK_MISSING', sourceRecordId: D, expectedRevision: 1, expectedDigest: 'd', previousRowHint: 5 }),
      ]),
      unresolvedBlocks: Object.freeze([]),
    }),
  });
}

function semantic() {
  return Object.freeze({
    previous: Object.freeze({ semanticEvidence: Object.freeze([]), financialQualityEvidence: Object.freeze([]) }),
    observations: Object.freeze({ outcomes: Object.freeze([]) }),
    transition: Object.freeze({
      decisions: Object.freeze([
        Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: A, classification: 'FINANCIAL_RECORD' }),
        Object.freeze({
          kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE', sourceRecordId: B, transactionId: TX_B,
          expectedTransactionVersion: 7, transaction: transaction(15000, 'revise current'),
        }),
        Object.freeze({
          kind: 'CREATE_FINANCIAL_CANDIDATE', sourceRecordId: NEW,
          transaction: transaction(20000, 'new current'), transactionIdentityAssignmentRequired: true,
        }),
        Object.freeze({ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: D, transactionId: TX_D }),
      ]),
      unresolvedObservations: Object.freeze([]),
    }),
  });
}

function input(assignments = [{ sourceRecordId: NEW, transactionId: TX_NEW }]) {
  return {
    structural: structural(),
    semantic: semantic(),
    previousSourceCurrent: previousSources(),
    previousTransactions: previousTransactions(),
    transactionAssignments: Object.freeze(assignments.map((item) => Object.freeze(item))),
    observedAt: OBSERVED_AT,
  };
}

test('composes exact source/transaction candidates and current delta from explicit transaction identity assignment', () => {
  const plan = buildIncrementalCurrentCandidatePreparation(input());

  assert.equal(plan.sourceCandidates.promotionBlocker, null);
  assert.equal(plan.transactionCandidates.promotionBlocker, null);

  const revisedSource = plan.sourceCandidates.sourceRecords.find((item) => item.id === B);
  const createdSource = plan.sourceCandidates.sourceRecords.find((item) => item.id === NEW);
  const missingSource = plan.sourceCandidates.sourceRecords.find((item) => item.id === D);
  assert.equal(revisedSource.currentRevision, 2);
  assert.equal(revisedSource.currentDigest, 'b2');
  assert.equal(createdSource.transactionId, TX_NEW);
  assert.equal(createdSource.currentRevision, 1);
  assert.equal(missingSource.state, 'MISSING');
  assert.equal(missingSource.transactionId, TX_D);

  const revisedTx = plan.transactionCandidates.transactions.find((item) => item.id === TX_B);
  const createdTx = plan.transactionCandidates.transactions.find((item) => item.id === TX_NEW);
  assert.equal(revisedTx.version, 8);
  assert.equal(revisedTx.transaction.amountMinor, 15000);
  assert.equal(createdTx.version, 1);
  assert.equal(createdTx.transaction.amountMinor, 20000);

  assert.deepEqual(plan.currentDelta.transactionIntents.map((intent) => [intent.kind, intent.candidate.id]), [
    ['REPLACE_TRANSACTION', TX_B],
    ['CREATE_TRANSACTION', TX_NEW],
  ]);
  assert.deepEqual(plan.currentDelta.sourceIntents.map((intent) => [intent.kind, intent.candidate.id]), [
    ['UPDATE_SOURCE_RECORD', A],
    ['UPDATE_SOURCE_RECORD', B],
    ['UPDATE_SOURCE_RECORD', D],
    ['CREATE_SOURCE_RECORD', NEW],
  ]);
  assert.equal(plan.currentDelta.promotionBlocker, null);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.sourceCandidates), true);
  assert.equal(Object.isFrozen(plan.transactionCandidates), true);
  assert.equal(Object.isFrozen(plan.currentDelta), true);
});

test('missing explicit assignment for a new financial source remains fail-closed', () => {
  assert.throws(
    () => buildIncrementalCurrentCandidatePreparation(input([])),
    (error) => error instanceof IncrementalSourceCurrentCandidateError
      && error.code === 'MISSING_TRANSACTION_ASSIGNMENT',
  );
});

test('transaction assignment cannot collide with verified existing transaction identity', () => {
  assert.throws(
    () => buildIncrementalCurrentCandidatePreparation(input([{ sourceRecordId: NEW, transactionId: TX_A }])),
    (error) => error instanceof IncrementalSourceCurrentCandidateError
      && error.code === 'TRANSACTION_ASSIGNMENT_COLLISION',
  );
});
