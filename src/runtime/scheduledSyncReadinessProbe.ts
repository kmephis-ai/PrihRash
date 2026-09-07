import { createCanonicalSourceDigest, type CanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsImmutableSnapshot,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
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

export const REQUIRED_SCHEDULED_SYNC_SCHEMA_VERSION = 2 as const;

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
      || typeof row.applied_at !== 'string'
      || row.applied_at.length === 0
      || row.applied_at !== row.applied_at.trim()
      || !Number.isFinite(Date.parse(row.applied_at))
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
  await source.readFullSnapshotObservation();

  const migrationEvidence = await adapter.read<SchemaMigrationEvidenceRow>(readStatement(
    'SELECT version, CAST(checksum AS Utf8) AS checksum, applied_at FROM schema_migrations ORDER BY version ASC',
  ));
  validateSchemaMigrationEvidence(migrationEvidence.rows);

  await adapter.read(readStatement('SELECT normalized_source_label FROM accounts LIMIT 0'));
  await adapter.read(readStatement('SELECT normalized_source_label FROM categories LIMIT 0'));

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
  const source = runtime.createSource(config, digest);
  const ydbClient = await runtime.createYdbClient(config);
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
  const config = readScheduledSyncJobConfig(environment);
  return executeScheduledSyncReadinessProbe(config, productionRuntime);
}
