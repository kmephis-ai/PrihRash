import assert from 'node:assert/strict';
import test from 'node:test';
import { IncrementalLineagePlanError } from '../../dist/migration/incrementalLineagePlan.js';
import { IncrementalSourceCurrentCandidateError } from '../../dist/migration/incrementalSourceCurrentCandidate.js';
import { prepareScheduledIncrementalCandidate } from '../../dist/migration/scheduledIncrementalCandidatePreparation.js';

const BASELINE_RUN = '00000000-0000-0000-0000-000000006001';
const RUN_ID = '00000000-0000-0000-0000-000000006002';
const SOURCE_ID = '00000000-0000-0000-0000-000000006003';
const TX_ID = '00000000-0000-0000-0000-000000006004';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000006005';
const CATEGORY_ID = '00000000-0000-0000-0000-000000006006';
const MEMBER_ID = '00000000-0000-0000-0000-000000006007';
const STARTED_AT = '2026-09-07T15:00:00.000Z';
const OBSERVED_AT = '2026-09-07T15:00:01.000Z';

const rawPayload = Object.freeze({
  adapter_schema_version: 2,
  date: { kind: 'NUMBER', value: '45500' },
  operation_type: { kind: 'STRING', value: 'Расход' },
  expense_account: { kind: 'STRING', value: 'Synthetic Account' },
  expense_category: { kind: 'STRING', value: 'Synthetic Category' },
  description: { kind: 'STRING', value: 'Synthetic Description' },
  expense_amount: { kind: 'NUMBER', value: '123.45' },
  income_account: null,
  income_category: null,
  income_amount: null,
  vika_flag: null,
  note: null,
});

const projection = Object.freeze({
  rows: Object.freeze([
    Object.freeze({ rowHint: 2, digest: 'digest-new', rawPayload }),
  ]),
});

const baselineRun = Object.freeze({
  id: BASELINE_RUN,
  startedAt: '2026-09-07T14:00:00.000Z',
  finishedAt: '2026-09-07T14:01:00.000Z',
  sourceSnapshotDigest: 'baseline-digest',
  state: 'COMMITTED',
  rowsSeen: 0,
  rowsNew: 0,
  rowsChanged: 0,
  rowsMissing: 0,
  rowsAmbiguous: 0,
  errorCode: null,
});

const sourceEvidence = Object.freeze({
  lineageRecords: Object.freeze([]),
  sourceCurrent: Object.freeze([]),
});

const revisionEvidence = Object.freeze({
  previousRevisionEvidence: Object.freeze([]),
  currentRevisionPayloads: Object.freeze([]),
});

const refs = Object.freeze({
  vikaMemberId: MEMBER_ID,
  resolveAccountId(label) {
    return label === 'Synthetic Account' ? ACCOUNT_ID : null;
  },
  resolveCategoryId(kind, label) {
    return kind === 'EXPENSE' && label === 'Synthetic Category' ? CATEGORY_ID : null;
  },
});

function baseInput(overrides = {}) {
  return {
    baselineRun,
    sourceEvidence,
    revisionEvidence,
    previousTransactions: Object.freeze([]),
    projection,
    sourceSnapshotDigest: 'current-snapshot-digest',
    runId: RUN_ID,
    startedAt: STARTED_AT,
    observedAt: OBSERVED_AT,
    refs,
    sourceIdentityAllocator: Object.freeze({
      async allocate(requests) {
        return Object.freeze(requests.map((request) => Object.freeze({
          currentRowHint: request.currentRowHint,
          sourceRecordId: SOURCE_ID,
        })));
      },
    }),
    transactionIdentityAllocator: Object.freeze({
      async allocate(requests) {
        return Object.freeze(requests.map((request) => Object.freeze({
          sourceRecordId: request.sourceRecordId,
          transactionId: TX_ID,
        })));
      },
    }),
    ...overrides,
  };
}

