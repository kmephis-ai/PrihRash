import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import {
  createYdbSchemaBootstrapMigrations,
  runYdbSchemaBootstrap,
  YdbSchemaBootstrapError,
} from '../../dist/runtime/ydbSchemaBootstrap.js';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = createYdbSchemaBootstrapMigrations({
  migration001Sql: await readFile(resolve(ROOT, 'db/migrations/001_initial.sql'), 'utf8'),
  migration002Sql: await readFile(resolve(ROOT, 'db/migrations/002_reference_source_labels.sql'), 'utf8'),
});
const CLOCK = Object.freeze({ now: () => new Date('2026-09-11T10:50:00.000Z') });
const BASELINE_PROBES = new Set([
  'SELECT id FROM transactions LIMIT 0',
  'SELECT id FROM accounts LIMIT 0',
  'SELECT id FROM categories LIMIT 0',
  'SELECT id FROM family_members LIMIT 0',
  'SELECT id, timezone, target_close_day, version FROM finance_profiles LIMIT 0',
  'SELECT id FROM source_records LIMIT 0',
  'SELECT source_record_id, revision FROM source_record_revisions LIMIT 0',
  'SELECT id FROM source_snapshots LIMIT 0',
  'SELECT id FROM migration_runs LIMIT 0',
]);

function genericMissingColumnError({ issueCode = 1030, member = 'normalized_source_label' } = {}) {
  const error = new Error('synthetic-provider-detail');
  error.code = StatusIds_StatusCode.GENERIC_ERROR;
  error.issues = [{
    issueCode,
    message: 'Type annotation',
    issues: [{
      issueCode: 0,
      message: 'At function: Member',
      issues: [{ issueCode: 0, message: `Member not found: ${member}`, issues: [] }],
    }],
  }];
  return error;
}

function preMigration002Client(columnErrorFactory) {
  const calls = [];
  return {
    calls,
    client: Object.freeze({
      async execute(statement) {
        const text = statement.text.trim();
        calls.push(Object.freeze({ kind: statement.kind, text }));

        if (statement.kind === 'WRITE') throw new Error('synthetic-write-stop');
        if (text === 'SELECT 1 AS schema_bootstrap_health') return { rows: [] };
        if (text.startsWith('SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations')) {
          return {
            rows: [{
              version: 1n,
              checksum: MIGRATIONS[0].checksum,
              applied_at: new Date('2026-09-11T10:40:00.000Z'),
            }],
          };
        }
        if (BASELINE_PROBES.has(text)) return { rows: [] };
        if (/^SELECT normalized_source_label FROM (accounts|categories) LIMIT 0$/u.test(text)) {
          throw columnErrorFactory();
        }
        throw new Error('unexpected-read');
      },
      async close() {},
    }),
  };
}

async function expectCode(code, work) {
  await assert.rejects(
    work,
    (error) => error instanceof YdbSchemaBootstrapError && error.code === code,
  );
}

test('preflight accepts the exact YDB GENERIC_ERROR shape for the expected missing migration-002 column', async () => {
  const fixture = preMigration002Client(() => genericMissingColumnError());

  await expectCode(
    'MIGRATION_002_APPLY_FAILED',
    () => runYdbSchemaBootstrap(fixture.client, MIGRATIONS, CLOCK),
  );

  const writes = fixture.calls.filter(({ kind }) => kind === 'WRITE');
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /(?:^|\n)ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8$/u);
});

test('preflight keeps a generic type-annotation error for another member fail-closed', async () => {
  const fixture = preMigration002Client(() => genericMissingColumnError({ member: 'different_column' }));

  await expectCode(
    'YDB_PREFLIGHT_READ_FAILED',
    () => runYdbSchemaBootstrap(fixture.client, MIGRATIONS, CLOCK),
  );

  assert.equal(fixture.calls.some(({ kind }) => kind === 'WRITE'), false);
});

test('preflight requires YDB type-annotation issue code 1030 even when the nested member message matches', async () => {
  const fixture = preMigration002Client(() => genericMissingColumnError({ issueCode: 999 }));

  await expectCode(
    'YDB_PREFLIGHT_READ_FAILED',
    () => runYdbSchemaBootstrap(fixture.client, MIGRATIONS, CLOCK),
  );

  assert.equal(fixture.calls.some(({ kind }) => kind === 'WRITE'), false);
});
