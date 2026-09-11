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
const MIGRATION_001 = await readFile(resolve(ROOT, 'db/migrations/001_initial.sql'), 'utf8');
const MIGRATION_002 = await readFile(resolve(ROOT, 'db/migrations/002_reference_source_labels.sql'), 'utf8');
const MIGRATION_003 = await readFile(resolve(ROOT, 'db/migrations/003_initial_bootstrap_identity_manifest.sql'), 'utf8');
const MIGRATIONS = createYdbSchemaBootstrapMigrations({
  migration001Sql: MIGRATION_001,
  migration002Sql: MIGRATION_002,
});
const TABLES_001 = Object.freeze([
  'transactions',
  'accounts',
  'categories',
  'family_members',
  'finance_profiles',
  'source_records',
  'source_record_revisions',
  'source_snapshots',
  'migration_runs',
  'schema_migrations',
]);
const CLOCK = Object.freeze({ now: () => new Date('2026-09-11T10:50:00.000Z') });

function providerError(status) {
  const error = new Error('private-provider-detail');
  error.code = status;
  return error;
}

function parameterValue(statement, name) {
  return statement.parameters[name]?.value;
}

function fakeClient(options = {}) {
  const tables = new Set(options.tables ?? []);
  const columns002 = new Set(options.columns002 ?? []);
  const ledger = [...(options.ledger ?? [])];
  const insertedVersions = new Set();
  const calls = [];
  let profileReady = options.profileReady ?? false;
  let closed = false;

  const client = {
    async execute(statement) {
      calls.push(Object.freeze({ kind: statement.kind, text: statement.text, parameters: statement.parameters }));
      if (closed) throw new Error('client-closed');
      if (options.unauthorized === true) throw providerError(StatusIds_StatusCode.UNAUTHORIZED);

      const text = statement.text.trim();
      if (statement.kind === 'READ') {
        if (text === 'SELECT 1 AS schema_bootstrap_health') return { rows: [] };
        if (text.startsWith('SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations')) {
          if (!tables.has('schema_migrations')) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
          return {
            rows: ledger.map((row) => {
              const version = Number(row.version);
              const appliedAt = row.applied_at;
              return {
                ...row,
                checksum: insertedVersions.has(version) && options.malformedEvidenceAfterWriteVersion === version
                  ? 'sha256:post-write-readback-mismatch'
                  : row.checksum,
                applied_at: typeof appliedAt === 'string' && Number.isFinite(Date.parse(appliedAt))
                  ? new Date(appliedAt)
                  : appliedAt,
              };
            }),
          };
        }
        if (text.includes('FROM finance_profiles') && text.includes('WHERE id = Uuid(')) {
          if (!tables.has('finance_profiles')) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
          return {
            rows: profileReady
              ? [{ timezone: 'Europe/Moscow', target_close_day: 14, version: 1n }]
              : [],
          };
        }
        const normalizedMatch = /^SELECT normalized_source_label FROM (accounts|categories) LIMIT 0$/u.exec(text);
        if (normalizedMatch !== null) {
          const table = normalizedMatch[1];
          if (!tables.has(table) || !columns002.has(table)) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
          return { rows: [] };
        }
        const tableMatch = /\bFROM\s+([a-z_]+)\b/u.exec(text);
        if (tableMatch !== null) {
          const table = tableMatch[1];
          if (!tables.has(table)) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
          return { rows: [] };
        }
        throw new Error('unexpected-read');
      }

      if (options.failWriteIncludes !== undefined && text.includes(options.failWriteIncludes)) {
        throw new Error('private-write-failure');
      }

      const executable = text.replace(/^(?:--[^\n]*(?:\n|$)\s*)+/u, '').trim();
      const createMatch = /^CREATE TABLE ([a-z_]+)\s*\(/u.exec(executable);
      if (createMatch !== null) {
        const table = createMatch[1];
        if (tables.has(table)) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
        tables.add(table);
        return { rows: [] };
      }
      if (executable.startsWith('UPSERT INTO finance_profiles')) {
        if (!tables.has('finance_profiles')) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
        profileReady = true;
        return { rows: [] };
      }
      const alterMatch = /^ALTER TABLE (accounts|categories) ADD COLUMN normalized_source_label Utf8$/u.exec(executable);
      if (alterMatch !== null) {
        const table = alterMatch[1];
        if (!tables.has(table) || columns002.has(table)) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
        columns002.add(table);
        return { rows: [] };
      }
      if (executable.includes('INSERT INTO schema_migrations')) {
        if (!tables.has('schema_migrations')) throw providerError(StatusIds_StatusCode.SCHEME_ERROR);
        const version = Number(parameterValue(statement, '$version'));
        const checksum = parameterValue(statement, '$checksum');
        const appliedAt = parameterValue(statement, '$applied_at');
        if (ledger.some((row) => Number(row.version) === version)) throw providerError(StatusIds_StatusCode.PRECONDITION_FAILED);
        ledger.push({ version: BigInt(version), checksum, applied_at: appliedAt });
        insertedVersions.add(version);
        ledger.sort((left, right) => Number(left.version - right.version));
        return { rows: [] };
      }
      throw new Error('unexpected-write');
    },
    async close() {
      closed = true;
    },
  };

  return {
    client,
    calls,
    tables,
    columns002,
    ledger,
    get profileReady() { return profileReady; },
  };
}

function expectedLedger(versionCount = 2) {
  return MIGRATIONS.slice(0, versionCount).map((migration, index) => ({
    version: BigInt(index + 1),
    checksum: migration.checksum,
    applied_at: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
}

async function expectCode(code, work) {
  await assert.rejects(
    work,
    (error) => error instanceof YdbSchemaBootstrapError && error.code === code,
  );
}

test('bootstrap plan is exact 001→002 with byte checksums and no path to migration 003', () => {
  assert.deepEqual(MIGRATIONS.map(({ version, fileName }) => ({ version, fileName })), [
    { version: 1, fileName: '001_initial.sql' },
    { version: 2, fileName: '002_reference_source_labels.sql' },
  ]);
  assert.equal(MIGRATIONS[0].checksum, 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855');
  assert.equal(MIGRATIONS[1].checksum, 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed');
  assert.equal(MIGRATIONS[0].statements.length, 11);
  assert.equal(MIGRATIONS[1].statements.length, 2);
  const executable = MIGRATIONS.flatMap((migration) => migration.statements).join('\n');
  assert.equal(executable.includes('initial_bootstrap_identity_manifests'), false);
  assert.equal(executable.includes(MIGRATION_003.trim()), false);
});

test('fresh empty target applies exact 001, ledger 1, exact 002, ledger 2 and read-back', async () => {
  const fake = fakeClient();
  const result = await runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK);

  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2] });
  assert.deepEqual([...fake.tables].sort(), [...TABLES_001].sort());
  assert.deepEqual([...fake.columns002].sort(), ['accounts', 'categories']);
  assert.equal(fake.profileReady, true);
  assert.deepEqual(fake.ledger.map(({ version, checksum }) => ({ version: Number(version), checksum })), [
    { version: 1, checksum: MIGRATIONS[0].checksum },
    { version: 2, checksum: MIGRATIONS[1].checksum },
  ]);

  const writes = fake.calls.filter((call) => call.kind === 'WRITE');
  assert.equal(writes.length, 15);
  assert.equal(writes[0].text.includes('CREATE TABLE transactions'), true);
  assert.equal(writes[10].text.includes('UPSERT INTO finance_profiles'), true);
  assert.equal(writes[11].text.includes('INSERT INTO schema_migrations'), true);
  assert.equal(writes[12].text.includes('ALTER TABLE accounts'), true);
  assert.equal(writes[13].text.includes('ALTER TABLE categories'), true);
  assert.equal(writes[14].text.includes('INSERT INTO schema_migrations'), true);
  assert.equal(writes.some((call) => call.text.includes('initial_bootstrap_identity_manifests')), false);
});

test('exact already-ready 001+002 evidence is a read-only no-op', async () => {
  const fake = fakeClient({
    tables: TABLES_001,
    columns002: ['accounts', 'categories'],
    ledger: expectedLedger(2),
    profileReady: true,
  });

  const result = await runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK);
  assert.deepEqual(result, { ydbSchema: 'READY', appliedMigrationVersions: [1, 2] });
  assert.equal(fake.calls.some((call) => call.kind === 'WRITE'), false);
});

test('exact version-1 checkpoint resumes only migration 002', async () => {
  const fake = fakeClient({
    tables: TABLES_001,
    ledger: expectedLedger(1),
    profileReady: true,
  });

  await runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK);
  const writes = fake.calls.filter((call) => call.kind === 'WRITE');
  assert.equal(writes.length, 3);
  assert.equal(writes[0].text.includes('ALTER TABLE accounts'), true);
  assert.equal(writes[1].text.includes('ALTER TABLE categories'), true);
  assert.equal(writes[2].text.includes('INSERT INTO schema_migrations'), true);
});

