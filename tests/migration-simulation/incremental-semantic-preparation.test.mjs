import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncrementalSemanticPreparation } from '../../dist/migration/incrementalSemanticPreparation.js';
import { IncrementalPreviousSemanticEvidenceError } from '../../dist/migration/incrementalPreviousSemanticEvidence.js';
import { IncrementalCurrentObservationSemanticError } from '../../dist/migration/incrementalCurrentObservationSemantics.js';

const A = '00000000-0000-0000-0000-000000003001';
const B = '00000000-0000-0000-0000-000000003002';
const D = '00000000-0000-0000-0000-000000003004';
const NEW = '00000000-0000-0000-0000-000000003005';
const TX_A = '00000000-0000-0000-0000-000000003101';
const TX_B = '00000000-0000-0000-0000-000000003102';
const TX_D = '00000000-0000-0000-0000-000000003104';
const ACCOUNT = '00000000-0000-0000-0000-000000003201';
const CATEGORY = '00000000-0000-0000-0000-000000003301';
const MEMBER = '00000000-0000-0000-0000-000000003401';
const OBSERVED_AT = '2026-09-07T13:30:00.000Z';

function payload(description, amount = '100') {
  return Object.freeze({
    adapter_schema_version: 2,
    date: { kind: 'NUMBER', value: '45500' },
    operation_type: { kind: 'STRING', value: 'Расход' },
    expense_account: { kind: 'STRING', value: 'Карта Visa' },
    expense_category: { kind: 'STRING', value: 'Synthetic Category' },
    description: { kind: 'STRING', value: description },
    expense_amount: { kind: 'NUMBER', value: amount },
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
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

function tx(id, version, amountMinor = 10000) {
  return Object.freeze({
    id,
    version,
    transaction: Object.freeze({
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
      description: 'previous',
      note: null,
      status: 'POSTED',
      analyticsState: 'INCLUDED',
      flowKind: null,
    }),
  });
}

function structural() {
  return Object.freeze({
    lineage: Object.freeze({ outcomes: Object.freeze([]), counters: Object.freeze({}) }),
    changeEvidence: Object.freeze({ changeEvidence: Object.freeze([]), contextDependentSourceRecordIds: Object.freeze([]) }),
    revisions: Object.freeze({
      revisions: Object.freeze([
        Object.freeze({ sourceRecordId: B, revision: 2, migrationRunId: '00000000-0000-0000-0000-000000003900', observedAt: OBSERVED_AT, rowHint: 3, rowDigest: 'b2', changeClass: 'OWNER_CORRECTION', rawPayload: '{}' }),
        Object.freeze({ sourceRecordId: NEW, revision: 1, migrationRunId: '00000000-0000-0000-0000-000000003900', observedAt: OBSERVED_AT, rowHint: 4, rowDigest: 'new', changeClass: null, rawPayload: '{}' }),
      ]),
    }),
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

const refs = Object.freeze({
  resolveAccountId(label) {
    return label === 'Карта Visa' ? ACCOUNT : null;
  },
  resolveCategoryId(kind, label) {
    return kind === 'EXPENSE' && label === 'Synthetic Category' ? CATEGORY : null;
  },
  vikaMemberId: MEMBER,
});

function input() {
  return {
    structural: structural(),
    currentObservations: Object.freeze([
      Object.freeze({ currentRowHint: 2, sourceOrdinal: 10, rawPayload: payload('touch') }),
      Object.freeze({ currentRowHint: 3, sourceOrdinal: 20, rawPayload: payload('owner correction', '150') }),
      Object.freeze({ currentRowHint: 4, sourceOrdinal: 30, rawPayload: payload('new financial', '200') }),
    ]),
    previousSourceCurrent: Object.freeze([
      source(A, 2, 'a', TX_A),
      source(B, 3, 'b', TX_B),
      source(D, 5, 'd', TX_D),
    ]),
    previousTransactions: Object.freeze([
      tx(TX_A, 1),
      tx(TX_B, 7),
      tx(TX_D, 2),
    ]),
    refs,
  };
}

test('composes previous evidence, explicit observation semantics and semantic transition without assigning new transaction ids', () => {
  const plan = buildIncrementalSemanticPreparation(input());

  assert.deepEqual(plan.previous.semanticEvidence.map((item) => [item.sourceRecordId, item.transactionId, item.transactionVersion]), [
    [A, TX_A, 1],
    [B, TX_B, 7],
    [D, TX_D, 2],
  ]);
  assert.deepEqual(plan.previous.financialQualityEvidence, [{
    sourceRecordId: B,
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
  }]);
  assert.deepEqual(plan.observations.outcomes.map((item) => [item.currentRowHint, item.sourceOrdinal, item.lineageKind]), [
    [2, 10, 'TOUCH'],
    [3, 20, 'REVISE'],
    [4, 30, 'CREATE'],
  ]);
  assert.deepEqual(plan.transition.decisions.map((item) => item.kind), [
    'TOUCH_PRESERVE',
    'OWNER_CORRECTION_REPLACE_CANDIDATE',
    'CREATE_FINANCIAL_CANDIDATE',
    'MARK_MISSING_PRESERVE_CANONICAL',
  ]);

  const revised = plan.transition.decisions[1];
  assert.equal(revised.transactionId, TX_B);
  assert.equal(revised.expectedTransactionVersion, 7);
  assert.equal(revised.transaction.amountMinor, 15000);

  const created = plan.transition.decisions[2];
  assert.equal(created.transactionIdentityAssignmentRequired, true);
  assert.equal(Object.hasOwn(created, 'transactionId'), false);
  assert.equal(created.transaction.amountMinor, 20000);

  const missing = plan.transition.decisions[3];
  assert.equal(missing.transactionId, TX_D);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.previous), true);
  assert.equal(Object.isFrozen(plan.observations), true);
  assert.equal(Object.isFrozen(plan.transition), true);
});

test('missing linked transaction remains fail-closed in previous evidence projection', () => {
  const broken = input();
  broken.previousTransactions = Object.freeze(broken.previousTransactions.filter((item) => item.id !== TX_B));
  assert.throws(
    () => buildIncrementalSemanticPreparation(broken),
    (error) => error instanceof IncrementalPreviousSemanticEvidenceError
      && error.code === 'MISSING_LINKED_TRANSACTION',
  );
});

test('caller-provided current observation coverage remains exact and is not derived from row hints or indexes', () => {
  const broken = input();
  broken.currentObservations = Object.freeze(broken.currentObservations.slice(0, 2));
  assert.throws(
    () => buildIncrementalSemanticPreparation(broken),
    (error) => error instanceof IncrementalCurrentObservationSemanticError
      && error.code === 'CURRENT_ROW_COVERAGE_MISMATCH',
  );
});
