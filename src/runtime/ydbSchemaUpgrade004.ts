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

export const YDB_SCHEMA_UPGRADE_004_TARGET_VERSION = 4 as const;
export const YDB_SCHEMA_UPGRADE_004_FILE = '004_source_record_revision_run_index.sql' as const;
export const YDB_SCHEMA_UPGRADE_004_INDEX = 'idx_source_record_revisions_run_revision' as const;

const APPLIED_MIGRATION_CHECKSUMS = Object.freeze({
  1: 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855',
  2: 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed',
  3: 'sha256:da569cc8b8bb4772713baf60196a32741b5b704bdb979d1ee60fe40dccb4df06',
} as const);

const EXPECTED_MIGRATION_004 = [
  'ALTER TABLE source_record_revisions',
  'ADD INDEX idx_source_record_revisions_run_revision GLOBAL SYNC',
  'ON (migration_run_id, revision)',
  'COVER (observed_at, row_hint, row_digest, change_class)',
].join(' ');

const MIGRATION_LEDGER_QUERY = 'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC';
const INDEX_SCHEMA_PROBE = [
  'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint,',
  'CAST(row_digest AS Utf8) AS row_digest, change_class',
  'FROM source_record_revisions VIEW idx_source_record_revisions_run_revision LIMIT 0',
].join(' ');
const INSERT_MIGRATION_EVIDENCE = [
  'DECLARE $version AS Uint64;',
  'DECLARE $checksum AS String;',
  'DECLARE $applied_at AS Timestamp;',
  'INSERT INTO schema_migrations (version, checksum, applied_at)',
  'VALUES ($version, $checksum, $applied_at)',
].join('\n');

export interface YdbSchemaUpgrade004Migration {
  readonly version: 4;
  readonly fileName: typeof YDB_SCHEMA_UPGRADE_004_FILE;
  readonly checksum: string;
  readonly statement: string;
}

export interface YdbSchemaUpgrade004Client {
  execute<Row = Readonly<Record<string, unknown>>>(
    statement: Readonly<YdbStatement>,
  ): Promise<YdbQueryResult<Row>>;
  close(): Promise<void>;
}

export interface YdbSchemaUpgrade004Clock {
  now(): Date;
}

export interface YdbSchemaUpgrade004Result {
  readonly ydbSchema: 'READY';
  readonly appliedMigrationVersions: readonly [1, 2, 3, 4];
}

export type YdbSchemaUpgrade004ErrorCode =
  | 'CONFIG_INVALID'
  | 'MIGRATION_BUNDLE_INVALID'
  | 'YDB_CLIENT_CREATE_FAILED'
  | 'YDB_HEALTH_READ_FAILED'
  | 'YDB_ACCESS_DENIED'
  | 'YDB_PREFLIGHT_READ_FAILED'
  | 'PARTIAL_SCHEMA_STATE'
  | 'UNEXPECTED_MIGRATION_EVIDENCE'
  | 'MIGRATION_004_APPLY_FAILED'
  | 'MIGRATION_004_EVIDENCE_FAILED'
  | 'FINAL_READBACK_FAILED'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class YdbSchemaUpgrade004Error extends Error {
  readonly code: YdbSchemaUpgrade004ErrorCode;

  constructor(code: YdbSchemaUpgrade004ErrorCode) {
    super(code);
    this.name = 'YdbSchemaUpgrade004Error';
    this.code = code;
  }
}

interface MigrationEvidenceRow {
  readonly version?: unknown;
  readonly checksum?: unknown;
  readonly applied_at?: unknown;
}

function checksum(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
}

function withoutLeadingComments(sql: string): string {
  let value = sql.trim();
  while (value.startsWith('--')) {
    const newline = value.indexOf('\n');
    if (newline === -1) return '';
    value = value.slice(newline + 1).trimStart();
  }
  return value;
}

export function createYdbSchemaUpgrade004Migration(sql: string): Readonly<YdbSchemaUpgrade004Migration> {
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new YdbSchemaUpgrade004Error('MIGRATION_BUNDLE_INVALID');
  }
  let executable = withoutLeadingComments(sql);
  if (!executable.endsWith(';') || executable.slice(0, -1).includes(';')) {
    throw new YdbSchemaUpgrade004Error('MIGRATION_BUNDLE_INVALID');
  }
  executable = executable.slice(0, -1).trim();
  if (executable.replace(/\s+/gu, ' ') !== EXPECTED_MIGRATION_004) {
    throw new YdbSchemaUpgrade004Error('MIGRATION_BUNDLE_INVALID');
  }
  return Object.freeze({
    version: 4 as const,
    fileName: YDB_SCHEMA_UPGRADE_004_FILE,
    checksum: checksum(sql),
    statement: executable,
  });
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
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return -1;
}

