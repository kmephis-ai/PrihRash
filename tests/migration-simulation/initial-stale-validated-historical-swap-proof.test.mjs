import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseInitialStaleValidatedHistoricalSwapProof,
} from '../../dist/migration/initialStaleValidatedHistoricalSwapProof.js';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const RUN_ID = id(678001);

function run(overrides = {}) {
  return Object.freeze({
    id: RUN_ID,
    startedAt: '2026-09-19T18:00:00Z',
    finishedAt: null,
    sourceSnapshotDigest: 'historical-a',
    state: 'VALIDATED',
    rowsSeen: 1,
    rowsNew: 1,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
    ...overrides,
  });
}

const verifiedPlan = Object.freeze({
  sourceRecords: Object.freeze([Object.freeze({
    id: id(678002),
    classification: 'FINANCIAL_RECORD',
    transactionId: id(678003),
  })]),
  transactions: Object.freeze([Object.freeze({
    sourceRecordId: id(678002),
    transactionId: id(678003),
    transaction: Object.freeze({}),
  })]),
});

const refs = Object.freeze({
  vikaMemberId: id(678004),
  resolveAccountId() { return null; },
  resolveCategoryId() { return null; },
});
const historicalEvidence = Object.freeze({});

function runtime(overrides = {}) {
  const calls = [];
  const value = Object.freeze({
    async readAdmission() {
      calls.push('admission');
      return Object.freeze({
        committedBaselineRun: null,
        incompleteRuns: Object.freeze([run()]),
      });
    },
    async reconstructHistoricalCandidate(_adapter, durableRun) {
      calls.push('historical');
      return Object.freeze({ run: durableRun, verifiedPlan });
    },
    async readSetupEvidence(_scheme, _adapter, controlled) {
      calls.push('setup');
      assert.equal(controlled.runId, RUN_ID);
      assert.deepEqual(controlled.stagingTables, {
        transactions: `rebuild/r_${RUN_ID.replaceAll('-', '')}/transactions`,
        sourceRecords: `rebuild/r_${RUN_ID.replaceAll('-', '')}/source_records`,
      });
      assert.equal(controlled.expectedSourceRecordCount, 1);
      assert.equal(controlled.expectedTransactionCount, 1);
      return Object.freeze({
        currentTransactionCount: 0,
        currentSourceRecordCount: 0,
        rebuildDirectoryExists: true,
        stagingDirectoryExists: true,
        stagingTransactionsExists: true,
        stagingSourceRecordsExists: true,
      });
    },
    async readStagingEvidence() {
      calls.push('staging');
      return Object.freeze({ synthetic: true });
    },
    gateSwap(durableRun, controlled, plan) {
      calls.push('gate');
      assert.equal(durableRun.id, RUN_ID);
      assert.equal(plan, verifiedPlan);
      return Object.freeze({
        runId: durableRun.id,
        replacements: controlled.replacements,
      });
    },
    async recoverSwap() {
      calls.push('recover');
      return Object.freeze({ verdict: 'NOT_APPLIED' });
    },
    ...overrides,
  });
  return { calls, value };
}

test('proves historical context, exact staging and NOT_APPLIED without any Google dependency', async () => {
  const r = runtime();
  const result = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}),
    Object.freeze({}),
    refs,
    historicalEvidence,
    r.value,
  );

  assert.equal(result.status, 'PROVEN_NOT_APPLIED');
  assert.equal(result.run.id, RUN_ID);
  assert.deepEqual(result.evidence, {
    historicalContextProven: true,
    currentStateEmpty: true,
    stagingCandidateExact: true,
    swapProvenNotApplied: true,
  });
  assert.deepEqual(r.calls, ['admission', 'historical', 'setup', 'staging', 'gate', 'recover']);
});

