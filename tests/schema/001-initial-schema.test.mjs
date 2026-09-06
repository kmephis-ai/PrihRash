import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8');

const expectedTables = [
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
];

function tableBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(`CREATE TABLE ${escaped} \\(([\\s\\S]*?)\\) WITH \\(STORE = ROW\\);`));
  assert.ok(match, `missing row-store CREATE TABLE for ${name}`);
  return match[1];
}

function expectColumns(table, columns) {
  const body = tableBlock(table);
  for (const [name, type] of Object.entries(columns)) {
    assert.match(body, new RegExp(`(?:^|\\n)\\s*${name} ${type}(?: NOT NULL)?(?:,|\\n)`), `${table}.${name} ${type}`);
  }
}

test('initial migration creates exactly the canonical R1 physical foundation', () => {
  const actual = [...sql.matchAll(/CREATE TABLE ([a-z_]+) \(/g)].map((match) => match[1]);
  assert.deepEqual(actual, expectedTables);
  assert.doesNotMatch(sql, /CREATE TABLE (financial_periods|period_closes|app_users|obligations|receipts)\b/);
});

test('every initial table is row-oriented and no secondary index is declared', () => {
  assert.equal((sql.match(/WITH \(STORE = ROW\);/g) ?? []).length, expectedTables.length);
  assert.doesNotMatch(sql, /\bINDEX\s+[a-z_]+/i);
  assert.doesNotMatch(sql, /STORE\s*=\s*COLUMN/i);
});

test('schema migrations fail closed instead of hiding drift', () => {
  assert.doesNotMatch(sql, /IF NOT EXISTS/i);
  expectColumns('schema_migrations', {
    version: 'Uint64',
    checksum: 'String',
    applied_at: 'Timestamp',
  });
  assert.match(tableBlock('schema_migrations'), /PRIMARY KEY \(version\)/);
});

test('transaction persistence keeps canonical financial and data-quality slots', () => {
  expectColumns('transactions', {
    id: 'Uuid',
    type: 'Utf8',
    occurred_on: 'Date',
    captured_at: 'Timestamp',
    record_granularity: 'Utf8',
    date_precision: 'Utf8',
    aggregate_period_month: 'Date',
    financial_period_id: 'Uuid',
    period_assignment_quality: 'Utf8',
    amount_minor: 'Int64',
    currency: 'Utf8',
    from_account_id: 'Uuid',
    to_account_id: 'Uuid',
    category_id: 'Uuid',
    paid_by_member_id: 'Uuid',
    description: 'Utf8',
    note: 'Utf8',
    status: 'Utf8',
    analytics_state: 'Utf8',
    flow_kind: 'Utf8',
    created_at: 'Timestamp',
    updated_at: 'Timestamp',
    version: 'Uint64',
  });
  assert.match(tableBlock('transactions'), /id Uuid NOT NULL/);
  assert.match(tableBlock('transactions'), /PRIMARY KEY \(id\)/);
});

test('source lineage and revision provenance remain explicit and append-only addressable', () => {
  expectColumns('source_records', {
    id: 'Uuid',
    source_type: 'Utf8',
    source_sheet: 'Utf8',
    first_seen_at: 'Timestamp',
    last_seen_at: 'Timestamp',
    last_row_hint: 'Uint64',
    current_digest: 'String',
    state: 'Utf8',
    classification: 'Utf8',
    normalization_status: 'Utf8',
    transaction_id: 'Uuid',
    current_revision: 'Uint64',
    resolution_code: 'Utf8',
    resolved_at: 'Timestamp',
    resolved_by: 'Utf8',
  });
  expectColumns('source_record_revisions', {
    source_record_id: 'Uuid',
    revision: 'Uint64',
    migration_run_id: 'Uuid',
    observed_at: 'Timestamp',
    row_hint: 'Uint64',
    row_digest: 'String',
    change_class: 'Utf8',
    raw_payload: 'JsonDocument',
  });
  assert.match(tableBlock('source_record_revisions'), /source_record_id Uuid NOT NULL/);
  assert.match(tableBlock('source_record_revisions'), /revision Uint64 NOT NULL/);
  assert.match(tableBlock('source_record_revisions'), /PRIMARY KEY \(source_record_id, revision\)/);
});

test('snapshot and MigrationRun manifests support canonical reconciliation state', () => {
  expectColumns('source_snapshots', {
    id: 'Uuid',
    captured_at: 'Timestamp',
    source_sheet: 'Utf8',
    snapshot_digest: 'String',
    row_count: 'Uint64',
  });
  expectColumns('migration_runs', {
    id: 'Uuid',
    started_at: 'Timestamp',
    finished_at: 'Timestamp',
    source_snapshot_digest: 'String',
    state: 'Utf8',
    rows_seen: 'Uint64',
    rows_new: 'Uint64',
    rows_changed: 'Uint64',
    rows_missing: 'Uint64',
    rows_ambiguous: 'Uint64',
    error_code: 'Utf8',
  });
});

test('FinanceProfile is persisted from the initial migration with canonical values', () => {
  expectColumns('finance_profiles', {
    id: 'Uuid',
    timezone: 'Utf8',
    target_close_day: 'Uint32',
    version: 'Uint64',
  });
  assert.match(sql, /UPSERT INTO finance_profiles/);
  assert.match(sql, /"Europe\/Moscow"u/);
  assert.match(sql, /Uint32\("14"\)/);
  assert.match(sql, /Uuid\("00000000-0000-0000-0000-000000000001"\)/);
});

test('migration contains no real financial fixtures or snapshot payload', () => {
  assert.doesNotMatch(sql, /INSERT INTO (transactions|accounts|categories|family_members|source_records|source_record_revisions|source_snapshots|migration_runs)/i);
  assert.doesNotMatch(sql, /UPSERT INTO (transactions|accounts|categories|family_members|source_records|source_record_revisions|source_snapshots|migration_runs)/i);
});
