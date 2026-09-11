import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import {
  executeYandexSchemaUpgrade003Function,
} from '../../dist/runtime/yandexCloudSchemaUpgrade003Function.js';
import {
  createYdbSchemaUpgrade003Migration,
  YdbSchemaUpgrade003Error,
} from '../../dist/runtime/ydbSchemaUpgrade003.js';

const ROOT = resolve(import.meta.dirname, '../..');
const SQL_003 = await readFile(resolve(ROOT, 'db/migrations/003_initial_bootstrap_identity_manifest.sql'), 'utf8');
const MIGRATION = createYdbSchemaUpgrade003Migration(SQL_003);
const CHECKSUM_001 = 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855';
const CHECKSUM_002 = 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed';
const MANIFEST_PROBE = 'SELECT migration_run_id, source_snapshot_id, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, binding_count, bindings FROM initial_bootstrap_identity_manifests LIMIT 0';

function readyClient() {
  return Object.freeze({
    async execute(statement) {
      const text = statement.text.trim();
      if (text === 'SELECT 1 AS schema_upgrade_003_health') return { rows: [] };
      if (text.includes('FROM schema_migrations')) return { rows: [
        { version: 1n, checksum: CHECKSUM_001, applied_at: new Date('2026-09-11T19:00:00Z') },
        { version: 2n, checksum: CHECKSUM_002, applied_at: new Date('2026-09-11T19:01:00Z') },
        { version: 3n, checksum: MIGRATION.checksum, applied_at: new Date('2026-09-11T21:00:00Z') },
      ] };
      if (text === MANIFEST_PROBE) return { rows: [] };
      throw new Error('unexpected');
    },
    async close() {},
  });
}

function runtime(overrides = {}) {
  return Object.freeze({
    async loadMigration003() { return overrides.sql ?? SQL_003; },
    async createClient() { return overrides.client ?? readyClient(); },
    clock: Object.freeze({ now: () => new Date('2026-09-11T21:00:00Z') }),
  });
}

test('function wrapper loads only migration 003 and returns exact ready result', async () => {
  let createdWith = null;
  const result = await executeYandexSchemaUpgrade003Function(
    { PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://synthetic.example.invalid/local' },
    Object.freeze({
      ...runtime(),
      async createClient(value) {
        createdWith = value;
        return readyClient();
      },
    }),
  );
  assert.equal(createdWith, 'grpcs://synthetic.example.invalid/local');
  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3] });
});

test('function wrapper fails closed before provider access on missing config or invalid migration bytes', async () => {
  let clientCalls = 0;
  await assert.rejects(
    () => executeYandexSchemaUpgrade003Function({}, runtime()),
    (error) => error instanceof YdbSchemaUpgrade003Error && error.code === 'CONFIG_INVALID',
  );
  await assert.rejects(
    () => executeYandexSchemaUpgrade003Function(
      { PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://synthetic.example.invalid/local' },
      Object.freeze({
        ...runtime({ sql: 'CREATE TABLE wrong (id Uint64, PRIMARY KEY(id));' }),
        async createClient() { clientCalls += 1; return readyClient(); },
      }),
    ),
    (error) => error instanceof YdbSchemaUpgrade003Error && error.code === 'MIGRATION_BUNDLE_INVALID',
  );
  assert.equal(clientCalls, 0);
});

test('provider-native missing-table evidence never leaks through wrapper errors', async () => {
  const error = new Error('private provider detail');
  error.code = StatusIds_StatusCode.SCHEME_ERROR;
  const client = Object.freeze({
    async execute(statement) {
      if (statement.text.trim() === 'SELECT 1 AS schema_upgrade_003_health') return { rows: [] };
      if (statement.text.includes('FROM schema_migrations')) return { rows: [
        { version: 1n, checksum: CHECKSUM_001, applied_at: new Date() },
        { version: 2n, checksum: CHECKSUM_002, applied_at: new Date() },
        { version: 3n, checksum: MIGRATION.checksum, applied_at: new Date() },
      ] };
      throw error;
    },
    async close() {},
  });
  await assert.rejects(
    () => executeYandexSchemaUpgrade003Function(
      { PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://synthetic.example.invalid/local' },
      runtime({ client }),
    ),
    (caught) => caught instanceof YdbSchemaUpgrade003Error
      && caught.code === 'PARTIAL_SCHEMA_STATE'
      && !caught.message.includes('private provider detail'),
  );
});