function validAppliedAt(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function classifyEvidence(
  rows: readonly Readonly<MigrationEvidenceRow>[],
  migration: Readonly<YdbSchemaUpgrade004Migration>,
): 3 | 4 {
  const expected = new Map<number, string>([
    [1, APPLIED_MIGRATION_CHECKSUMS[1]],
    [2, APPLIED_MIGRATION_CHECKSUMS[2]],
    [3, APPLIED_MIGRATION_CHECKSUMS[3]],
    [4, migration.checksum],
  ]);
  const seen = new Set<number>();
  for (const row of rows) {
    const version = migrationVersion(row.version);
    if (
      version < 1
      || version > 4
      || seen.has(version)
      || typeof row.checksum !== 'string'
      || row.checksum !== expected.get(version)
      || !validAppliedAt(row.applied_at)
    ) {
      throw new YdbSchemaUpgrade004Error('UNEXPECTED_MIGRATION_EVIDENCE');
    }
    seen.add(version);
  }
  if (seen.size === 3 && [1, 2, 3].every((version) => seen.has(version))) return 3;
  if (seen.size === 4 && [1, 2, 3, 4].every((version) => seen.has(version))) return 4;
  throw new YdbSchemaUpgrade004Error('UNEXPECTED_MIGRATION_EVIDENCE');
}

async function readMigrationEvidence(
  client: Readonly<YdbSchemaUpgrade004Client>,
): Promise<readonly Readonly<MigrationEvidenceRow>[]> {
  const result = await client.execute<MigrationEvidenceRow>(readStatement(MIGRATION_LEDGER_QUERY));
  return result.rows;
}

async function indexExists(client: Readonly<YdbSchemaUpgrade004Client>): Promise<boolean> {
  try {
    await client.execute(readStatement(INDEX_SCHEMA_PROBE));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    if (isUnauthorized(error)) throw new YdbSchemaUpgrade004Error('YDB_ACCESS_DENIED');
    throw new YdbSchemaUpgrade004Error('YDB_PREFLIGHT_READ_FAILED');
  }
}

function nowIso(clock: Readonly<YdbSchemaUpgrade004Clock>): string {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new YdbSchemaUpgrade004Error('MIGRATION_BUNDLE_INVALID');
  }
  return value.toISOString();
}

async function insertEvidence(
  client: Readonly<YdbSchemaUpgrade004Client>,
  migration: Readonly<YdbSchemaUpgrade004Migration>,
  appliedAt: string,
): Promise<void> {
  await client.execute(writeStatement(INSERT_MIGRATION_EVIDENCE, {
    '$version': uint64Parameter(4),
    '$checksum': stringParameter(migration.checksum),
    '$applied_at': timestampParameter(appliedAt),
  }));
}

async function assertFinalReadback(
  client: Readonly<YdbSchemaUpgrade004Client>,
  migration: Readonly<YdbSchemaUpgrade004Migration>,
): Promise<void> {
  if (classifyEvidence(await readMigrationEvidence(client), migration) !== 4) {
    throw new YdbSchemaUpgrade004Error('FINAL_READBACK_FAILED');
  }
  if (!await indexExists(client)) throw new YdbSchemaUpgrade004Error('FINAL_READBACK_FAILED');
}

export async function runYdbSchemaUpgrade004(
  client: Readonly<YdbSchemaUpgrade004Client>,
  migration: Readonly<YdbSchemaUpgrade004Migration>,
  clock: Readonly<YdbSchemaUpgrade004Clock>,
): Promise<Readonly<YdbSchemaUpgrade004Result>> {
  try {
    await client.execute(readStatement('SELECT 1 AS schema_upgrade_004_health'));
  } catch (error) {
    if (isUnauthorized(error)) throw new YdbSchemaUpgrade004Error('YDB_ACCESS_DENIED');
    throw new YdbSchemaUpgrade004Error('YDB_HEALTH_READ_FAILED');
  }

  let evidenceVersion: 3 | 4;
  try {
    evidenceVersion = classifyEvidence(await readMigrationEvidence(client), migration);
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade004Error) throw error;
    if (isUnauthorized(error)) throw new YdbSchemaUpgrade004Error('YDB_ACCESS_DENIED');
    throw new YdbSchemaUpgrade004Error('YDB_PREFLIGHT_READ_FAILED');
  }

  const physicalPresent = await indexExists(client);
  if (evidenceVersion === 3 && physicalPresent) throw new YdbSchemaUpgrade004Error('PARTIAL_SCHEMA_STATE');
  if (evidenceVersion === 4 && !physicalPresent) throw new YdbSchemaUpgrade004Error('PARTIAL_SCHEMA_STATE');

  if (evidenceVersion === 3) {
    try {
      await client.execute(writeStatement(migration.statement));
    } catch {
      throw new YdbSchemaUpgrade004Error('MIGRATION_004_APPLY_FAILED');
    }
    try {
      await insertEvidence(client, migration, nowIso(clock));
      if (classifyEvidence(await readMigrationEvidence(client), migration) !== 4) {
        throw new YdbSchemaUpgrade004Error('UNEXPECTED_MIGRATION_EVIDENCE');
      }
    } catch {
      throw new YdbSchemaUpgrade004Error('MIGRATION_004_EVIDENCE_FAILED');
    }
  }

  try {
    await assertFinalReadback(client, migration);
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade004Error && error.code === 'YDB_ACCESS_DENIED') throw error;
    throw new YdbSchemaUpgrade004Error('FINAL_READBACK_FAILED');
  }

  return Object.freeze({
    ydbSchema: 'READY' as const,
    appliedMigrationVersions: Object.freeze([1, 2, 3, 4]) as readonly [1, 2, 3, 4],
  });
}
