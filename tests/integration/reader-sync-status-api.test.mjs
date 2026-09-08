import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  READER_SYNC_STATUS_API_VERSION,
  ReaderSyncStatusError,
  executeReaderSyncStatusApiRequest,
} from '../../dist/reader/syncStatusApi.js';

const COMMITTED_RUN = Object.freeze({
  id: '00000000-0000-0000-0000-000000000901',
  started_at: '2026-09-08T07:00:00.000Z',
  finished_at: '2026-09-08T07:00:05.000Z',
  source_snapshot_digest: 'synthetic-reader-sync-status',
  state: 'COMMITTED',
  rows_seen: 3n,
  rows_new: 1n,
  rows_changed: 1n,
  rows_missing: 0n,
  rows_ambiguous: 0n,
  error_code: null,
});

const STAGING_RUN = Object.freeze({
  id: '00000000-0000-0000-0000-000000000902',
  started_at: '2026-09-08T08:00:00.000Z',
  finished_at: null,
  source_snapshot_digest: 'synthetic-reader-sync-status-next',
  state: 'STAGING',
  rows_seen: 4n,
  rows_new: 1n,
  rows_changed: 0n,
  rows_missing: 0n,
  rows_ambiguous: 0n,
  error_code: null,
});

function adapterFor(rows, capture = [], failure = null) {
  return new YdbAdapter({
    async executeRead(statement) {
      capture.push(statement);
      if (failure !== null) throw failure;
      return { rows };
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

test('sync status exposes only safe freshness from the latest verified baseline', async () => {
  const capture = [];
  const response = await executeReaderSyncStatusApiRequest(adapterFor([COMMITTED_RUN], capture));

  assert.deepEqual(response, {
    apiVersion: READER_SYNC_STATUS_API_VERSION,
    state: 'READY',
    lastCommittedAt: '2026-09-08T07:00:05.000Z',
    hasIncompleteRun: false,
  });
  assert.equal(capture.length, 1);
  assert.match(capture[0].text, /FROM migration_runs WHERE state IN/u);
  assert.deepEqual(Object.keys(response).sort(), ['apiVersion', 'hasIncompleteRun', 'lastCommittedAt', 'state']);
  assert.equal(JSON.stringify(response).includes('synthetic-reader-sync-status'), false);
  assert.equal(JSON.stringify(response).includes(COMMITTED_RUN.id), false);
});

test('sync status is DEGRADED when a committed baseline coexists with incomplete work', async () => {
  assert.deepEqual(
    await executeReaderSyncStatusApiRequest(adapterFor([STAGING_RUN, COMMITTED_RUN])),
    {
      apiVersion: 1,
      state: 'DEGRADED',
      lastCommittedAt: '2026-09-08T07:00:05.000Z',
      hasIncompleteRun: true,
    },
  );
});

test('sync status is UNAVAILABLE without a committed baseline even when incomplete work exists', async () => {
  assert.deepEqual(
    await executeReaderSyncStatusApiRequest(adapterFor([STAGING_RUN])),
    {
      apiVersion: 1,
      state: 'UNAVAILABLE',
      lastCommittedAt: null,
      hasIncompleteRun: true,
    },
  );
  assert.deepEqual(
    await executeReaderSyncStatusApiRequest(adapterFor([])),
    {
      apiVersion: 1,
      state: 'UNAVAILABLE',
      lastCommittedAt: null,
      hasIncompleteRun: false,
    },
  );
});

test('malformed or failed evidence is fail-closed behind one value-free error code', async () => {
  const malformed = { ...COMMITTED_RUN, id: 'private-malformed-id' };
  for (const adapter of [
    adapterFor([malformed]),
    adapterFor([], [], new Error('private provider identifier and details')),
  ]) {
    await assert.rejects(
      () => executeReaderSyncStatusApiRequest(adapter),
      (error) => error instanceof ReaderSyncStatusError
        && error.code === 'SYNC_STATUS_EVIDENCE_UNAVAILABLE'
        && error.message === 'SYNC_STATUS_EVIDENCE_UNAVAILABLE'
        && !error.message.includes('private'),
    );
  }
});
