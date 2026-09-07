import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ReaderRecentOperationsError,
  readRecentOperations,
  readRecentOperationsPage,
} from '../../dist/reader/recentOperations.js';

const RUN_ID = '00000000-0000-0000-0000-000000000901';

function committedRun(overrides = {}) {
  return {
    id: RUN_ID,
    started_at: '2026-09-07T10:00:00.000Z',
    finished_at: '2026-09-07T10:00:05.000Z',
    source_snapshot_digest: 'synthetic-reader-verified-shadow',
    state: 'COMMITTED',
    rows_seen: 1n,
    rows_new: 1n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
    ...overrides,
  };
}

function incompleteRun(state) {
  return committedRun({
    id: state === 'STAGING'
      ? '00000000-0000-0000-0000-000000000902'
      : '00000000-0000-0000-0000-000000000903',
    started_at: '2026-09-07T10:01:00.000Z',
    finished_at: null,
    source_snapshot_digest: `synthetic-${state.toLowerCase()}`,
    state,
  });
}

function adapterWithAdmission(admissionRows, capture = [], options = {}) {
  return new YdbAdapter({
    async executeRead(statement) {
      capture.push(statement);
      if (statement.text.includes('FROM migration_runs WHERE state IN')) {
        if (options.failAdmission === true) throw new Error('synthetic provider read failure');
        return { rows: admissionRows };
      }
      if (options.failCanonical === true) throw new Error('unexpected canonical read');
      return { rows: [] };
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

for (const state of ['STAGING', 'VALIDATED']) {
  test(`initial ${state} without a durable COMMITTED baseline blocks before canonical read`, async () => {
    const capture = [];
    const adapter = adapterWithAdmission([incompleteRun(state)], capture, { failCanonical: true });

    await assert.rejects(
      () => readRecentOperations(adapter, 10),
      (error) => error instanceof ReaderRecentOperationsError
        && error.code === 'VERIFIED_SHADOW_UNAVAILABLE',
    );

    assert.equal(capture.length, 1);
    assert.match(capture[0].text, /FROM migration_runs WHERE state IN/);
  });
}

test('durable COMMITTED baseline admits canonical read even while ordinary incremental evidence is incomplete', async () => {
  const capture = [];
  const adapter = adapterWithAdmission([committedRun(), incompleteRun('STAGING')], capture);

  const result = await readRecentOperationsPage(adapter, 10);

  assert.deepEqual(result, { items: [], limit: 10, nextCursor: null });
  assert.equal(capture.length, 2);
  assert.match(capture[0].text, /FROM migration_runs WHERE state IN/);
  assert.match(capture[1].text, /FROM transactions AS t/);
});

test('missing committed history fails closed before canonical read', async () => {
  const capture = [];
  const adapter = adapterWithAdmission([], capture, { failCanonical: true });

  await assert.rejects(
    () => readRecentOperations(adapter, 10),
    (error) => error instanceof ReaderRecentOperationsError
      && error.code === 'VERIFIED_SHADOW_UNAVAILABLE',
  );
  assert.equal(capture.length, 1);
});

test('malformed or unreadable migration-run evidence maps to safe Reader unavailability', async () => {
  const malformed = committedRun({ finished_at: null });
  const cases = [
    adapterWithAdmission([malformed], []),
    adapterWithAdmission([], [], { failAdmission: true }),
  ];

  for (const adapter of cases) {
    await assert.rejects(
      () => readRecentOperations(adapter, 10),
      (error) => error instanceof ReaderRecentOperationsError
        && error.code === 'VERIFIED_SHADOW_UNAVAILABLE'
        && error.message === 'VERIFIED_SHADOW_UNAVAILABLE',
    );
  }
});
