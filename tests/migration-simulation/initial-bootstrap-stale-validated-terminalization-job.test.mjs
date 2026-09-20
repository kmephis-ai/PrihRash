import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeInitialBootstrapStaleValidatedTerminalizationJob,
  executeInitialBootstrapStaleValidatedTerminalizationRecoveryJob,
} from '../../dist/runtime/initialBootstrapStaleValidatedTerminalizationJob.js';

const CONFIG = Object.freeze({
  spreadsheetId: 'synthetic-sheet',
  googleServiceAccountEmail: 'synthetic@example.invalid',
  googleServiceAccountPrivateKey: 'synthetic-key',
  ydbConnectionString: 'grpcs://synthetic.invalid/?database=/synthetic',
  privateHistoricalEvidence: '{"synthetic":true}',
});
const FINISHED_AT = '2026-09-20T18:30:00Z';
const RUN = Object.freeze({
  id: '00000000-0000-0000-0000-000000000981',
  startedAt: '2026-09-19T21:12:29Z',
  finishedAt: null,
  sourceSnapshotDigest: 'synthetic-historical-digest',
  state: 'VALIDATED',
  rowsSeen: 2,
  rowsNew: 2,
  rowsChanged: 0,
  rowsMissing: 0,
  rowsAmbiguous: 0,
  errorCode: null,
});

function readyPreflight(overrides = {}) {
  return Object.freeze({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
    validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
    staleValidatedRecoveryGate: Object.freeze({
      status: 'BLOCKED',
      blocker: 'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN',
    }),
    ...overrides,
  });
}

function fixture({
  preflight = readyPreflight(),
  markerPresent = false,
  admission = Object.freeze({ committedBaselineRun: null, incompleteRuns: Object.freeze([RUN]) }),
  terminalizeError = null,
  outcome = Object.freeze({ verdict: 'APPLIED', reason: 'EXACT_FAILED_MARKER' }),
  durableOutcome = Object.freeze({ verdict: 'APPLIED', reason: 'EXACT_FAILED_MARKER' }),
} = {}) {
  const events = [];
  let clients = 0;
  const runtime = {
    async runRecovery() {
      events.push('preflight');
      return preflight;
    },
    async createYdbClient() {
      clients += 1;
      const clientNo = clients;
      events.push(`client-${clientNo}`);
      return {
        transport: {
          async executeRead() { throw new Error('unexpected direct transport read'); },
          async serializableReadWrite() { throw new Error('unexpected direct transport write'); },
        },
        async close() { events.push(`close-${clientNo}`); },
      };
    },
    async hasTerminalMarker() {
      events.push('marker-check');
      return markerPresent;
    },
    async readAdmission() {
      events.push('admission');
      return admission;
    },
    async terminalize(_adapter, finishedAt, expectedRun) {
      events.push('terminalize');
      assert.equal(finishedAt, FINISHED_AT);
      assert.equal(expectedRun, RUN);
      if (terminalizeError !== null) throw terminalizeError;
      return Object.freeze({ ...RUN, state: 'FAILED', finishedAt, errorCode: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT' });
    },
    async diagnoseOutcome() {
      events.push('outcome');
      return outcome;
    },
    async diagnoseDurableOutcome() {
      events.push('durable-outcome');
      return durableOutcome;
    },
  };
  return { runtime, events };
}

test('Gate B executes one marker attempt only after exact owner-exception preflight', async () => {
  const f = fixture();
  assert.deepEqual(
    await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, f.runtime),
    { status: 'PASS', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED', outcome: 'EXACT_FAILED_MARKER' },
  );
  assert.deepEqual(f.events, ['preflight', 'client-1', 'marker-check', 'admission', 'terminalize', 'outcome', 'close-1']);
});

test('Gate B refuses any preflight other than the exact historical condition-6 blocker', async () => {
  for (const preflight of [
    readyPreflight({ validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH' }),
    readyPreflight({ staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'SINGLE_WRITER_EXCLUSION_NOT_PROVEN' } }),
    readyPreflight({ reason: 'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY' }),
  ]) {
    const f = fixture({ preflight });
    assert.deepEqual(
      await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, f.runtime),
      { status: 'STOP', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_BLOCKED', reason: 'PREFLIGHT_NOT_OWNER_EXCEPTION_READY' },
    );
    assert.deepEqual(f.events, ['preflight']);
  }
});

test('Gate B refuses an existing terminal marker or changed admission before write', async () => {
  const marker = fixture({ markerPresent: true });
  assert.equal((await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, marker.runtime)).reason, 'TERMINAL_MARKER_ALREADY_PRESENT');
  assert.equal(marker.events.includes('terminalize'), false);

  const changed = fixture({ admission: Object.freeze({ committedBaselineRun: null, incompleteRuns: Object.freeze([]) }) });
  assert.equal((await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, changed.runtime)).reason, 'VALIDATED_RUN_NOT_UNIQUE');
  assert.equal(changed.events.includes('terminalize'), false);
});

test('post-write readback failure performs durable recovery and never retries the write', async () => {
  const f = fixture();
  f.runtime.diagnoseOutcome = async () => {
    f.events.push('outcome');
    throw new Error('synthetic post-write readback failure');
  };
  assert.deepEqual(
    await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, f.runtime),
    { status: 'PASS', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED', outcome: 'EXACT_FAILED_MARKER' },
  );
  assert.equal(f.events.filter((entry) => entry === 'terminalize').length, 1);
  assert.deepEqual(f.events.slice(-3), ['client-2', 'durable-outcome', 'close-2']);
});

test('unknown marker outcome performs read-only durable recovery and never retries the write', async () => {
  const applied = fixture({ terminalizeError: new Error('synthetic unknown') });
  assert.deepEqual(
    await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, applied.runtime),
    { status: 'PASS', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED', outcome: 'EXACT_FAILED_MARKER' },
  );
  assert.equal(applied.events.filter((entry) => entry === 'terminalize').length, 1);
  assert.deepEqual(applied.events.slice(-3), ['client-2', 'durable-outcome', 'close-2']);

  const unchanged = fixture({
    terminalizeError: new Error('synthetic unknown'),
    durableOutcome: Object.freeze({ verdict: 'RECOVERY_REQUIRED', reason: 'UNCHANGED_VALIDATED_NO_RETRY' }),
  });
  assert.deepEqual(
    await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, FINISHED_AT, unchanged.runtime),
    { status: 'STOP', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_BLOCKED', reason: 'MARKER_OUTCOME_UNCHANGED_VALIDATED_NO_RETRY' },
  );
  assert.equal(unchanged.events.filter((entry) => entry === 'terminalize').length, 1);
});

test('recovery mode is read-only and classifies only durable marker state', async () => {
  const f = fixture();
  assert.deepEqual(
    await executeInitialBootstrapStaleValidatedTerminalizationRecoveryJob(CONFIG, f.runtime),
    { status: 'PASS', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED', outcome: 'EXACT_FAILED_MARKER' },
  );
  assert.deepEqual(f.events, ['client-1', 'durable-outcome', 'close-1']);
});

test('invalid Gate B finished_at fails before provider activity', async () => {
  const f = fixture();
  assert.deepEqual(
    await executeInitialBootstrapStaleValidatedTerminalizationJob(CONFIG, 'not-a-timestamp', f.runtime),
    { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_RUNTIME_FAILED', reason: 'RUNTIME_FAILED' },
  );
  assert.deepEqual(f.events, []);
});
