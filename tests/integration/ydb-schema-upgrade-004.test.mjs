import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import {
  createYdbSchemaUpgrade004Migration,
  runYdbSchemaUpgrade004,
  YdbSchemaUpgrade004Error,
} from '../../dist/runtime/ydbSchemaUpgrade004.js';

const ROOT = resolve(import.meta.dirname, '../..');
const SQL_004 = await readFile(resolve(ROOT, 'db/migrations/004_source_record_revision_run_index.sql'), 'utf8');
const MIGRATION = createYdbSchemaUpgrade004Migration(SQL_004);
const CLOCK = Object.freeze({ now: () => new Date('2026-09-22T09:30:00.000Z') });
const CHECKSUM_001 = 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855';
const CHECKSUM_002 = 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed';
const CHECKSUM_003 = 'sha256:da569cc8b8bb4772713baf60196a32741b5b704bdb979d1ee60fe40dccb4df06';
const INDEX_PROBE = 'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, CAST(row_digest AS Utf8) AS row_digest, change_class FROM source_record_revisions VIEW idx_source_record_revisions_run_revision LIMIT 0';

function evidence(version) {
  const rows = [
    { version: 1n, checksum: CHECKSUM_001, applied_at: new Date('2026-09-11T19:00:00.000Z') },
    { version: 2n, checksum: CHECKSUM_002, applied_at: new Date('2026-09-11T19:01:00.000Z') },
    { version: 3n, checksum: CHECKSUM_003, applied_at: new Date('2026-09-11T21:00:00.000Z') },
  ];
  if (version === 4) rows.push({ version: 4n, checksum: MIGRATION.checksum, applied_at: new Date('2026-09-22T09:30:00.000Z') });
  return rows;
}

function missingIndexError() {
  const error = new Error('synthetic missing index');
  error.code = StatusIds_StatusCode.SCHEME_ERROR;
  return error;
}

function clientFor({ initialVersion = 3, indexInitiallyPresent = false, failWrite = null } = {}) {
  const calls = [];
  let currentVersion = initialVersion;
  let indexPresent = indexInitiallyPresent;
  return {
    calls,
    client: Object.freeze({
      async execute(statement) {
        const text = statement.text.trim();
        calls.push(Object.freeze({ kind: statement.kind, text, parameters: statement.parameters }));
        if (text === 'SELECT 1 AS schema_upgrade_004_health') return { rows: [] };
        if (text.startsWith('SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations')) {
          return { rows: evidence(currentVersion) };
        }
        if (text === INDEX_PROBE) {
          if (!indexPresent) throw missingIndexError();
          return { rows: [] };
        }
        if (statement.kind === 'WRITE' && text.startsWith('ALTER TABLE source_record_revisions')) {
          if (failWrite === 'migration') throw new Error('synthetic private provider detail');
          indexPresent = true;
          return { rows: [] };
        }
        if (statement.kind === 'WRITE' && text.includes('INSERT INTO schema_migrations')) {
          if (failWrite === 'evidence') throw new Error('synthetic private provider detail');
          assert.equal(statement.parameters.$version.value, 4n);
          assert.equal(statement.parameters.$checksum.value, MIGRATION.checksum);
          currentVersion = 4;
          return { rows: [] };
        }
        throw new Error(`unexpected statement: ${text}`);
      },
      async close() {},
    }),
  };
}

async function expectCode(code, work) {
  await assert.rejects(work, (error) => error instanceof YdbSchemaUpgrade004Error && error.code === code);
}

