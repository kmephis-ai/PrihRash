import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION,
  ScheduledSyncReadinessError,
  executeScheduledSyncReadinessProbe,
  runScheduledSyncReadinessProbe,
} from '../../dist/runtime/scheduledSyncReadinessProbe.js';

function sourceThatSucceeds(counter = { calls: 0 }) {
  return {
    async readFullSnapshotObservation() {
      counter.calls += 1;
      return Object.freeze({ snapshotDigest: 'synthetic-digest', snapshot: Object.freeze({}) });
    },
  };
}

function adapterForReads(rowsByCall, capture = { statements: [], transactions: 0 }) {
  let readIndex = 0;
  return {
    adapter: new YdbAdapter({
      async executeRead(statement) {
        capture.statements.push(statement);
        const rows = rowsByCall[readIndex] ?? [];
        readIndex += 1;
        if (rows instanceof Error) throw rows;
        return Object.freeze({ rows: Object.freeze(rows) });
      },
      async serializableReadWrite() {
        capture.transactions += 1;
        throw new Error('unexpected transaction');
      },
    }),
    capture,
  };
}

const validMigrationRows = Object.freeze([
  Object.freeze({ version: 1n, checksum: 'checksum-001', applied_at: '2026-09-01T00:00:00.000Z' }),
  Object.freeze({ version: 2n, checksum: 'checksum-002', applied_at: '2026-09-02T00:00:00.000Z' }),
]);

test('readiness probe performs one Google read and three read-only YDB checks', async () => {
  const sourceCounter = { calls: 0 };
  const { adapter, capture } = adapterForReads([validMigrationRows, [], []]);

  const result = await runScheduledSyncReadinessProbe(sourceThatSucceeds(sourceCounter), adapter);

  assert.deepEqual(result, {
    googleSource: 'READY',
    ydbSchema: 'READY',
    requiredMigrationVersion: REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION,
  });
  assert.equal(sourceCounter.calls, 1);
  assert.equal(capture.transactions, 0);
  assert.equal(capture.statements.length, 3);
  assert.equal(capture.statements[0].kind, 'READ');
  assert.equal(capture.statements[0].text, 'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC');
  assert.equal(capture.statements[1].text, 'SELECT normalized_source_label FROM accounts LIMIT 0');
  assert.equal(capture.statements[2].text, 'SELECT normalized_source_label FROM categories LIMIT 0');
  assert.deepEqual(Object.keys(result).sort(), ['googleSource', 'requiredMigrationVersion', 'ydbSchema']);
});

test('schema migration evidence fails closed for malformed rows', async () => {
  const malformedRows = [
    [{ version: -1, checksum: 'x', applied_at: '2026-09-01T00:00:00.000Z' }],
    [{ version: 1, checksum: '', applied_at: '2026-09-01T00:00:00.000Z' }, validMigrationRows[1]],
    [{ version: 1, checksum: ' x ', applied_at: '2026-09-01T00:00:00.000Z' }, validMigrationRows[1]],
    [{ version: 1, checksum: 'x', applied_at: 'invalid' }, validMigrationRows[1]],
    [validMigrationRows[0], { version: 2, checksum: 'x', applied_at: null }],
    [validMigrationRows[0], validMigrationRows[0], validMigrationRows[1]],
  ];

  for (const rows of malformedRows) {
    const { adapter } = adapterForReads([rows]);
    await assert.rejects(
      () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), adapter),
      (error) => error instanceof ScheduledSyncReadinessError
        && error.code === 'MALFORMED_SCHEMA_MIGRATION_EVIDENCE',
    );
  }
});

test('missing and future migration versions are distinct fail-closed blockers', async () => {
  const missing = adapterForReads([[validMigrationRows[0]]]).adapter;
  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), missing),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'MISSING_REQUIRED_SCHEMA_MIGRATION',
  );

  const unexpected = adapterForReads([[
    ...validMigrationRows,
    { version: 3, checksum: 'checksum-003', applied_at: '2026-09-03T00:00:00.000Z' },
  ]]).adapter;
  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), unexpected),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'UNEXPECTED_SCHEMA_MIGRATION',
  );
});

test('Google source failure prevents every YDB readiness read', async () => {
  const capture = { statements: [], transactions: 0 };
  const { adapter } = adapterForReads([validMigrationRows], capture);
  const source = {
    async readFullSnapshotObservation() {
      throw new Error('synthetic-google-failure');
    },
  };

  await assert.rejects(() => runScheduledSyncReadinessProbe(source, adapter), /synthetic-google-failure/);
  assert.equal(capture.statements.length, 0);
  assert.equal(capture.transactions, 0);
});

test('physical migration-002 column read failure propagates and never opens a transaction', async () => {
  const capture = { statements: [], transactions: 0 };
  const { adapter } = adapterForReads([
    validMigrationRows,
    new Error('synthetic-accounts-column-missing'),
  ], capture);

  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), adapter),
    /synthetic-accounts-column-missing/,
  );
  assert.equal(capture.statements.length, 2);
  assert.equal(capture.transactions, 0);
});

function runtimeForLifecycle(options = {}) {
  const state = { closed: 0, sourceCreated: 0, clientCreated: 0 };
  const rows = options.rows ?? [validMigrationRows, [], []];
  let readIndex = 0;
  const transport = {
    async executeRead() {
      const value = rows[readIndex] ?? [];
      readIndex += 1;
      if (value instanceof Error) throw value;
      return { rows: value };
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  };

  const runtime = {
    createSource() {
      state.sourceCreated += 1;
      if (options.sourceError) {
        return {
          async readFullSnapshotObservation() {
            throw options.sourceError;
          },
        };
      }
      return sourceThatSucceeds();
    },
    async createYdbClient() {
      state.clientCreated += 1;
      return {
        transport,
        async close() {
          state.closed += 1;
          if (options.closeError) throw options.closeError;
        },
      };
    },
  };
  return { runtime, state };
}

const syntheticConfig = Object.freeze({
  spreadsheetId: 'synthetic-spreadsheet-id',
  googleServiceAccountEmail: 'synthetic@example.invalid',
  googleServiceAccountPrivateKey: 'synthetic-multiline-secret\n',
  ydbConnectionString: 'grpcs://synthetic.example.invalid/local',
});

test('execution closes YDB client on success and reports close failure only after successful probe', async () => {
  const successful = runtimeForLifecycle();
  const result = await executeScheduledSyncReadinessProbe(syntheticConfig, successful.runtime);
  assert.equal(result.ydbSchema, 'READY');
  assert.equal(successful.state.closed, 1);

  const closeFailure = runtimeForLifecycle({ closeError: new Error('sensitive-close-detail') });
  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, closeFailure.runtime),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'YDB_CLIENT_CLOSE_FAILED'
      && !error.message.includes('sensitive-close-detail'),
  );
  assert.equal(closeFailure.state.closed, 1);
});

test('execution preserves primary readiness failure when close also fails', async () => {
  const primary = new Error('synthetic-primary-readiness-failure');
  const { runtime, state } = runtimeForLifecycle({
    sourceError: primary,
    closeError: new Error('synthetic-close-failure'),
  });

  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, runtime),
    (error) => error === primary,
  );
  assert.equal(state.closed, 1);
});