test('stops before staging when historical context cannot be reconstructed', async () => {
  const r = runtime({
    async reconstructHistoricalCandidate() {
      r.calls.push('historical');
      throw new Error('synthetic historical mismatch');
    },
  });
  const result = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}),
    Object.freeze({}),
    refs,
    historicalEvidence,
    r.value,
  );
  assert.deepEqual(result.evidence, {
    historicalContextProven: false,
    currentStateEmpty: false,
    stagingCandidateExact: false,
    swapProvenNotApplied: false,
  });
  assert.equal(result.status, 'STOP');
  assert.equal(result.reason, 'HISTORICAL_CONTEXT_NOT_PROVEN');
  assert.deepEqual(r.calls, ['admission', 'historical']);
});

test('stops when current tables are not exact-empty', async () => {
  const r = runtime({
    async readSetupEvidence() {
      r.calls.push('setup');
      return Object.freeze({
        currentTransactionCount: 1,
        currentSourceRecordCount: 0,
        stagingTransactionsExists: true,
        stagingSourceRecordsExists: true,
      });
    },
  });
  const result = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}),
    Object.freeze({}),
    refs,
    historicalEvidence,
    r.value,
  );
  assert.equal(result.status, 'STOP');
  assert.equal(result.reason, 'CURRENT_STATE_NOT_EMPTY');
  assert.equal(result.evidence.historicalContextProven, true);
  assert.equal(result.evidence.currentStateEmpty, false);
  assert.deepEqual(r.calls, ['admission', 'historical', 'setup']);
});

test('stops when exact staging reconciliation cannot be proven', async () => {
  const r = runtime({
    gateSwap() {
      r.calls.push('gate');
      throw new Error('synthetic mismatch');
    },
  });
  const result = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}),
    Object.freeze({}),
    refs,
    historicalEvidence,
    r.value,
  );
  assert.equal(result.status, 'STOP');
  assert.equal(result.reason, 'STAGING_CANDIDATE_MISMATCH');
  assert.deepEqual(result.evidence, {
    historicalContextProven: true,
    currentStateEmpty: true,
    stagingCandidateExact: false,
    swapProvenNotApplied: false,
  });
  assert.deepEqual(r.calls, ['admission', 'historical', 'setup', 'staging', 'gate']);
});

test('APPLIED is a stop and never masquerades as NOT_APPLIED proof', async () => {
  const r = runtime({
    async recoverSwap() {
      r.calls.push('recover');
      return Object.freeze({ verdict: 'APPLIED' });
    },
  });
  const result = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}),
    Object.freeze({}),
    refs,
    historicalEvidence,
    r.value,
  );
  assert.equal(result.status, 'STOP');
  assert.equal(result.reason, 'SWAP_ALREADY_APPLIED');
  assert.equal(result.evidence.stagingCandidateExact, true);
  assert.equal(result.evidence.swapProvenNotApplied, false);
});

test('admission requires no committed baseline and exactly one VALIDATED run', async () => {
  const committed = run({ state: 'COMMITTED', finishedAt: '2026-09-19T18:30:00Z' });
  const committedRuntime = runtime({
    async readAdmission() {
      committedRuntime.calls.push('admission');
      return Object.freeze({
        committedBaselineRun: committed,
        incompleteRuns: Object.freeze([run()]),
      });
    },
  });
  const committedResult = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}), Object.freeze({}), refs, historicalEvidence, committedRuntime.value,
  );
  assert.equal(committedResult.status, 'STOP');
  assert.equal(committedResult.reason, 'COMMITTED_BASELINE_PRESENT');

  const multipleRuntime = runtime({
    async readAdmission() {
      multipleRuntime.calls.push('admission');
      return Object.freeze({
        committedBaselineRun: null,
        incompleteRuns: Object.freeze([run(), run({ id: id(678099) })]),
      });
    },
  });
  const multipleResult = await diagnoseInitialStaleValidatedHistoricalSwapProof(
    Object.freeze({}), Object.freeze({}), refs, historicalEvidence, multipleRuntime.value,
  );
  assert.equal(multipleResult.status, 'STOP');
  assert.equal(multipleResult.reason, 'VALIDATED_RUN_NOT_UNIQUE');
});
