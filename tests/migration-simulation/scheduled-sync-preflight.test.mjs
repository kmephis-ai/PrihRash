import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { runScheduledSyncPreflight } from '../../dist/migration/scheduledSyncPreflight.js';

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

function makeAdapter(rows, observed = {}) {
  return new YdbAdapter({
    async executeRead(statement) {
      observed.readStatements ??= [];
      observed.readStatements.push(statement);
      return { rows };
    },
    async serializableReadWrite() {
      observed.writeCalled = true;
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });
}

function makeSource(snapshotDigest, observed = {}) {
  return {
    async readFullSnapshotObservation() {
      observed.sourceReads = (observed.sourceReads ?? 0) + 1;
      observed.sequence ??= [];
      observed.sequence.push('SOURCE');
      return { snapshotDigest, rawPayload: 'must-not-escape-reader' };
    },
  };
}

async function run({ digest = 'digest-b', rows = [committedRow()], observed = {} } = {}) {
  const adapter = makeAdapter(rows, observed);
  const source = makeSource(digest, observed);
  const originalRead = adapter.read.bind(adapter);
  adapter.read = async (statement) => {
    observed.sequence ??= [];
    observed.sequence.push('YDB');
    return originalRead(statement);
  };
  return { result: await runScheduledSyncPreflight(source, adapter), observed };
}

test('START_INCREMENTAL combines fresh source digest with committed YDB baseline read-only', async () => {
  const { result, observed } = await run();
  assert.deepEqual(result, { decision: 'START_INCREMENTAL', observedSnapshotDigest: 'digest-b' });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(observed.sequence, ['SOURCE', 'YDB']);
  assert.equal(observed.sourceReads, 1);
  assert.equal(observed.readStatements.length, 1);
  assert.equal(observed.readStatements[0].kind, 'READ');
  assert.equal(observed.writeCalled, undefined);
  assert.equal('rawPayload' in result, false);
});

test('NO_CHANGE is returned for exact digest match without creating a run', async () => {
  const { result, observed } = await run({ digest: 'digest-a' });
  assert.deepEqual(result, { decision: 'NO_CHANGE', observedSnapshotDigest: 'digest-a' });
  assert.equal(observed.writeCalled, undefined);
});

test('BOOTSTRAP_REQUIRED is surfaced when provider has no committed baseline', async () => {
  const { result } = await run({ rows: [] });
  assert.deepEqual(result, { decision: 'BOOTSTRAP_REQUIRED', observedSnapshotDigest: 'digest-b' });
});

test('RECOVERY_REQUIRED blocks a new sync when unfinished run exists', async () => {
  const rows = [
    committedRow(),
    committedRow({
      id: '00000000-0000-0000-0000-000000000b02',
      state: 'STAGING',
      started_at: '2026-09-07T11:00:00.000Z',
      finished_at: null,
      source_snapshot_digest: 'digest-b',
    }),
  ];
  const { result, observed } = await run({ rows });
  assert.deepEqual(result, { decision: 'RECOVERY_REQUIRED', observedSnapshotDigest: 'digest-b' });
  assert.equal(observed.writeCalled, undefined);
});

test('source failure stops before YDB read and propagates fail-closed', async () => {
  let ydbReads = 0;
  const sourceError = new Error('SOURCE_UNAVAILABLE');
  const source = {
    async readFullSnapshotObservation() {
      throw sourceError;
    },
  };
  const adapter = new YdbAdapter({
    async executeRead() {
      ydbReads += 1;
      return { rows: [] };
    },
    async serializableReadWrite() {
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });

  await assert.rejects(() => runScheduledSyncPreflight(source, adapter), (error) => error === sourceError);
  assert.equal(ydbReads, 0);
});

test('YDB evidence failure propagates and never degrades to NO_CHANGE', async () => {
  const providerError = new Error('YDB_UNAVAILABLE');
  const adapter = new YdbAdapter({
    async executeRead() {
      throw providerError;
    },
    async serializableReadWrite() {
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });

  await assert.rejects(
    () => runScheduledSyncPreflight(makeSource('digest-a'), adapter),
    (error) => error === providerError,
  );
});

test('invalid source digest is rejected by admission validation', async () => {
  await assert.rejects(
    () => runScheduledSyncPreflight(makeSource(''), makeAdapter([committedRow()])),
    (error) => error?.code === 'INVALID_OBSERVED_SNAPSHOT_DIGEST',
  );
});
