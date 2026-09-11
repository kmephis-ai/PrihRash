import { StatusIds_StatusCode } from '@ydbjs/api/operation';

import { createCanonicalSourceDigest, type CanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import { FullSourceSnapshotError } from '../integration/google/fullSourceSnapshot.js';
import {
  GoogleSheetsFullSnapshotReader,
  GoogleSheetsFullSnapshotReaderError,
  type GoogleSheetsImmutableSnapshot,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import {
  createGoogleServiceAccountSheetsAccessTokenProvider,
  GoogleServiceAccountTokenProviderError,
} from '../integration/google/googleServiceAccountTokenProvider.js';
import { SourceValueCodecError } from '../integration/google/sourceValueCodec.js';
import { readStatement, YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import type { AuthoritativeFullSnapshotLeaseReader } from '../migration/scheduledSyncInvocation.js';
import {
  readScheduledSyncJobConfig,
  type ScheduledSyncJobConfig,
  type ScheduledSyncJobEnvironment,
} from './scheduledSyncJob.js';

export const REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION = 3 as const;

export interface ScheduledSyncReadinessResult {
  readonly googleSource: 'READY';
  readonly ydbSchema: 'READY';
  readonly requiredMigrationVersion: typeof REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION;
}

export interface ScheduledSyncReadinessYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface ScheduledSyncReadinessRuntime {
  createSource(
    config: Readonly<ScheduledSyncJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): AuthoritativeFullSnapshotLeaseReader<GoogleSheetsImmutableSnapshot>;
  createYdbClient(config: Readonly<ScheduledSyncJobConfig>): Promise<Readonly<ScheduledSyncReadinessYdbClient>>;
}

export type ScheduledSyncReadinessErrorCode =
  | 'CONFIG_INVALID'
  | 'GOOGLE_SPREADSHEET_ID_INVALID'
  | 'GOOGLE_CREDENTIALS_INVALID'
  | 'GOOGLE_TOKEN_ACQUISITION_FAILED'
  | 'GOOGLE_SHEETS_ACCESS_FAILED'
  | 'GOOGLE_SHEETS_RESPONSE_INVALID'
  | 'GOOGLE_SOURCE_METADATA_MISMATCH'
  | 'GOOGLE_SOURCE_SHEET_MISSING'
  | 'GOOGLE_SOURCE_SCHEMA_MISMATCH'
  | 'GOOGLE_SOURCE_VALUE_UNSUPPORTED'
  | 'GOOGLE_SOURCE_READ_FAILED'
  | 'YDB_CLIENT_CREATE_FAILED'
  | 'YDB_QUERY_HEALTH_READ_FAILED'
  | 'YDB_MIGRATION_TABLE_RESOLUTION_FAILED'
  | 'YDB_MIGRATION_TABLE_ACCESS_DENIED'
  | 'YDB_MIGRATION_TABLE_READ_FAILED'
  | 'YDB_MIGRATION_SCHEMA_READ_FAILED'
  | 'YDB_MIGRATION_EVIDENCE_READ_FAILED'
  | 'YDB_ACCOUNTS_SCHEMA_READ_FAILED'
  | 'YDB_CATEGORIES_SCHEMA_READ_FAILED'
  | 'YDB_INITIAL_BOOTSTRAP_IDENTITY_MANIFEST_SCHEMA_READ_FAILED'
  | 'MALFORMED_SCHEMA_MIGRATION_EVIDENCE'
  | 'MISSING_REQUIRED_SCHEMA_MIGRATION'
  | 'UNEXPECTED_SCHEMA_MIGRATION'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class ScheduledSyncReadinessError extends Error {
  readonly code: ScheduledSyncReadinessErrorCode;

  constructor(code: ScheduledSyncReadinessErrorCode) {
    super(code);
    this.name = 'ScheduledSyncReadinessError';
    this.code = code;
  }
}

function classifyGoogleSourceFailure(error: unknown): ScheduledSyncReadinessError {
  if (error instanceof GoogleServiceAccountTokenProviderError) {
    switch (error.code) {
      case 'INVALID_SERVICE_ACCOUNT_EMAIL':
      case 'INVALID_SERVICE_ACCOUNT_PRIVATE_KEY':
        return new ScheduledSyncReadinessError('GOOGLE_CREDENTIALS_INVALID');
      case 'TOKEN_ACQUISITION_FAILED':
      case 'INVALID_ACCESS_TOKEN':
        return new ScheduledSyncReadinessError('GOOGLE_TOKEN_ACQUISITION_FAILED');
    }
  }

  if (error instanceof GoogleSheetsFullSnapshotReaderError) {
    switch (error.code) {
      case 'INVALID_SPREADSHEET_ID':
        return new ScheduledSyncReadinessError('GOOGLE_SPREADSHEET_ID_INVALID');
      case 'INVALID_ACCESS_TOKEN':
        return new ScheduledSyncReadinessError('GOOGLE_TOKEN_ACQUISITION_FAILED');
      case 'GOOGLE_SHEETS_HTTP_ERROR':
        return new ScheduledSyncReadinessError('GOOGLE_SHEETS_ACCESS_FAILED');
      case 'GOOGLE_SHEETS_RESPONSE_INVALID':
        return new ScheduledSyncReadinessError('GOOGLE_SHEETS_RESPONSE_INVALID');
      case 'SOURCE_METADATA_MISMATCH':
        return new ScheduledSyncReadinessError('GOOGLE_SOURCE_METADATA_MISMATCH');
      case 'SOURCE_SHEET_MISSING':
        return new ScheduledSyncReadinessError('GOOGLE_SOURCE_SHEET_MISSING');
    }
  }

  if (error instanceof FullSourceSnapshotError) {
    switch (error.code) {
      case 'SOURCE_SCHEMA_MISMATCH':
      case 'SOURCE_ROW_WIDTH_MISMATCH':
        return new ScheduledSyncReadinessError('GOOGLE_SOURCE_SCHEMA_MISMATCH');
      case 'INVALID_SNAPSHOT_DIGEST':
        break;
    }
  }

  if (error instanceof SourceValueCodecError) {
    return new ScheduledSyncReadinessError('GOOGLE_SOURCE_VALUE_UNSUPPORTED');
  }

  return new ScheduledSyncReadinessError('GOOGLE_SOURCE_READ_FAILED');
}

interface SchemaMigrationEvidenceRow {
  readonly version?: unknown;
  readonly checksum?: unknown;
  readonly applied_at?: unknown;
}

function migrationVersion(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ScheduledSyncReadinessError('MALFORMED_SCHEMA_MIGRATION_EVIDENCE');
    }
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new ScheduledSyncReadinessError('MALFORMED_SCHEMA_MIGRATION_EVIDENCE');
}

function ydbProviderStatus(error: unknown): unknown {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return null;
  return Reflect.get(error, 'code');
}

function classifyMigrationTableReadFailure(error: unknown): ScheduledSyncReadinessError {
  const status = ydbProviderStatus(error);
  if (status === StatusIds_StatusCode.SCHEME_ERROR || status === StatusIds_StatusCode.NOT_FOUND) {
    return new ScheduledSyncReadinessError('YDB_MIGRATION_TABLE_RESOLUTION_FAILED');
  }
  if (status === StatusIds_StatusCode.UNAUTHORIZED) {
    return new ScheduledSyncReadinessError('YDB_MIGRATION_TABLE_ACCESS_DENIED');
  }
  return new ScheduledSyncReadinessError('YDB_MIGRATION_TABLE_READ_FAILED');
}

function validSchemaMigrationAppliedAt(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function validateSchemaMigrationEvidence(rows: readonly Readonly<SchemaMigrationEvidenceRow>[]): void {
  const seen = new Set<number>();
  for (const row of rows) {
    const version = migrationVersion(row.version);
    if (seen.has(version)) {
      throw new ScheduledSyncReadinessError('MALFORMED_SCHEMA_MIGRATION_EVIDENCE');
    }
    seen.add(version);

    if (
      typeof row.checksum !== 'string'
      || row.checksum.length === 0
      || row.checksum !== row.checksum.trim()
      || !validSchemaMigrationAppliedAt(row.applied_at)
    ) {
      throw new ScheduledSyncReadinessError('MALFORMED_SCHEMA_MIGRATION_EVIDENCE');
    }

    if (version < 1 || version > REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION) {
      throw new ScheduledSyncReadinessError('UNEXPECTED_SCHEMA_MIGRATION');
    }
  }

  for (let version = 1; version <= REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION; version += 1) {
    if (!seen.has(version)) {
      throw new ScheduledSyncReadinessError('MISSING_REQUIRED_SCHEMA_MIGRATION');
    }
  }
}

export async function runScheduledSyncReadinessProbe(
  source: AuthoritativeFullSnapshotLeaseReader<GoogleSheetsImmutableSnapshot>,
  adapter: YdbAdapter,
): Promise<Readonly<ScheduledSyncReadinessResult>> {
  try {
    await source.readFullSnapshotObservation();
  } catch (error) {
    throw classifyGoogleSourceFailure(error);
  }

  try {
    await adapter.read(readStatement('SELECT 1 AS readiness_probe'));
  } catch {
    throw new ScheduledSyncReadinessError('YDB_QUERY_HEALTH_READ_FAILED');
  }

  try {
    await adapter.read(readStatement(
      'SELECT version, checksum, applied_at FROM schema_migrations LIMIT 0',
    ));
  } catch {
    try {
      await adapter.read(readStatement(
        'SELECT 1 AS readiness_table_probe FROM schema_migrations LIMIT 0',
      ));
    } catch (error) {
      throw classifyMigrationTableReadFailure(error);
    }
    throw new ScheduledSyncReadinessError('YDB_MIGRATION_SCHEMA_READ_FAILED');
  }

  let migrationEvidence;
  try {
    migrationEvidence = await adapter.read<SchemaMigrationEvidenceRow>(readStatement(
      'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC',
    ));
  } catch {
    throw new ScheduledSyncReadinessError('YDB_MIGRATION_EVIDENCE_READ_FAILED');
  }
  validateSchemaMigrationEvidence(migrationEvidence.rows);

  try {
    await adapter.read(readStatement('SELECT normalized_source_label FROM accounts LIMIT 0'));
  } catch {
    throw new ScheduledSyncReadinessError('YDB_ACCOUNTS_SCHEMA_READ_FAILED');
  }

  try {
    await adapter.read(readStatement('SELECT normalized_source_label FROM categories LIMIT 0'));
  } catch {
    throw new ScheduledSyncReadinessError('YDB_CATEGORIES_SCHEMA_READ_FAILED');
  }

  try {
    await adapter.read(readStatement(
      'SELECT migration_run_id, source_snapshot_id, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, binding_count, bindings FROM initial_bootstrap_identity_manifests LIMIT 0',
    ));
  } catch {
    throw new ScheduledSyncReadinessError('YDB_INITIAL_BOOTSTRAP_IDENTITY_MANIFEST_SCHEMA_READ_FAILED');
  }

  return Object.freeze({
    googleSource: 'READY' as const,
    ydbSchema: 'READY' as const,
    requiredMigrationVersion: REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION,
  });
}

const productionRuntime: Readonly<ScheduledSyncReadinessRuntime> = Object.freeze({
  createSource(
    config: Readonly<ScheduledSyncJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): AuthoritativeFullSnapshotLeaseReader<GoogleSheetsImmutableSnapshot> {
    const accessTokenProvider = createGoogleServiceAccountSheetsAccessTokenProvider({
      clientEmail: config.googleServiceAccountEmail,
      privateKey: config.googleServiceAccountPrivateKey,
    });
    return new GoogleSheetsFullSnapshotReader({
      spreadsheetId: config.spreadsheetId,
      fetch: async (input, init) => fetch(input, init),
      accessTokenProvider,
      digest,
    });
  },
  createYdbClient(config: Readonly<ScheduledSyncJobConfig>): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
});

export async function executeScheduledSyncReadinessProbe(
  config: Readonly<ScheduledSyncJobConfig>,
  runtime: Readonly<ScheduledSyncReadinessRuntime>,
): Promise<Readonly<ScheduledSyncReadinessResult>> {
  const digest = createCanonicalSourceDigest();
  let source: AuthoritativeFullSnapshotLeaseReader<GoogleSheetsImmutableSnapshot>;
  try {
    source = runtime.createSource(config, digest);
  } catch (error) {
    throw classifyGoogleSourceFailure(error);
  }

  let ydbClient: Readonly<ScheduledSyncReadinessYdbClient>;
  try {
    ydbClient = await runtime.createYdbClient(config);
  } catch {
    throw new ScheduledSyncReadinessError('YDB_CLIENT_CREATE_FAILED');
  }
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    return await runScheduledSyncReadinessProbe(source, adapter);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) {
        throw new ScheduledSyncReadinessError('YDB_CLIENT_CLOSE_FAILED');
      }
    }
  }
}

export function runScheduledSyncReadinessProbeFromEnvironment(
  environment: ScheduledSyncJobEnvironment = process.env,
): Promise<Readonly<ScheduledSyncReadinessResult>> {
  let config: Readonly<ScheduledSyncJobConfig>;
  try {
    config = readScheduledSyncJobConfig(environment);
  } catch {
    return Promise.reject(new ScheduledSyncReadinessError('CONFIG_INVALID'));
  }
  return executeScheduledSyncReadinessProbe(config, productionRuntime);
}
