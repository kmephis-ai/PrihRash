import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { runScheduledSyncInvocation } from '../../dist/migration/scheduledSyncInvocation.js';

function committedRow(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000b01',
    started_at: '2026-09-07T10:00:00.000Z',
    finished_at: '2026-09-07T10:00:05.000Z',
    source_snapshot_digest: 'digest-a',
    state: 'COMMITTED',
    rows_seen: 10n,
    rows_new: 0n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
    ...overrides,
  };
}

function makeAdapter(rows) {
  return new YdbAdapter({
    async executeRead() {
      return { rows };
    },
    async serializableReadWrite() {
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });
}

function makeSource(digest, observed) {
  const observation = Object.freeze({
    snapshotDigest: digest,
    snapshot: Object.freeze({ token: 'opaque-snapshot-a' }),
  });
  return {
    observation,
    source: {
      async readFullSnapshotObservation() {
        observed.sourceReads = (observed.sourceReads ?? 0) + 1;
        return observation;
      },
    },
  };
}

function makeIncremental(observed) {
  return {
    async runIncremental(observation) {
      observed.incrementalCalls = (observed.incrementalCalls ?? 0) + 1;
      observed.incrementalObservation = observation;
    },
  };
}

test('START_INCREMENTAL passes the exact admitted observation without a second source read', async () => {
  const observed = {};
  const { source, observation } = makeSource('digest-b', observed);

  const result = await runScheduledSyncInvocation(
    source,
    makeAdapter([committedRow()]),
    makeIncremental(observed),
  );

  assert.deepEqual(result, {
    decision: 'START_INCREMENTAL',
    observedSnapshotDigest: 'digest-b',
    incrementalStarted: true,
  });
  assert.equal(observed.sourceReads, 1);
  assert.equal(observed.incrementalCalls, 1);
  assert.equal(observed.incrementalObservation, observation);
  assert.equal('snapshot' in result, false);
});

for (const scenario of [
  {
    name: 'NO_CHANGE',
    digest: 'digest-a',
    rows: [committedRow()],
    decision: 'NO_CHANGE',
  },
  {
    name: 'BOOTSTRAP_REQUIRED',
    digest: 'digest-b',
    rows: [],
    decision: 'BOOTSTRAP_REQUIRED',
  },
  {
    name: 'RECOVERY_REQUIRED',
    digest: 'digest-b',
    rows: [
      committedRow(),
      committedRow({
        id: '00000000-0000-0000-0000-000000000b02',
        state: 'STAGING',
        started_at: '2026-09-07T11:00:00.000Z',
        finished_at: null,
        source_snapshot_digest: 'digest-b',
      }),
    ],
    decision: 'RECOVERY_REQUIRED',
  },
]) {
  test(`${scenario.name} never enters incremental pipeline`, async () => {
    const observed = {};
    const { source } = makeSource(scenario.digest, observed);

    const result = await runScheduledSyncInvocation(
      source,
      makeAdapter(scenario.rows),
      makeIncremental(observed),
    );

    assert.deepEqual(result, {
      decision: scenario.decision,
      observedSnapshotDigest: scenario.digest,
      incrementalStarted: false,
    });
    assert.equal(observed.sourceReads, 1);
    assert.equal(observed.incrementalCalls, undefined);
  });
}

test('incremental failure propagates fail-closed after exactly one admitted source read', async () => {
  const observed = {};
  const { source } = makeSource('digest-b', observed);
  const incrementalError = new Error('INCREMENTAL_FAILED');

  await assert.rejects(
    () => runScheduledSyncInvocation(source, makeAdapter([committedRow()]), {
      async runIncremental() {
        observed.incrementalCalls = (observed.incrementalCalls ?? 0) + 1;
        throw incrementalError;
      },
    }),
    (error) => error === incrementalError,
  );

  assert.equal(observed.sourceReads, 1);
  assert.equal(observed.incrementalCalls, 1);
});
