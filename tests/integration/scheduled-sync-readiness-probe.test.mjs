import assert from 'node:assert/strict';
import test from 'node:test';

import { FullSourceSnapshotError } from '../../dist/integration/google/fullSourceSnapshot.js';
import { GoogleSheetsFullSnapshotReaderError } from '../../dist/integration/google/googleSheetsFullSnapshotReader.js';
import { GoogleServiceAccountTokenProviderError } from '../../dist/integration/google/googleServiceAccountTokenProvider.js';
import { SourceValueCodecError } from '../../dist/integration/google/sourceValueCodec.js';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION,
  ScheduledSyncReadinessError,
  executeScheduledSyncReadinessProbe,
  runScheduledSyncReadinessProbe,
  runScheduledSyncReadinessProbeFromEnvironment,
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
  Object.freeze({ version: 1n, checksum: 'checksum-001', applied_at: new Date('2026-09-01T00:00:00.000Z') }),
  Object.freeze({ version: 2n, checksum: 'checksum-002', applied_at: new Date('2026-09-02T00:00:00.000Z') }),
  Object.freeze({ version: 3n, checksum: 'checksum-003', applied_at: new Date('2026-09-03T00:00:00.000Z') }),
]);

test('readiness probe performs one Google read and six read-only YDB checks', async () => {
  const sourceCounter = { calls: 0 };
  const { adapter, capture } = adapterForReads([[], [], validMigrationRows, [], [], []]);

  const result = await runScheduledSyncReadinessProbe(sourceThatSucceeds(sourceCounter), adapter);

  assert.deepEqual(result, {
    googleSource: 'READY',
    ydbSchema: 'READY',
    requiredMigrationVersion: REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION,
  });
  assert.equal(sourceCounter.calls, 1);
  assert.equal(capture.transactions, 0);
  assert.equal(capture.statements.length, 6);
  assert.equal(capture.statements[0].kind, 'READ');
  assert.equal(capture.statements[0].text, 'SELECT 1 AS readiness_probe');
  assert.equal(capture.statements[1].text, 'SELECT version, checksum, applied_at FROM schema_migrations LIMIT 0');
  assert.equal(capture.statements[2].text, 'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC');
  assert.equal(capture.statements[3].text, 'SELECT normalized_source_label FROM accounts LIMIT 0');
  assert.equal(capture.statements[4].text, 'SELECT normalized_source_label FROM categories LIMIT 0');
  assert.equal(capture.statements[5].text, 'SELECT migration_run_id, source_snapshot_id, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, binding_count, bindings FROM initial_bootstrap_identity_manifests LIMIT 0');
  assert.deepEqual(Object.keys(result).sort(), ['googleSource', 'requiredMigrationVersion', 'ydbSchema']);
});

test('schema migration evidence fails closed for malformed rows', async () => {
  const malformedRows = [
    [{ version: -1, checksum: 'x', applied_at: '2026-09-01T00:00:00.000Z' }],
    [{ version: 1, checksum: '', applied_at: '2026-09-01T00:00:00.000Z' }, validMigrationRows[1], validMigrationRows[2]],
    [{ version: 1, checksum: ' x ', applied_at: '2026-09-01T00:00:00.000Z' }, validMigrationRows[1], validMigrationRows[2]],
    [{ version: 1, checksum: 'x', applied_at: 'invalid' }, validMigrationRows[1], validMigrationRows[2]],
    [validMigrationRows[0], { version: 2, checksum: 'x', applied_at: null }, validMigrationRows[2]],
    [validMigrationRows[0], validMigrationRows[0], validMigrationRows[1], validMigrationRows[2]],
  ];

  for (const rows of malformedRows) {
    const { adapter } = adapterForReads([[], [], rows]);
    await assert.rejects(
      () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), adapter),
      (error) => error instanceof ScheduledSyncReadinessError
        && error.code === 'MALFORMED_SCHEMA_MIGRATION_EVIDENCE',
    );
  }
});

test('missing and future migration versions are distinct fail-closed blockers', async () => {
  const missing = adapterForReads([[], [], [validMigrationRows[0], validMigrationRows[1]]]).adapter;
  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), missing),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'MISSING_REQUIRED_SCHEMA_MIGRATION',
  );

  const unexpected = adapterForReads([[], [], [
    ...validMigrationRows,
    { version: 4, checksum: 'checksum-004', applied_at: '2026-09-04T00:00:00.000Z' },
  ]]).adapter;
  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), unexpected),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'UNEXPECTED_SCHEMA_MIGRATION',
  );
});