test('pre-existing table without migration evidence fails closed before any write', async () => {
  const fake = fakeClient({ tables: ['transactions'] });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK));
  assert.equal(fake.calls.some((call) => call.kind === 'WRITE'), false);
});

test('existing empty schema_migrations ledger is partial state and never restarts 001', async () => {
  const fake = fakeClient({ tables: ['schema_migrations'] });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK));
  assert.equal(fake.calls.some((call) => call.kind === 'WRITE'), false);
});

test('partially applied migration 002 fails closed instead of guessing resume state', async () => {
  const fake = fakeClient({
    tables: TABLES_001,
    columns002: ['accounts'],
    ledger: expectedLedger(1),
    profileReady: true,
  });
  await expectCode('PARTIAL_SCHEMA_STATE', () => runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK));
  assert.equal(fake.calls.some((call) => call.kind === 'WRITE'), false);
});

test('checksum drift, duplicate/unexpected evidence and version 3 fail closed', async () => {
  const cases = [
    [{ ...expectedLedger(1)[0], checksum: 'sha256:wrong' }],
    [expectedLedger(1)[0], expectedLedger(1)[0]],
    [{ version: 3n, checksum: 'sha256:forbidden', applied_at: '2026-09-03T00:00:00.000Z' }],
  ];
  for (const ledger of cases) {
    const fake = fakeClient({ tables: TABLES_001, ledger, profileReady: true });
    await expectCode('UNEXPECTED_MIGRATION_EVIDENCE', () => runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK));
    assert.equal(fake.calls.some((call) => call.kind === 'WRITE'), false);
  }
});

