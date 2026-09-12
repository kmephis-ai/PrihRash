import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ScheduledSyncReadinessError,
  executeScheduledSyncReadinessProbe,
} from '../../dist/runtime/scheduledSyncReadinessProbe.js';

const syntheticConfig = Object.freeze({
  spreadsheetId: 'synthetic-spreadsheet-id',
  googleServiceAccountEmail: 'synthetic@example.invalid',
  googleServiceAccountPrivateKey: 'synthetic-private-key',
  ydbConnectionString: 'grpcs://synthetic.example.invalid/local',
});

const validMigrationRows = Object.freeze([
  Object.freeze({ version: 1n, checksum: 'checksum-001', applied_at: new Date('2026-09-01T00:00:00.000Z') }),
  Object.freeze({ version: 2n, checksum: 'checksum-002', applied_at: new Date('2026-09-02T00:00:00.000Z') }),
  Object.freeze({ version: 3n, checksum: 'checksum-003', applied_at: new Date('2026-09-03T00:00:00.000Z') }),
]);

function neverResolves() {
  return new Promise(() => {});
}

function successfulSource() {
  return Object.freeze({
    async readFullSnapshotObservation() {
      return Object.freeze({ snapshotDigest: 'synthetic-digest', snapshot: Object.freeze({}) });
    },
  });
}

function transportWithReads(reads) {
  let index = 0;
  return Object.freeze({
    async executeRead() {
      const value = reads[index] ?? [];
      index += 1;
      if (value === 'STALL') return neverResolves();
      return Object.freeze({ rows: Object.freeze(value) });
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

function expectReadinessCode(expectedCode) {
  return (error) => error instanceof ScheduledSyncReadinessError
    && error.code === expectedCode
    && error.message === expectedCode
    && !Object.hasOwn(error, 'cause');
}

test('readiness deadline sanitizes a stalled YDB client creation', async () => {
  const runtime = Object.freeze({
    createSource: successfulSource,
    async createYdbClient() {
      return neverResolves();
    },
  });

  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, runtime, { deadlineMs: 10 }),
    expectReadinessCode('YDB_CLIENT_CREATE_FAILED'),
  );
});

test('readiness deadline sanitizes a stalled Google source read and still closes YDB', async () => {
  let closeCalls = 0;
  const runtime = Object.freeze({
    createSource() {
      return Object.freeze({
        readFullSnapshotObservation: neverResolves,
      });
    },
    async createYdbClient() {
      return Object.freeze({
        transport: transportWithReads([]),
        async close() {
          closeCalls += 1;
        },
      });
    },
  });

  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(
      syntheticConfig,
      runtime,
      { deadlineMs: 10, closeTimeoutMs: 25 },
    ),
    expectReadinessCode('GOOGLE_SOURCE_READ_FAILED'),
  );
  assert.equal(closeCalls, 1);
});

test('readiness deadline sanitizes a stalled YDB health read and still closes YDB', async () => {
  let closeCalls = 0;
  const runtime = Object.freeze({
    createSource: successfulSource,
    async createYdbClient() {
      return Object.freeze({
        transport: transportWithReads(['STALL']),
        async close() {
          closeCalls += 1;
        },
      });
    },
  });

  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(
      syntheticConfig,
      runtime,
      { deadlineMs: 10, closeTimeoutMs: 25 },
    ),
    expectReadinessCode('YDB_QUERY_HEALTH_READ_FAILED'),
  );
  assert.equal(closeCalls, 1);
});

test('readiness close has an independent bounded cleanup timeout', async () => {
  const runtime = Object.freeze({
    createSource: successfulSource,
    async createYdbClient() {
      return Object.freeze({
        transport: transportWithReads([[], [], validMigrationRows, [], [], []]),
        close: neverResolves,
      });
    },
  });

  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(
      syntheticConfig,
      runtime,
      { deadlineMs: 100, closeTimeoutMs: 10 },
    ),
    expectReadinessCode('YDB_CLIENT_CLOSE_FAILED'),
  );
});
