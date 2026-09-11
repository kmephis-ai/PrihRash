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

export const YDB_SCHEMA_UPGRADE_003_TARGET_VERSION = 3 as const;
export const YDB_SCHEMA_UPGRADE_003_FILE = '003_initial_bootstrap_identity_manifest.sql' as const;

const APPLIED_MIGRATION_CHECKSUMS = Object.freeze({
  1: 'sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855',
  2: 'sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed',
} as const);

const EXPECTED_MIGRATION_003 = [
  'CREATE TABLE initial_bootstrap_identity_manifests (',
  'migration_run_id Uuid NOT NULL,',
  'source_snapshot_id Uuid NOT NULL,',
  'source_snapshot_digest String NOT NULL,',
  'binding_count Uint64 NOT NULL,',
  'bindings JsonDocument NOT NULL,',
  'PRIMARY KEY (migration_run_id)',
  ') WITH (STORE = ROW)',
].join(' ');

const MIGRATION_LEDGER_QUERY = 'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC';
const MANIFEST_SCHEMA_PROBE = [
  'SELECT migration_run_id, source_snapshot_id,',
  'CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest,',
  'binding_count, bindings',
  'FROM initial_bootstrap_identity_manifests LIMIT 0',
].join(' ');
const INSERT_MIGRATION_EVIDENCE = [
  'DECLARE $version AS Uint64;',
  'DECLARE $checksum AS String;',
  'DECLARE $applied_at AS Timestamp;',
  'INSERT INTO schema_migrations (version, checksum, applied_at)',
  'VALUES ($version, $checksum, $applied_at)',
].join('\n');

export interface YdbSchemaUpgrade003Migration {
  readonly version: 3;
  readonly fileName: typeof YDB_SCHEMA_UPGRADE_003_FILE;
  readonly checksum: string;
  readonly statement: string;
}

export interface YdbSchemaUpgrade003Client {
  execute<Row = Readonly<Record<string, unknown>>>(
    statement: Readonly<YdbStatement>,
  ): Promise<YdbQueryResult<Row>>;
  close(): Promise<void>;
}

export interface YdbSchemaUpgrade003Clock {
  now(): Date;
}

export interface YdbSchemaUpgrade003Result {
  readonly ydbSchema: 'READY';
  readonly appliedMigrationVersions: readonly [1, 2, 3];
}

