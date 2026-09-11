import { createHash } from 'node:crypto';

import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import {
  readStatement,
  writeStatement,
  type YdbQueryResult,
  type YdbStatement,
} from '../integration/ydb/adapter.js';
import {
  stringParameter,
  timestampParameter,
  uint64Parameter,
} from '../integration/ydb/parameters.js';

export const YDB_SCHEMA_BOOTSTRAP_TARGET_VERSION = 2 as const;
export const YDB_SCHEMA_BOOTSTRAP_MIGRATION_FILES = Object.freeze([
  '001_initial.sql',
  '002_reference_source_labels.sql',
] as const);

export interface YdbSchemaBootstrapMigration {
  readonly version: 1 | 2;
  readonly fileName: (typeof YDB_SCHEMA_BOOTSTRAP_MIGRATION_FILES)[number];
  readonly checksum: string;
  readonly statements: readonly string[];
}

export interface YdbSchemaBootstrapClient {
  execute<Row = Readonly<Record<string, unknown>>>(
    statement: Readonly<YdbStatement>,
  ): Promise<YdbQueryResult<Row>>;
  close(): Promise<void>;
}

export interface YdbSchemaBootstrapClock {
  now(): Date;
}

export interface YdbSchemaBootstrapResult {
  readonly ydbSchema: 'READY';
  readonly appliedMigrationVersions: readonly [1, 2];
}

export type YdbSchemaBootstrapErrorCode =
  | 'CONFIG_INVALID'
  | 'MIGRATION_BUNDLE_INVALID'
  | 'YDB_CLIENT_CREATE_FAILED'
  | 'YDB_HEALTH_READ_FAILED'
  | 'YDB_ACCESS_DENIED'
  | 'YDB_PREFLIGHT_READ_FAILED'
  | 'PARTIAL_SCHEMA_STATE'
  | 'UNEXPECTED_MIGRATION_EVIDENCE'
  | 'MIGRATION_001_APPLY_FAILED'
  | 'MIGRATION_001_EVIDENCE_FAILED'
  | 'MIGRATION_002_APPLY_FAILED'
  | 'MIGRATION_002_EVIDENCE_FAILED'
  | 'FINAL_READBACK_FAILED'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class YdbSchemaBootstrapError extends Error {
  readonly code: YdbSchemaBootstrapErrorCode;

  constructor(code: YdbSchemaBootstrapErrorCode) {
    super(code);
    this.name = 'YdbSchemaBootstrapError';
    this.code = code;
  }
}

interface MigrationEvidenceRow {
  readonly version?: unknown;
  readonly checksum?: unknown;
  readonly applied_at?: unknown;
}