test('typed Google failures are reduced to value-free readiness stages', async () => {
  const cases = [
    [new GoogleServiceAccountTokenProviderError('INVALID_SERVICE_ACCOUNT_EMAIL'), 'GOOGLE_CREDENTIALS_INVALID'],
    [new GoogleServiceAccountTokenProviderError('INVALID_SERVICE_ACCOUNT_PRIVATE_KEY'), 'GOOGLE_CREDENTIALS_INVALID'],
    [new GoogleServiceAccountTokenProviderError('TOKEN_ACQUISITION_FAILED'), 'GOOGLE_TOKEN_ACQUISITION_FAILED'],
    [new GoogleServiceAccountTokenProviderError('INVALID_ACCESS_TOKEN'), 'GOOGLE_TOKEN_ACQUISITION_FAILED'],
    [new GoogleSheetsFullSnapshotReaderError('INVALID_SPREADSHEET_ID'), 'GOOGLE_SPREADSHEET_ID_INVALID'],
    [new GoogleSheetsFullSnapshotReaderError('INVALID_ACCESS_TOKEN'), 'GOOGLE_TOKEN_ACQUISITION_FAILED'],
    [new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_HTTP_ERROR', 403), 'GOOGLE_SHEETS_ACCESS_FAILED'],
    [new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID'), 'GOOGLE_SHEETS_RESPONSE_INVALID'],
    [new GoogleSheetsFullSnapshotReaderError('SOURCE_METADATA_MISMATCH'), 'GOOGLE_SOURCE_METADATA_MISMATCH'],
    [new GoogleSheetsFullSnapshotReaderError('SOURCE_SHEET_MISSING'), 'GOOGLE_SOURCE_SHEET_MISSING'],
    [new FullSourceSnapshotError('SOURCE_SCHEMA_MISMATCH'), 'GOOGLE_SOURCE_SCHEMA_MISMATCH'],
    [new FullSourceSnapshotError('SOURCE_ROW_WIDTH_MISMATCH'), 'GOOGLE_SOURCE_SCHEMA_MISMATCH'],
    [new SourceValueCodecError('FORMULA_SOURCE_CELL_NOT_ALLOWED'), 'GOOGLE_SOURCE_VALUE_UNSUPPORTED'],
    [new SourceValueCodecError('UNSUPPORTED_SOURCE_CELL_VALUE'), 'GOOGLE_SOURCE_VALUE_UNSUPPORTED'],
  ];

  for (const [sourceError, expectedCode] of cases) {
    const capture = { statements: [], transactions: 0 };
    const { adapter } = adapterForReads([validMigrationRows], capture);
    const source = {
      async readFullSnapshotObservation() {
        throw sourceError;
      },
    };

    await assert.rejects(
      () => runScheduledSyncReadinessProbe(source, adapter),
      (error) => error instanceof ScheduledSyncReadinessError
        && error.code === expectedCode
        && error.message === expectedCode
        && !Object.hasOwn(error, 'cause'),
    );
    assert.equal(capture.statements.length, 0);
    assert.equal(capture.transactions, 0);
  }
});

test('Google source provider failure is sanitized and prevents every YDB readiness read', async () => {
  const capture = { statements: [], transactions: 0 };
  const { adapter } = adapterForReads([validMigrationRows], capture);
  const privateDetail = 'spreadsheet-private-id secret-google-detail';
  const source = {
    async readFullSnapshotObservation() {
      throw new Error(privateDetail);
    },
  };

  await assert.rejects(
    () => runScheduledSyncReadinessProbe(source, adapter),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'GOOGLE_SOURCE_READ_FAILED'
      && error.message === 'GOOGLE_SOURCE_READ_FAILED'
      && !JSON.stringify(error).includes(privateDetail)
      && !Object.hasOwn(error, 'cause'),
  );
  assert.equal(capture.statements.length, 0);
  assert.equal(capture.transactions, 0);
});

test('YDB readiness read failures are stage-specific, sanitized, and never open a transaction', async () => {
  const cases = [
    {
      reads: [new Error('private-ydb-endpoint synthetic-query-health-failure')],
      expectedCode: 'YDB_QUERY_HEALTH_READ_FAILED',
      expectedStatements: 1,
    },
    {
      reads: [[], new Error('private-ydb-endpoint synthetic-migration-schema-missing')],
      expectedCode: 'YDB_MIGRATION_SCHEMA_READ_FAILED',
      expectedStatements: 3,
    },
    {
      reads: [[], [], new Error('private-ydb-endpoint synthetic-migration-evidence-failure')],
      expectedCode: 'YDB_MIGRATION_EVIDENCE_READ_FAILED',
      expectedStatements: 3,
    },
    {
      reads: [[], [], validMigrationRows, new Error('private-ydb-endpoint synthetic-accounts-column-missing')],
      expectedCode: 'YDB_ACCOUNTS_SCHEMA_READ_FAILED',
      expectedStatements: 4,
    },
    {
      reads: [[], [], validMigrationRows, [], new Error('private-ydb-endpoint synthetic-categories-column-missing')],
      expectedCode: 'YDB_CATEGORIES_SCHEMA_READ_FAILED',
      expectedStatements: 5,
    },
    {
      reads: [[], [], validMigrationRows, [], [], new Error('private-ydb-endpoint synthetic-manifest-table-missing')],
      expectedCode: 'YDB_INITIAL_BOOTSTRAP_IDENTITY_MANIFEST_SCHEMA_READ_FAILED',
      expectedStatements: 6,
    },
  ];

  for (const { reads, expectedCode, expectedStatements } of cases) {
    const capture = { statements: [], transactions: 0 };
    const { adapter } = adapterForReads(reads, capture);

    await assert.rejects(
      () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), adapter),
      (error) => error instanceof ScheduledSyncReadinessError
        && error.code === expectedCode
        && error.message === expectedCode
        && !JSON.stringify(error).includes('private-ydb-endpoint')
        && !Object.hasOwn(error, 'cause'),
    );
    assert.equal(capture.statements.length, expectedStatements);
    assert.equal(capture.transactions, 0);
  }
});

