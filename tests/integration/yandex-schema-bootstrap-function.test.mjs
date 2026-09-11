import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import {
  executeYandexSchemaBootstrapFunction,
} from '../../dist/runtime/yandexCloudSchemaBootstrapFunction.js';
import { YdbSchemaBootstrapError } from '../../dist/runtime/ydbSchemaBootstrap.js';

const ROOT = resolve(import.meta.dirname, '../..');
const SQL_001 = await readFile(resolve(ROOT, 'db/migrations/001_initial.sql'), 'utf8');
const SQL_002 = await readFile(resolve(ROOT, 'db/migrations/002_reference_source_labels.sql'), 'utf8');
const CONNECTION = 'grpcs://synthetic.invalid:2135/?database=/synthetic';

function providerMissing() {
  const error = new Error('private');
  error.code = StatusIds_StatusCode.SCHEME_ERROR;
  return error;
}

function minimalClient({ closeError = null, healthError = null } = {}) {
  let closed = false;
  const tables = new Set();
  const columns = new Set();
  const ledger = [];
  let profileReady = false;
  return {
    get closed() { return closed; },
    client: {
      async execute(statement) {
        const text = statement.text.trim();
        if (statement.kind === 'READ') {
          if (text === 'SELECT 1 AS schema_bootstrap_health') {
            if (healthError !== null) throw healthError;
            return { rows: [] };
          }
          if (text.startsWith('SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations')) {
            if (!tables.has('schema_migrations')) throw providerMissing();
            return { rows: ledger.map((row) => ({ ...row })) };
          }
          if (text.includes('FROM finance_profiles') && text.includes('WHERE id = Uuid(')) {
            return { rows: profileReady ? [{ timezone: 'Europe/Moscow', target_close_day: 14, version: 1n }] : [] };
          }
          const normalized = /^SELECT normalized_source_label FROM (accounts|categories) LIMIT 0$/u.exec(text);
          if (normalized !== null) {
            const table = normalized[1];
            if (!tables.has(table) || !columns.has(table)) throw providerMissing();
            return { rows: [] };
          }
          const table = /\bFROM\s+([a-z_]+)\b/u.exec(text)?.[1];
          if (table !== undefined) {
            if (!tables.has(table)) throw providerMissing();
            return { rows: [] };
          }
        } else {
          const executable = text.replace(/^(?:--[^\n]*(?:\n|$)\s*)+/u, '').trim();
          const create = /^CREATE TABLE ([a-z_]+)\s*\(/u.exec(executable)?.[1];
          if (create !== undefined) {
            tables.add(create);
            return { rows: [] };
          }
          if (executable.startsWith('UPSERT INTO finance_profiles')) {
            profileReady = true;
            return { rows: [] };
          }
          const alter = /^ALTER TABLE (accounts|categories) ADD COLUMN normalized_source_label Utf8$/u.exec(executable)?.[1];
          if (alter !== undefined) {
            columns.add(alter);
            return { rows: [] };
          }
          if (executable.includes('INSERT INTO schema_migrations')) {
            ledger.push({
              version: statement.parameters.$version.value,
              checksum: statement.parameters.$checksum.value,
              applied_at: statement.parameters.$applied_at.value,
            });
            return { rows: [] };
          }
        }
        throw new Error('unexpected statement');
      },
      async close() {
        closed = true;
        if (closeError !== null) throw closeError;
      },
    },
  };
}

function runtime(clientFactory, overrides = {}) {
  return {
    async loadMigration001() { return SQL_001; },
    async loadMigration002() { return SQL_002; },
    createClient: clientFactory,
    clock: { now: () => new Date('2026-09-11T10:50:00.000Z') },
    ...overrides,
  };
}

async function expectCode(code, work) {
  await assert.rejects(
    work,
    (error) => error instanceof YdbSchemaBootstrapError && error.code === code,
  );
}

test('schema bootstrap function validates config, loads only 001/002 and closes client on success', async () => {
  const fake = minimalClient();
  const result = await executeYandexSchemaBootstrapFunction(
    { PRIHRASH_YDB_CONNECTION_STRING: CONNECTION },
    runtime(async (value) => {
      assert.equal(value, CONNECTION);
      return fake.client;
    }),
  );

  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2] });
  assert.equal(fake.closed, true);
});

test('missing connection string fails before migration load or provider creation', async () => {
  let touched = false;
  const rt = runtime(async () => {
    touched = true;
    throw new Error('should not run');
  }, {
    async loadMigration001() { touched = true; return SQL_001; },
  });
  await expectCode('CONFIG_INVALID', () => executeYandexSchemaBootstrapFunction({}, rt));
  assert.equal(touched, false);
});

test('migration package read/shape failure is value-free and provider is never created', async () => {
  let created = false;
  const rt = runtime(async () => {
    created = true;
    throw new Error('should not run');
  }, {
    async loadMigration002() { return `${SQL_002}\nCREATE TABLE forbidden (id Uint64, PRIMARY KEY(id));`; },
  });
  await expectCode('MIGRATION_BUNDLE_INVALID', () => executeYandexSchemaBootstrapFunction(
    { PRIHRASH_YDB_CONNECTION_STRING: CONNECTION },
    rt,
  ));
  assert.equal(created, false);
});

test('provider creation failure is classified and no private cause is surfaced', async () => {
  await expectCode('YDB_CLIENT_CREATE_FAILED', () => executeYandexSchemaBootstrapFunction(
    { PRIHRASH_YDB_CONNECTION_STRING: CONNECTION },
    runtime(async () => { throw new Error('private-provider-create'); }),
  ));
});

test('close failure becomes terminal only when no primary bootstrap error exists', async () => {
  const closeOnly = minimalClient({ closeError: new Error('private-close') });
  await expectCode('YDB_CLIENT_CLOSE_FAILED', () => executeYandexSchemaBootstrapFunction(
    { PRIHRASH_YDB_CONNECTION_STRING: CONNECTION },
    runtime(async () => closeOnly.client),
  ));

  const primary = minimalClient({
    closeError: new Error('private-close'),
    healthError: new Error('private-health'),
  });
  await expectCode('YDB_HEALTH_READ_FAILED', () => executeYandexSchemaBootstrapFunction(
    { PRIHRASH_YDB_CONNECTION_STRING: CONNECTION },
    runtime(async () => primary.client),
  ));
});