const EXPECTED_001_STATEMENTS = Object.freeze([
  /^CREATE TABLE transactions\s*\(/u,
  /^CREATE TABLE accounts\s*\(/u,
  /^CREATE TABLE categories\s*\(/u,
  /^CREATE TABLE family_members\s*\(/u,
  /^CREATE TABLE finance_profiles\s*\(/u,
  /^CREATE TABLE source_records\s*\(/u,
  /^CREATE TABLE source_record_revisions\s*\(/u,
  /^CREATE TABLE source_snapshots\s*\(/u,
  /^CREATE TABLE migration_runs\s*\(/u,
  /^CREATE TABLE schema_migrations\s*\(/u,
  /^UPSERT INTO finance_profiles\s*\(/u,
]);
const EXPECTED_002_STATEMENTS = Object.freeze([
  /^ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8$/u,
  /^ALTER TABLE categories ADD COLUMN normalized_source_label Utf8$/u,
]);
const MIGRATION_LEDGER_QUERY = 'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC';
const INSERT_MIGRATION_EVIDENCE = [
  'DECLARE $version AS Uint64;',
  'DECLARE $checksum AS String;',
  'DECLARE $applied_at AS Timestamp;',
  'INSERT INTO schema_migrations (version, checksum, applied_at)',
  'VALUES ($version, $checksum, $applied_at)',
].join('\n');

const BASELINE_TABLE_PROBES = Object.freeze([
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
const MIGRATION_002_PROBES = Object.freeze([
  'SELECT normalized_source_label FROM accounts LIMIT 0',
  'SELECT normalized_source_label FROM categories LIMIT 0',
]);
const FINANCE_PROFILE_READBACK = [
  'SELECT CAST(timezone AS Utf8) AS timezone, target_close_day, version',
  'FROM finance_profiles',
  'WHERE id = Uuid("00000000-0000-0000-0000-000000000001")',
  'LIMIT 2',
].join('\n');

function checksum(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
}

function withoutLeadingComments(statement: string): string {
  let value = statement.trim();
  while (true) {
    const lineComment = /^--[^\n]*(?:\n|$)/u.exec(value);
    if (lineComment !== null) {
      value = value.slice(lineComment[0].length).trimStart();
      continue;
    }
    const blockComment = /^\/\*[\s\S]*?\*\//u.exec(value);
    if (blockComment !== null) {
      value = value.slice(blockComment[0].length).trimStart();
      continue;
    }
    return value;
  }
}

export function splitTrustedYqlStatements(sql: string): readonly string[] {
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new YdbSchemaBootstrapError('MIGRATION_BUNDLE_INVALID');
  }

  const statements: string[] = [];
  let start = 0;
  let quote: 'single' | 'double' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      const expected = quote === 'single' ? "'" : '"';
      if (current === '\\') {
        index += 1;
        continue;
      }
      if (current === expected) {
        if (next === expected) {
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (current === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'") {
      quote = 'single';
      continue;
    }
    if (current === '"') {
      quote = 'double';
      continue;
    }
    if (current === ';') {
      const statement = sql.slice(start, index).trim();
      if (withoutLeadingComments(statement).length > 0) statements.push(statement);
      start = index + 1;
    }
  }

  if (quote !== null || blockComment) {
    throw new YdbSchemaBootstrapError('MIGRATION_BUNDLE_INVALID');
  }
  const tail = sql.slice(start).trim();
  if (withoutLeadingComments(tail).length > 0) statements.push(tail);
  return Object.freeze(statements);
}

function validateStatements(
  statements: readonly string[],
  expected: readonly RegExp[],
): void {
  if (statements.length !== expected.length) {
    throw new YdbSchemaBootstrapError('MIGRATION_BUNDLE_INVALID');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const statement = statements[index];
    const pattern = expected[index];
    if (statement === undefined || pattern === undefined || !pattern.test(withoutLeadingComments(statement).trim())) {
      throw new YdbSchemaBootstrapError('MIGRATION_BUNDLE_INVALID');
    }
  }
}

export function createYdbSchemaBootstrapMigrations(input: Readonly<{
  migration001Sql: string;
  migration002Sql: string;
}>): readonly [Readonly<YdbSchemaBootstrapMigration>, Readonly<YdbSchemaBootstrapMigration>] {
  const statements001 = splitTrustedYqlStatements(input.migration001Sql);
  const statements002 = splitTrustedYqlStatements(input.migration002Sql);
  validateStatements(statements001, EXPECTED_001_STATEMENTS);
  validateStatements(statements002, EXPECTED_002_STATEMENTS);

  return Object.freeze([
    Object.freeze({
      version: 1 as const,
      fileName: '001_initial.sql' as const,
      checksum: checksum(input.migration001Sql),
      statements: statements001,
    }),
    Object.freeze({
      version: 2 as const,
      fileName: '002_reference_source_labels.sql' as const,
      checksum: checksum(input.migration002Sql),
      statements: statements002,
    }),
  ]);
}

function providerStatus(error: unknown): unknown {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return null;
  return Reflect.get(error, 'code');
}

function isMissing(error: unknown): boolean {
  const status = providerStatus(error);
  return status === StatusIds_StatusCode.SCHEME_ERROR || status === StatusIds_StatusCode.NOT_FOUND;
}

function isUnauthorized(error: unknown): boolean {
  return providerStatus(error) === StatusIds_StatusCode.UNAUTHORIZED;
}

function migrationVersion(value: unknown): number {
  if (typeof value === 'bigint' && value >= 0n && value <= 2n) return Number(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2) return value;
  return -1;
}

function validAppliedAt(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function classifyEvidence(
  rows: readonly Readonly<MigrationEvidenceRow>[],
  migrations: readonly [Readonly<YdbSchemaBootstrapMigration>, Readonly<YdbSchemaBootstrapMigration>],
): 0 | 1 | 2 {
  const seen = new Set<number>();
  for (const row of rows) {
    const version = migrationVersion(row.version);
    if (
      version < 1
      || version > 2
      || seen.has(version)
      || typeof row.checksum !== 'string'
      || !validAppliedAt(row.applied_at)
      || row.checksum !== migrations[version - 1]?.checksum
    ) {
      throw new YdbSchemaBootstrapError('UNEXPECTED_MIGRATION_EVIDENCE');
    }
    seen.add(version);
  }
  if (seen.size === 0) return 0;
  if (seen.size === 1 && seen.has(1)) return 1;
  if (seen.size === 2 && seen.has(1) && seen.has(2)) return 2;
  throw new YdbSchemaBootstrapError('UNEXPECTED_MIGRATION_EVIDENCE');
}

async function readMigrationEvidence(
  client: Readonly<YdbSchemaBootstrapClient>,
): Promise<readonly Readonly<MigrationEvidenceRow>[]> {
  const result = await client.execute<MigrationEvidenceRow>(readStatement(MIGRATION_LEDGER_QUERY));
  return result.rows;
}

async function probeTableExists(
  client: Readonly<YdbSchemaBootstrapClient>,
  query: string,
): Promise<boolean> {
  try {
    await client.execute(readStatement(query));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    if (isUnauthorized(error)) throw new YdbSchemaBootstrapError('YDB_ACCESS_DENIED');
    throw new YdbSchemaBootstrapError('YDB_PREFLIGHT_READ_FAILED');
  }
}

async function assertFreshEmptySchema(client: Readonly<YdbSchemaBootstrapClient>): Promise<void> {
  for (const probe of BASELINE_TABLE_PROBES) {
    if (await probeTableExists(client, probe)) {
      throw new YdbSchemaBootstrapError('PARTIAL_SCHEMA_STATE');
    }
  }
}

async function assertMigration1Physical(client: Readonly<YdbSchemaBootstrapClient>): Promise<void> {
  for (const probe of BASELINE_TABLE_PROBES) {
    if (!await probeTableExists(client, probe)) {
      throw new YdbSchemaBootstrapError('PARTIAL_SCHEMA_STATE');
    }
  }
}

async function migration2PhysicalState(
  client: Readonly<YdbSchemaBootstrapClient>,
): Promise<0 | 1 | 2> {
  let present = 0;
  for (const probe of MIGRATION_002_PROBES) {
    if (await probeTableExists(client, probe)) present += 1;
  }
  return present as 0 | 1 | 2;
}

async function applyMigrationStatements(
  client: Readonly<YdbSchemaBootstrapClient>,
  migration: Readonly<YdbSchemaBootstrapMigration>,
): Promise<void> {
  for (const statement of migration.statements) {
    await client.execute(writeStatement(statement));
  }
}

function nowIso(clock: Readonly<YdbSchemaBootstrapClock>): string {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new YdbSchemaBootstrapError('MIGRATION_BUNDLE_INVALID');
  }
  return value.toISOString();
}

async function insertEvidence(
  client: Readonly<YdbSchemaBootstrapClient>,
  migration: Readonly<YdbSchemaBootstrapMigration>,
  appliedAt: string,
): Promise<void> {
  await client.execute(writeStatement(INSERT_MIGRATION_EVIDENCE, {
    '$version': uint64Parameter(migration.version),
    '$checksum': stringParameter(migration.checksum),
    '$applied_at': timestampParameter(appliedAt),
  }));
}

async function assertExactEvidenceAfterWrite(
  client: Readonly<YdbSchemaBootstrapClient>,
  migrations: readonly [Readonly<YdbSchemaBootstrapMigration>, Readonly<YdbSchemaBootstrapMigration>],
  expectedVersion: 1 | 2,
): Promise<void> {
  const rows = await readMigrationEvidence(client);
  if (classifyEvidence(rows, migrations) !== expectedVersion) {
    throw new YdbSchemaBootstrapError('UNEXPECTED_MIGRATION_EVIDENCE');
  }
}

function minorInteger(value: unknown): number | null {
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}

async function assertFinalReadback(
  client: Readonly<YdbSchemaBootstrapClient>,
  migrations: readonly [Readonly<YdbSchemaBootstrapMigration>, Readonly<YdbSchemaBootstrapMigration>],
): Promise<void> {
  const rows = await readMigrationEvidence(client);
  if (classifyEvidence(rows, migrations) !== 2) {
    throw new YdbSchemaBootstrapError('FINAL_READBACK_FAILED');
  }
  await assertMigration1Physical(client);
  if (await migration2PhysicalState(client) !== 2) {
    throw new YdbSchemaBootstrapError('FINAL_READBACK_FAILED');
  }

  const profile = await client.execute<Readonly<Record<string, unknown>>>(readStatement(FINANCE_PROFILE_READBACK));
  if (
    profile.rows.length !== 1
    || profile.rows[0]?.timezone !== 'Europe/Moscow'
    || minorInteger(profile.rows[0]?.target_close_day) !== 14
    || minorInteger(profile.rows[0]?.version) !== 1
  ) {
    throw new YdbSchemaBootstrapError('FINAL_READBACK_FAILED');
  }
}

export async function runYdbSchemaBootstrap(
  client: Readonly<YdbSchemaBootstrapClient>,
  migrations: readonly [Readonly<YdbSchemaBootstrapMigration>, Readonly<YdbSchemaBootstrapMigration>],
  clock: Readonly<YdbSchemaBootstrapClock>,
): Promise<Readonly<YdbSchemaBootstrapResult>> {
  try {
    await client.execute(readStatement('SELECT 1 AS schema_bootstrap_health'));
  } catch (error) {
    if (isUnauthorized(error)) throw new YdbSchemaBootstrapError('YDB_ACCESS_DENIED');
    throw new YdbSchemaBootstrapError('YDB_HEALTH_READ_FAILED');
  }

  let evidenceVersion: 0 | 1 | 2;
  try {
    evidenceVersion = classifyEvidence(await readMigrationEvidence(client), migrations);
    if (evidenceVersion === 0) {
      throw new YdbSchemaBootstrapError('PARTIAL_SCHEMA_STATE');
    }
  } catch (error) {
    if (error instanceof YdbSchemaBootstrapError) throw error;
    if (isUnauthorized(error)) throw new YdbSchemaBootstrapError('YDB_ACCESS_DENIED');
    if (isMissing(error)) {
      await assertFreshEmptySchema(client);
      evidenceVersion = 0;
    } else {
      throw new YdbSchemaBootstrapError('YDB_PREFLIGHT_READ_FAILED');
    }
  }

  if (evidenceVersion === 0) {
    try {
      await applyMigrationStatements(client, migrations[0]);
    } catch {
      throw new YdbSchemaBootstrapError('MIGRATION_001_APPLY_FAILED');
    }
    try {
      await insertEvidence(client, migrations[0], nowIso(clock));
      await assertExactEvidenceAfterWrite(client, migrations, 1);
    } catch {
      throw new YdbSchemaBootstrapError('MIGRATION_001_EVIDENCE_FAILED');
    }
    evidenceVersion = 1;
  }

  if (evidenceVersion === 1) {
    await assertMigration1Physical(client);
    const migration2State = await migration2PhysicalState(client);
    if (migration2State !== 0) throw new YdbSchemaBootstrapError('PARTIAL_SCHEMA_STATE');

    try {
      await applyMigrationStatements(client, migrations[1]);
    } catch {
      throw new YdbSchemaBootstrapError('MIGRATION_002_APPLY_FAILED');
    }
    try {
      await insertEvidence(client, migrations[1], nowIso(clock));
      await assertExactEvidenceAfterWrite(client, migrations, 2);
    } catch {
      throw new YdbSchemaBootstrapError('MIGRATION_002_EVIDENCE_FAILED');
    }
  }

  try {
    await assertFinalReadback(client, migrations);
  } catch (error) {
    if (error instanceof YdbSchemaBootstrapError && error.code === 'FINAL_READBACK_FAILED') throw error;
    if (error instanceof YdbSchemaBootstrapError && error.code === 'YDB_ACCESS_DENIED') throw error;
    throw new YdbSchemaBootstrapError('FINAL_READBACK_FAILED');
  }

  return Object.freeze({
    ydbSchema: 'READY' as const,
    appliedMigrationVersions: Object.freeze([1, 2]) as readonly [1, 2],
  });
}
