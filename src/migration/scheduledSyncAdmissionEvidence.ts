import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import type { MigrationRun, MigrationRunState } from './migrationRunState.js';

export interface ScheduledSyncAdmissionEvidence {
  readonly committedBaselineRun: Readonly<MigrationRun> | null;
  readonly incompleteRuns: readonly Readonly<MigrationRun>[];
}

interface MigrationRunEvidenceRow {
  readonly id?: unknown;
  readonly started_at?: unknown;
  readonly finished_at?: unknown;
  readonly source_snapshot_digest?: unknown;
  readonly state?: unknown;
  readonly rows_seen?: unknown;
  readonly rows_new?: unknown;
  readonly rows_changed?: unknown;
  readonly rows_missing?: unknown;
  readonly rows_ambiguous?: unknown;
  readonly error_code?: unknown;
}

export type ScheduledSyncAdmissionEvidenceErrorCode =
  | 'MALFORMED_RUN_EVIDENCE'
  | 'DUPLICATE_RUN_EVIDENCE';

export class ScheduledSyncAdmissionEvidenceError extends Error {
  readonly code: ScheduledSyncAdmissionEvidenceErrorCode;

  constructor(code: ScheduledSyncAdmissionEvidenceErrorCode) {
    super(code);
    this.name = 'ScheduledSyncAdmissionEvidenceError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RELEVANT_STATES = new Set<MigrationRunState>(['COMMITTED', 'STAGING', 'VALIDATED']);

function counter(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
    }
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
}

function timestamp(value: unknown, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
  }
  return value;
}

function parseRow(row: MigrationRunEvidenceRow): Readonly<MigrationRun> {
  if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)) {
    throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
  }
  if (typeof row.state !== 'string' || !RELEVANT_STATES.has(row.state as MigrationRunState)) {
    throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
  }
  if (
    typeof row.source_snapshot_digest !== 'string'
    || row.source_snapshot_digest.length === 0
    || row.source_snapshot_digest !== row.source_snapshot_digest.trim()
  ) {
    throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
  }

  const state = row.state as MigrationRunState;
  const startedAt = timestamp(row.started_at, false);
  const finishedAt = timestamp(row.finished_at, true);
  if (startedAt === null) throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');

  if (state === 'COMMITTED') {
    if (finishedAt === null || row.error_code !== null) {
      throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
    }
  } else if (finishedAt !== null || row.error_code !== null) {
    throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
  }

  return Object.freeze({
    id: row.id.toLowerCase(),
    startedAt,
    finishedAt,
    sourceSnapshotDigest: row.source_snapshot_digest,
    state,
    rowsSeen: counter(row.rows_seen),
    rowsNew: counter(row.rows_new),
    rowsChanged: counter(row.rows_changed),
    rowsMissing: counter(row.rows_missing),
    rowsAmbiguous: counter(row.rows_ambiguous),
    errorCode: null,
  });
}

function compareCommitted(left: Readonly<MigrationRun>, right: Readonly<MigrationRun>): number {
  const leftFinished = Date.parse(left.finishedAt ?? '');
  const rightFinished = Date.parse(right.finishedAt ?? '');
  if (leftFinished !== rightFinished) return leftFinished - rightFinished;

  const leftStarted = Date.parse(left.startedAt);
  const rightStarted = Date.parse(right.startedAt);
  if (leftStarted !== rightStarted) return leftStarted - rightStarted;
  return left.id.localeCompare(right.id);
}

export async function readScheduledSyncAdmissionEvidence(
  adapter: YdbAdapter,
): Promise<Readonly<ScheduledSyncAdmissionEvidence>> {
  const statement = readStatement(
    "SELECT id, started_at, finished_at, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, "
      + "state, rows_seen, rows_new, rows_changed, rows_missing, rows_ambiguous, error_code "
      + "FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')",
  );
  const result = await adapter.read<MigrationRunEvidenceRow>(statement);

  const seen = new Set<string>();
  const committed: Readonly<MigrationRun>[] = [];
  const incomplete: Readonly<MigrationRun>[] = [];
  for (const row of result.rows) {
    const run = parseRow(row);
    if (seen.has(run.id)) {
      throw new ScheduledSyncAdmissionEvidenceError('DUPLICATE_RUN_EVIDENCE');
    }
    seen.add(run.id);
    if (run.state === 'COMMITTED') committed.push(run);
    else incomplete.push(run);
  }

  committed.sort(compareCommitted);
  incomplete.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));

  return Object.freeze({
    committedBaselineRun: committed.at(-1) ?? null,
    incompleteRuns: Object.freeze(incomplete),
  });
}