test('provider unauthorized evidence is classified without mutation', async () => {
  const fake = fakeClient({ unauthorized: true });
  await expectCode('YDB_ACCESS_DENIED', () => runYdbSchemaBootstrap(fake.client, MIGRATIONS, CLOCK));
  assert.equal(fake.calls.some((call) => call.kind === 'WRITE'), false);
});

test('migration 001/002 execution failure is stage-specific and never advances ledger', async () => {
  const first = fakeClient({ failWriteIncludes: 'CREATE TABLE categories' });
  await expectCode('MIGRATION_001_APPLY_FAILED', () => runYdbSchemaBootstrap(first.client, MIGRATIONS, CLOCK));
  assert.equal(first.ledger.length, 0);

  const second = fakeClient({
    tables: TABLES_001,
    ledger: expectedLedger(1),
    profileReady: true,
    failWriteIncludes: 'ALTER TABLE categories',
  });
  await expectCode('MIGRATION_002_APPLY_FAILED', () => runYdbSchemaBootstrap(second.client, MIGRATIONS, CLOCK));
  assert.equal(second.ledger.length, 1);
});

test('post-write evidence mismatch is reported at the exact migration stage', async () => {
  const first = fakeClient({ malformedEvidenceAfterWriteVersion: 1 });
  await expectCode('MIGRATION_001_EVIDENCE_FAILED', () => runYdbSchemaBootstrap(first.client, MIGRATIONS, CLOCK));
  assert.deepEqual(first.ledger.map((row) => Number(row.version)), [1]);
  assert.equal(first.columns002.size, 0);

  const second = fakeClient({
    tables: TABLES_001,
    ledger: expectedLedger(1),
    profileReady: true,
    malformedEvidenceAfterWriteVersion: 2,
  });
  await expectCode('MIGRATION_002_EVIDENCE_FAILED', () => runYdbSchemaBootstrap(second.client, MIGRATIONS, CLOCK));
  assert.deepEqual(second.ledger.map((row) => Number(row.version)), [1, 2]);
});

test('migration bundle validation rejects changed statement shape instead of widening allowlist', () => {
  assert.throws(
    () => createYdbSchemaBootstrapMigrations({
      migration001Sql: MIGRATION_001,
      migration002Sql: `${MIGRATION_002}\nCREATE TABLE forbidden_extra (id Uint64, PRIMARY KEY(id));\n`,
    }),
    (error) => error instanceof YdbSchemaBootstrapError && error.code === 'MIGRATION_BUNDLE_INVALID',
  );
});