test('migration 004 is exact single GLOBAL SYNC index DDL with canonical checksum', () => {
  assert.equal(MIGRATION.version, 4);
  assert.equal(MIGRATION.fileName, '004_source_record_revision_run_index.sql');
  assert.equal(MIGRATION.checksum, `sha256:${createHash('sha256').update(SQL_004).digest('hex')}`);
  assert.match(MIGRATION.statement, /^ALTER TABLE source_record_revisions/u);
  assert.match(MIGRATION.statement, /ADD INDEX idx_source_record_revisions_run_revision GLOBAL SYNC/u);
  assert.match(MIGRATION.statement, /ON \(migration_run_id, revision\)/u);
  assert.match(MIGRATION.statement, /COVER \(observed_at, row_hint, row_digest, change_class\)$/u);
  assert.doesNotMatch(MIGRATION.statement, /ASYNC|IF NOT EXISTS|\bDROP\b|\bCREATE TABLE\b/u);

  assert.throws(
    () => createYdbSchemaUpgrade004Migration(SQL_004.replace('GLOBAL SYNC', 'GLOBAL ASYNC')),
    (error) => error instanceof YdbSchemaUpgrade004Error && error.code === 'MIGRATION_BUNDLE_INVALID',
  );
});

test('exact 1..3 pre-state applies only migration 004, records ledger 4, and proves physical VIEW read-back', async () => {
  const fixture = clientFor();
  const result = await runYdbSchemaUpgrade004(fixture.client, MIGRATION, CLOCK);

  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3, 4] });
  const writes = fixture.calls.filter(({ kind }) => kind === 'WRITE');
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /^ALTER TABLE source_record_revisions/u);
  assert.match(writes[0].text, /GLOBAL SYNC/u);
  assert.match(writes[1].text, /INSERT INTO schema_migrations/u);
  assert.equal(writes.some(({ text }) => /CREATE TABLE|DROP TABLE|UPDATE |DELETE FROM/u.test(text)), false);
  assert.equal(fixture.calls.some(({ text }) => text === INDEX_PROBE), true);
});

test('exact already-ready 1..4 state is a read-only no-op', async () => {
  const fixture = clientFor({ initialVersion: 4, indexInitiallyPresent: true });
  const result = await runYdbSchemaUpgrade004(fixture.client, MIGRATION, CLOCK);
  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3, 4] });
  assert.equal(fixture.calls.some(({ kind }) => kind === 'WRITE'), false);
});

test('index without ledger 4 and ledger 4 without physical index both fail closed', async () => {
  const prematurePhysical = clientFor({ initialVersion: 3, indexInitiallyPresent: true });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaUpgrade004(prematurePhysical.client, MIGRATION, CLOCK));
  assert.equal(prematurePhysical.calls.some(({ kind }) => kind === 'WRITE'), false);

  const missingPhysical = clientFor({ initialVersion: 4, indexInitiallyPresent: false });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaUpgrade004(missingPhysical.client, MIGRATION, CLOCK));
  assert.equal(missingPhysical.calls.some(({ kind }) => kind === 'WRITE'), false);
});

test('unexpected, missing, duplicate, or wrong-checksum ledger evidence blocks before DDL', async () => {
  const cases = [
    evidence(3).slice(0, 2),
    [...evidence(3), evidence(3)[2]],
    [...evidence(4), { version: 5n, checksum: 'future', applied_at: new Date() }],
    [{ ...evidence(3)[0], checksum: 'wrong' }, evidence(3)[1], evidence(3)[2]],
  ];

  for (const rows of cases) {
    const calls = [];
    const client = Object.freeze({
      async execute(statement) {
        calls.push(statement);
        if (statement.text.trim() === 'SELECT 1 AS schema_upgrade_004_health') return { rows: [] };
        if (statement.text.includes('FROM schema_migrations')) return { rows };
        throw new Error('unexpected');
      },
      async close() {},
    });
    await expectCode('UNEXPECTED_MIGRATION_EVIDENCE', () => runYdbSchemaUpgrade004(client, MIGRATION, CLOCK));
    assert.equal(calls.some(({ kind }) => kind === 'WRITE'), false);
  }
});

test('apply and ledger failures are stage-specific and value-free', async () => {
  await expectCode('MIGRATION_004_APPLY_FAILED', () => runYdbSchemaUpgrade004(clientFor({ failWrite: 'migration' }).client, MIGRATION, CLOCK));
  await expectCode('MIGRATION_004_EVIDENCE_FAILED', () => runYdbSchemaUpgrade004(clientFor({ failWrite: 'evidence' }).client, MIGRATION, CLOCK));
});