test('composes one exact inserted financial observation into a prepared immutable candidate without provider calls', async () => {
  const observed = { sourceRequests: null, transactionRequests: null };
  const input = baseInput({
    sourceIdentityAllocator: Object.freeze({
      async allocate(requests) {
        observed.sourceRequests = requests;
        return Object.freeze([{ currentRowHint: 2, sourceRecordId: SOURCE_ID }]);
      },
    }),
    transactionIdentityAllocator: Object.freeze({
      async allocate(requests) {
        observed.transactionRequests = requests;
        return Object.freeze([{ sourceRecordId: SOURCE_ID, transactionId: TX_ID }]);
      },
    }),
  });

  const plan = await prepareScheduledIncrementalCandidate(input);

  assert.deepEqual(observed.sourceRequests, [{ currentRowHint: 2, digest: 'digest-new' }]);
  assert.deepEqual(observed.transactionRequests, [{ sourceRecordId: SOURCE_ID }]);
  assert.deepEqual(plan.sourceAssignmentRequests, observed.sourceRequests);
  assert.deepEqual(plan.transactionAssignmentRequests, observed.transactionRequests);
  assert.equal(plan.run.state, 'STAGING');
  assert.equal(plan.run.id, RUN_ID);
  assert.equal(plan.run.rowsSeen, 1);
  assert.equal(plan.run.rowsNew, 1);
  assert.equal(plan.run.rowsChanged, 0);
  assert.equal(plan.run.rowsMissing, 0);
  assert.equal(plan.run.rowsAmbiguous, 0);
  assert.deepEqual(plan.structural.lineage.counters, {
    rowsSeen: 1,
    rowsNew: 1,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
  });
  assert.deepEqual(plan.currentObservations.currentObservations.map((item) => ({
    currentRowHint: item.currentRowHint,
    sourceOrdinal: item.sourceOrdinal,
  })), [{ currentRowHint: 2, sourceOrdinal: 0 }]);
  assert.deepEqual(plan.semantic.transition.decisions.map((decision) => decision.kind), [
    'CREATE_FINANCIAL_CANDIDATE',
  ]);
  assert.equal(plan.candidates.sourceCandidates.sourceRecords[0].transactionId, TX_ID);
  assert.equal(plan.candidates.transactionCandidates.transactions[0].id, TX_ID);
  assert.equal(plan.candidates.transactionCandidates.transactions[0].transaction.amountMinor, 12345);
  assert.equal(plan.reconciliation.promotionBlocker, null);
  assert.equal(plan.candidates.currentDelta.sourceIntents[0].kind, 'CREATE_SOURCE_RECORD');
  assert.equal(plan.candidates.currentDelta.transactionIntents[0].kind, 'CREATE_TRANSACTION');
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.sourceAssignmentRequests), true);
  assert.equal(Object.isFrozen(plan.transactionAssignmentRequests), true);
});

test('missing source allocator assignment is rejected by the existing lineage coverage guard', async () => {
  const input = baseInput({
    sourceIdentityAllocator: Object.freeze({
      async allocate() {
        return Object.freeze([]);
      },
    }),
  });

  await assert.rejects(
    () => prepareScheduledIncrementalCandidate(input),
    (error) => error instanceof IncrementalLineagePlanError
      && error.code === 'MISSING_INSERTED_SOURCE_RECORD_ASSIGNMENT',
  );
});

test('missing transaction allocator assignment is rejected by the existing source-current candidate guard', async () => {
  const input = baseInput({
    transactionIdentityAllocator: Object.freeze({
      async allocate() {
        return Object.freeze([]);
      },
    }),
  });

  await assert.rejects(
    () => prepareScheduledIncrementalCandidate(input),
    (error) => error instanceof IncrementalSourceCurrentCandidateError
      && error.code === 'MISSING_TRANSACTION_ASSIGNMENT',
  );
});

test('planner does not request transaction identity when source semantics are non-financial', async () => {
  let transactionRequests = null;
  const nonFinancialPayload = Object.freeze({
    ...rawPayload,
    operation_type: { kind: 'STRING', value: 'Synthetic Unknown Type' },
  });
  const input = baseInput({
    projection: Object.freeze({
      rows: Object.freeze([Object.freeze({ rowHint: 2, digest: 'digest-non-financial', rawPayload: nonFinancialPayload })]),
    }),
    transactionIdentityAllocator: Object.freeze({
      async allocate(requests) {
        transactionRequests = requests;
        return Object.freeze([]);
      },
    }),
  });

  const plan = await prepareScheduledIncrementalCandidate(input);
  assert.deepEqual(transactionRequests, []);
  assert.equal(plan.candidates.transactionCandidates.transactions.length, 0);
});