function runtimeForLifecycle(options = {}) {
  const state = { closed: 0, sourceCreated: 0, clientCreated: 0 };
  const rows = options.rows ?? [[], [], validMigrationRows, [], [], []];
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
      if (options.createSourceError) throw options.createSourceError;
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
      if (options.clientCreateError) throw options.clientCreateError;
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

test('execution sanitizes primary readiness failure when close also fails', async () => {
  const primary = new Error('private-primary-readiness-failure');
  const { runtime, state } = runtimeForLifecycle({
    sourceError: primary,
    closeError: new Error('synthetic-close-failure'),
  });

  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, runtime),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'GOOGLE_SOURCE_READ_FAILED'
      && !error.message.includes('private-primary-readiness-failure')
      && !Object.hasOwn(error, 'cause'),
  );
  assert.equal(state.closed, 1);
});

test('execution sanitizes source construction and YDB client creation failures by stage', async () => {
  const credentialFailure = runtimeForLifecycle({
    createSourceError: new GoogleServiceAccountTokenProviderError('INVALID_SERVICE_ACCOUNT_EMAIL'),
  });
  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, credentialFailure.runtime),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'GOOGLE_CREDENTIALS_INVALID'
      && !Object.hasOwn(error, 'cause'),
  );
  assert.equal(credentialFailure.state.clientCreated, 0);
  assert.equal(credentialFailure.state.closed, 0);

  const sourceFailure = runtimeForLifecycle({
    createSourceError: new Error('private-google-service-account-detail'),
  });
  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, sourceFailure.runtime),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'GOOGLE_SOURCE_READ_FAILED'
      && !error.message.includes('private-google-service-account-detail')
      && !Object.hasOwn(error, 'cause'),
  );
  assert.equal(sourceFailure.state.clientCreated, 0);
  assert.equal(sourceFailure.state.closed, 0);

  const clientFailure = runtimeForLifecycle({
    clientCreateError: new Error('grpcs://private-ydb-id.example.invalid/database-private-id'),
  });
  await assert.rejects(
    () => executeScheduledSyncReadinessProbe(syntheticConfig, clientFailure.runtime),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'YDB_CLIENT_CREATE_FAILED'
      && !error.message.includes('private-ydb-id')
      && !Object.hasOwn(error, 'cause'),
  );
  assert.equal(clientFailure.state.clientCreated, 1);
  assert.equal(clientFailure.state.closed, 0);
});

test('environment config failure becomes one value-free readiness code before provider access', async () => {
  await assert.rejects(
    () => runScheduledSyncReadinessProbeFromEnvironment(Object.freeze({
      PRIHRASH_GOOGLE_SPREADSHEET_ID: 'private-looking-id',
    })),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'CONFIG_INVALID'
      && error.message === 'CONFIG_INVALID'
      && !error.message.includes('private-looking-id')
      && !Object.hasOwn(error, 'cause'),
  );
});
