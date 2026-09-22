import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import { executeYandexSchemaUpgrade004Function } from '../../dist/runtime/yandexCloudSchemaUpgrade004Function.js';
import { createYdbSchemaUpgrade004Migration, YdbSchemaUpgrade004Error } from '../../dist/runtime/ydbSchemaUpgrade004.js';

const ROOT = resolve(import.meta.dirname, '../..');
const SQL_004 = await readFile(resolve(ROOT, 'db/migrations/004_source_record_revision_run_index.sql'), 'utf8');
const MIGRATION = createYdbSchemaUpgrade004Migration(SQL_004);
const CHECKSUM_001 = 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855';
const CHECKSUM_002 = 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed';
const CHECKSUM_003 = 'sha256:da569cc8b8bb4772713baf60196a32741b5b704bdb979d1ee60fe40dccb4df06';
const INDEX_PROBE = 'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, CAST(row_digest AS Utf8) AS row_digest, change_class FROM source_record_revisions VIEW idx_source_record_revisions_run_revision LIMIT 0';

function readyClient() {
  return Object.freeze({
    async execute(statement) {
      const text = statement.text.trim();
      if (text === 'SELECT 1 AS schema_upgrade_004_health') return { rows: [] };
      if (text.includes('FROM schema_migrations')) return { rows: [
        { version: 1n, checksum: CHECKSUM_001, applied_at: new Date('2026-09-11T19:00:00Z') },
        { version: 2n, checksum: CHECKSUM_002, applied_at: new Date('2026-09-11T19:01:00Z') },
        { version: 3n, checksum: CHECKSUM_003, applied_at: new Date('2026-09-11T21:00:00Z') },
        { version: 4n, checksum: MIGRATION.checksum, applied_at: new Date('2026-09-22T09:30:00Z') },
      ] };
      if (text === INDEX_PROBE) return { rows: [] };
      throw new Error('unexpected');
    },
    async close() {},
  });
}

function runtime(overrides = {}) {
  return Object.freeze({
    async loadMigration004() { return overrides.sql ?? SQL_004; },
    async createClient() { return overrides.client ?? readyClient(); },
    clock: Object.freeze({ now: () => new Date('2026-09-22T09:30:00Z') }),
  });
}

test('function wrapper loads only migration 004 and returns exact ready result', async () => {
  let createdWith = null;
  const result = await executeYandexSchemaUpgrade004Function(
    { PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://synthetic.example.invalid/local' },
    Object.freeze({
      ...runtime(),
      async createClient(value) { createdWith = value; return readyClient(); },
    }),
  );
  assert.equal(createdWith, 'grpcs://synthetic.example.invalid/local');
  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3, 4] });
});

test('function wrapper fails closed before provider access on missing config or invalid migration bytes', async () => {
  let clientCalls = 0;
  await assert.rejects(
    () => executeYandexSchemaUpgrade004Function({}, runtime()),
    (error) => error instanceof YdbSchemaUpgrade004Error && error.code === 'CONFIG_INVALID',
  );
  await assert.rejects(
    () => executeYandexSchemaUpgrade004Function(
      { PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://synthetic.example.invalid/local' },
      Object.freeze({
        ...runtime({ sql: 'ALTER TABLE wrong ADD INDEX bad GLOBAL ASYNC ON (id);' }),
        async createClient() { clientCalls += 1; return readyClient(); },
      }),
    ),
    (error) => error instanceof YdbSchemaUpgrade004Error && error.code === 'MIGRATION_BUNDLE_INVALID',
  );
  assert.equal(clientCalls, 0);
});

test('provider-native missing-index evidence is reduced to a value-free partial-state code', async () => {
  const error = new Error('private provider detail');
  error.code = StatusIds_StatusCode.SCHEME_ERROR;
  const client = Object.freeze({
    async execute(statement) {
      const text = statement.text.trim();
      if (text === 'SELECT 1 AS schema_upgrade_004_health') return { rows: [] };
      if (text.includes('FROM schema_migrations')) return { rows: [
        { version: 1n, checksum: CHECKSUM_001, applied_at: new Date() },
        { version: 2n, checksum: CHECKSUM_002, applied_at: new Date() },
        { version: 3n, checksum: CHECKSUM_003, applied_at: new Date() },
        { version: 4n, checksum: MIGRATION.checksum, applied_at: new Date() },
      ] };
      throw error;
    },
    async close() {},
  });
  await assert.rejects(
    () => executeYandexSchemaUpgrade004Function(
      { PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://synthetic.example.invalid/local' },
      runtime({ client }),
    ),
    (caught) => caught instanceof YdbSchemaUpgrade004Error
      && caught.code === 'PARTIAL_SCHEMA_STATE'
      && !caught.message.includes('private provider detail'),
  );
});
