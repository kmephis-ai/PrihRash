import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import {
  createYdbSchemaUpgrade003Migration,
  runYdbSchemaUpgrade003,
  YdbSchemaUpgrade003Error,
} from '../../dist/runtime/ydbSchemaUpgrade003.js';

const ROOT = resolve(import.meta.dirname, '../..');
const SQL_003 = await readFile(resolve(ROOT, 'db/migrations/003_initial_bootstrap_identity_manifest.sql'), 'utf8');
const MIGRATION = createYdbSchemaUpgrade003Migration(SQL_003);
const CLOCK = Object.freeze({ now: () => new Date('2026-09-11T21:00:00.000Z') });
const CHECKSUM_001 = 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855';
const CHECKSUM_002 = 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed';
const MANIFEST_PROBE = 'SELECT migration_run_id, source_snapshot_id, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, binding_count, bindings FROM initial_bootstrap_identity_manifests LIMIT 0';

function evidence(version) {
  const rows = [
    { version: 1n, checksum: CHECKSUM_001, applied_at: new Date('2026-09-11T19:00:00.000Z') },
    { version: 2n, checksum: CHECKSUM_002, applied_at: new Date('2026-09-11T19:01:00.000Z') },
  ];
  if (version === 3) rows.push({ version: 3n, checksum: MIGRATION.checksum, applied_at: new Date('2026-09-11T21:00:00.000Z') });
  return rows;
}

function missingTableError() {
  const error = new Error('synthetic missing table');
  error.code = StatusIds_StatusCode.SCHEME_ERROR;
  return error;
}

function clientFor({ initialVersion = 2, tableInitiallyPresent = false, failWrite = null } = {}) {
  const calls = [];
  let currentVersion = initialVersion;
  let tablePresent = tableInitiallyPresent;
  return {
    calls,
    client: Object.freeze({
      async execute(statement) {
        const text = statement.text.trim();
        calls.push(Object.freeze({ kind: statement.kind, text, parameters: statement.parameters }));
        if (text === 'SELECT 1 AS schema_upgrade_003_health') return { rows: [] };
        if (text.startsWith('SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations')) {
          return { rows: evidence(currentVersion) };
        }
        if (text === MANIFEST_PROBE) {
          if (!tablePresent) throw missingTableError();
          return { rows: [] };
        }
        if (statement.kind === 'WRITE' && text.startsWith('CREATE TABLE initial_bootstrap_identity_manifests')) {
          if (failWrite === 'migration') throw new Error('synthetic private provider detail');
          tablePresent = true;
          return { rows: [] };
        }
        if (statement.kind === 'WRITE' && text.includes('INSERT INTO schema_migrations')) {
          if (failWrite === 'evidence') throw new Error('synthetic private provider detail');
          assert.equal(statement.parameters.$version.value, 3n);
          assert.equal(statement.parameters.$checksum.value, MIGRATION.checksum);
          currentVersion = 3;
          return { rows: [] };
        }
        throw new Error(`unexpected statement: ${text}`);
      },
      async close() {},
    }),
  };
}

async function expectCode(code, work) {
  await assert.rejects(
    work,
    (error) => error instanceof YdbSchemaUpgrade003Error && error.code === code,
  );
}

test('migration 003 bundle is exact single-table DDL with checksum from canonical bytes', () => {
  assert.equal(MIGRATION.version, 3);
  assert.equal(MIGRATION.fileName, '003_initial_bootstrap_identity_manifest.sql');
  assert.equal(MIGRATION.checksum, `sha256:${createHash('sha256').update(SQL_003).digest('hex')}`);
  assert.match(MIGRATION.statement, /^CREATE TABLE initial_bootstrap_identity_manifests \(/u);
  assert.equal(MIGRATION.statement.includes('schema_migrations'), false);

  assert.throws(
    () => createYdbSchemaUpgrade003Migration(`${SQL_003}\nCREATE TABLE forbidden (id Uint64, PRIMARY KEY(id));`),
    (error) => error instanceof YdbSchemaUpgrade003Error && error.code === 'MIGRATION_BUNDLE_INVALID',
  );
  assert.throws(
    () => createYdbSchemaUpgrade003Migration(SQL_003.replace('binding_count Uint64', 'binding_count Int64')),
    (error) => error instanceof YdbSchemaUpgrade003Error && error.code === 'MIGRATION_BUNDLE_INVALID',
  );
});

test('exact 1+2 pre-state applies only migration 003, records ledger 3, and performs final physical read-back', async () => {
  const fixture = clientFor({ initialVersion: 2, tableInitiallyPresent: false });
  const result = await runYdbSchemaUpgrade003(fixture.client, MIGRATION, CLOCK);

  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3] });
  const writes = fixture.calls.filter(({ kind }) => kind === 'WRITE');
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /^CREATE TABLE initial_bootstrap_identity_manifests \(/u);
  assert.match(writes[1].text, /INSERT INTO schema_migrations/u);
  assert.equal(writes.some(({ text }) => /CREATE TABLE (transactions|accounts|categories)|ALTER TABLE/u.test(text)), false);
});

test('exact already-ready 1+2+3 state is a read-only no-op', async () => {
  const fixture = clientFor({ initialVersion: 3, tableInitiallyPresent: true });
  const result = await runYdbSchemaUpgrade003(fixture.client, MIGRATION, CLOCK);
  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2, 3] });
  assert.equal(fixture.calls.some(({ kind }) => kind === 'WRITE'), false);
});

test('physical table without ledger 3 and ledger 3 without physical table both fail closed', async () => {
  const prematurePhysical = clientFor({ initialVersion: 2, tableInitiallyPresent: true });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaUpgrade003(prematurePhysical.client, MIGRATION, CLOCK));
  assert.equal(prematurePhysical.calls.some(({ kind }) => kind === 'WRITE'), false);

  const missingPhysical = clientFor({ initialVersion: 3, tableInitiallyPresent: false });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaUpgrade003(missingPhysical.client, MIGRATION, CLOCK));
  assert.equal(missingPhysical.calls.some(({ kind }) => kind === 'WRITE'), false);
});

test('unexpected, missing, duplicate, or wrong-checksum ledger evidence blocks before DDL', async () => {
  const cases = [
    evidence(2).slice(0, 1),
    [...evidence(2), evidence(2)[1]],
    [...evidence(3), { version: 4n, checksum: 'future', applied_at: new Date() }],
    [{ ...evidence(2)[0], checksum: 'wrong' }, evidence(2)[1]],
  ];

  for (const rows of cases) {
    const calls = [];
    const client = Object.freeze({
      async execute(statement) {
        calls.push(statement);
        if (statement.text.trim() === 'SELECT 1 AS schema_upgrade_003_health') return { rows: [] };
        if (statement.text.includes('FROM schema_migrations')) return { rows };
        throw new Error('unexpected');
      },
      async close() {},
    });
    await expectCode('UNEXPECTED_MIGRATION_EVIDENCE', () => runYdbSchemaUpgrade003(client, MIGRATION, CLOCK));
    assert.equal(calls.some(({ kind }) => kind === 'WRITE'), false);
  }
});

test('apply and ledger failures are stage-specific and value-free', async () => {
  const apply = clientFor({ failWrite: 'migration' });
  await expectCode('MIGRATION_003_APPLY_FAILED', () => runYdbSchemaUpgrade003(apply.client, MIGRATION, CLOCK));

  const evidenceFailure = clientFor({ failWrite: 'evidence' });
  await expectCode('MIGRATION_003_EVIDENCE_FAILED', () => runYdbSchemaUpgrade003(evidenceFailure.client, MIGRATION, CLOCK));
});