export type YdbSchemaUpgrade003ErrorCode =
  | 'CONFIG_INVALID'
  | 'MIGRATION_BUNDLE_INVALID'
  | 'YDB_CLIENT_CREATE_FAILED'
  | 'YDB_HEALTH_READ_FAILED'
  | 'YDB_ACCESS_DENIED'
  | 'YDB_PREFLIGHT_READ_FAILED'
  | 'PARTIAL_SCHEMA_STATE'
  | 'UNEXPECTED_MIGRATION_EVIDENCE'
  | 'MIGRATION_003_APPLY_FAILED'
  | 'MIGRATION_003_EVIDENCE_FAILED'
  | 'FINAL_READBACK_FAILED'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class YdbSchemaUpgrade003Error extends Error {
  readonly code: YdbSchemaUpgrade003ErrorCode;

  constructor(code: YdbSchemaUpgrade003ErrorCode) {
    super(code);
    this.name = 'YdbSchemaUpgrade003Error';
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

export function createYdbSchemaUpgrade003Migration(sql: string): Readonly<YdbSchemaUpgrade003Migration> {
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new YdbSchemaUpgrade003Error('MIGRATION_BUNDLE_INVALID');
  }
  let executable = withoutLeadingComments(sql);
  if (!executable.endsWith(';') || executable.slice(0, -1).includes(';')) {
    throw new YdbSchemaUpgrade003Error('MIGRATION_BUNDLE_INVALID');
  }
  executable = executable.slice(0, -1).trim();
  const normalized = executable.replace(/\s+/gu, ' ');
  if (normalized !== EXPECTED_MIGRATION_003) {
    throw new YdbSchemaUpgrade003Error('MIGRATION_BUNDLE_INVALID');
  }
  return Object.freeze({
    version: 3 as const,
    fileName: YDB_SCHEMA_UPGRADE_003_FILE,
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
  migration: Readonly<YdbSchemaUpgrade003Migration>,
): 2 | 3 {
  const expected = new Map<number, string>([
    [1, APPLIED_MIGRATION_CHECKSUMS[1]],
    [2, APPLIED_MIGRATION_CHECKSUMS[2]],
    [3, migration.checksum],
  ]);
  const seen = new Set<number>();
  for (const row of rows) {
    const version = migrationVersion(row.version);
    if (
      version < 1
      || version > 3
      || seen.has(version)
      || typeof row.checksum !== 'string'
      || row.checksum !== expected.get(version)
      || !validAppliedAt(row.applied_at)
    ) {
      throw new YdbSchemaUpgrade003Error('UNEXPECTED_MIGRATION_EVIDENCE');
    }
    seen.add(version);
  }
  if (seen.size === 2 && seen.has(1) && seen.has(2)) return 2;
  if (seen.size === 3 && seen.has(1) && seen.has(2) && seen.has(3)) return 3;
  throw new YdbSchemaUpgrade003Error('UNEXPECTED_MIGRATION_EVIDENCE');
}

async function readMigrationEvidence(
  client: Readonly<YdbSchemaUpgrade003Client>,
): Promise<readonly Readonly<MigrationEvidenceRow>[]> {
  const result = await client.execute<MigrationEvidenceRow>(readStatement(MIGRATION_LEDGER_QUERY));
  return result.rows;
}

async function manifestTableExists(client: Readonly<YdbSchemaUpgrade003Client>): Promise<boolean> {
  try {
    await client.execute(readStatement(MANIFEST_SCHEMA_PROBE));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    if (isUnauthorized(error)) throw new YdbSchemaUpgrade003Error('YDB_ACCESS_DENIED');
    throw new YdbSchemaUpgrade003Error('YDB_PREFLIGHT_READ_FAILED');
  }
}

function nowIso(clock: Readonly<YdbSchemaUpgrade003Clock>): string {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new YdbSchemaUpgrade003Error('MIGRATION_BUNDLE_INVALID');
  }
  return value.toISOString();
}

async function insertEvidence(
  client: Readonly<YdbSchemaUpgrade003Client>,
  migration: Readonly<YdbSchemaUpgrade003Migration>,
  appliedAt: string,
): Promise<void> {
  await client.execute(writeStatement(INSERT_MIGRATION_EVIDENCE, {
    '$version': uint64Parameter(3),
    '$checksum': stringParameter(migration.checksum),
    '$applied_at': timestampParameter(appliedAt),
  }));
}

async function assertFinalReadback(
  client: Readonly<YdbSchemaUpgrade003Client>,
  migration: Readonly<YdbSchemaUpgrade003Migration>,
): Promise<void> {
  if (classifyEvidence(await readMigrationEvidence(client), migration) !== 3) {
    throw new YdbSchemaUpgrade003Error('FINAL_READBACK_FAILED');
  }
  if (!await manifestTableExists(client)) {
    throw new YdbSchemaUpgrade003Error('FINAL_READBACK_FAILED');
  }
}

export async function runYdbSchemaUpgrade003(
  client: Readonly<YdbSchemaUpgrade003Client>,
  migration: Readonly<YdbSchemaUpgrade003Migration>,
  clock: Readonly<YdbSchemaUpgrade003Clock>,
): Promise<Readonly<YdbSchemaUpgrade003Result>> {
  try {
    await client.execute(readStatement('SELECT 1 AS schema_upgrade_003_health'));
  } catch (error) {
    if (isUnauthorized(error)) throw new YdbSchemaUpgrade003Error('YDB_ACCESS_DENIED');
    throw new YdbSchemaUpgrade003Error('YDB_HEALTH_READ_FAILED');
  }

  let evidenceVersion: 2 | 3;
  try {
    evidenceVersion = classifyEvidence(await readMigrationEvidence(client), migration);
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade003Error) throw error;
    if (isUnauthorized(error)) throw new YdbSchemaUpgrade003Error('YDB_ACCESS_DENIED');
    throw new YdbSchemaUpgrade003Error('YDB_PREFLIGHT_READ_FAILED');
  }

  const physicalPresent = await manifestTableExists(client);
  if (evidenceVersion === 2 && physicalPresent) {
    throw new YdbSchemaUpgrade003Error('PARTIAL_SCHEMA_STATE');
  }
  if (evidenceVersion === 3 && !physicalPresent) {
    throw new YdbSchemaUpgrade003Error('PARTIAL_SCHEMA_STATE');
  }

  if (evidenceVersion === 2) {
    try {
      await client.execute(writeStatement(migration.statement));
    } catch {
      throw new YdbSchemaUpgrade003Error('MIGRATION_003_APPLY_FAILED');
    }
    try {
      await insertEvidence(client, migration, nowIso(clock));
      if (classifyEvidence(await readMigrationEvidence(client), migration) !== 3) {
        throw new YdbSchemaUpgrade003Error('UNEXPECTED_MIGRATION_EVIDENCE');
      }
    } catch {
      throw new YdbSchemaUpgrade003Error('MIGRATION_003_EVIDENCE_FAILED');
    }
  }

  try {
    await assertFinalReadback(client, migration);
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade003Error && error.code === 'YDB_ACCESS_DENIED') throw error;
    throw new YdbSchemaUpgrade003Error('FINAL_READBACK_FAILED');
  }

  return Object.freeze({
    ydbSchema: 'READY' as const,
    appliedMigrationVersions: Object.freeze([1, 2, 3]) as readonly [1, 2, 3],
  });
}
