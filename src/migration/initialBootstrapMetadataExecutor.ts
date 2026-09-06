import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { uuidParameter } from '../integration/ydb/parameters.js';
import type { InitialBootstrapCandidateEnvelope } from './initialBootstrapCandidate.js';
import type { PreparedBootstrapMetadataWrite } from './initialBootstrapPersistence.js';

interface SnapshotReadRow {
  readonly captured_at?: unknown;
  readonly source_sheet?: unknown;
  readonly snapshot_digest?: unknown;
  readonly row_count?: unknown;
}

interface RunReadRow {
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

export type InitialBootstrapMetadataExecutorErrorCode =
  | 'METADATA_WRITE_SET_INVALID'
  | 'SNAPSHOT_READBACK_MISMATCH'
  | 'RUN_READBACK_MISMATCH';

export class InitialBootstrapMetadataExecutorError extends Error {
  readonly code: InitialBootstrapMetadataExecutorErrorCode;

  constructor(code: InitialBootstrapMetadataExecutorErrorCode) {
    super(code);
    this.name = 'InitialBootstrapMetadataExecutorError';
    this.code = code;
  }
}

function counterMatches(value: unknown, expected: number): boolean {
  if (typeof value === 'bigint') return value === BigInt(expected);
  return typeof value === 'number' && Number.isSafeInteger(value) && value === expected;
}

function validateWriteSet(writes: readonly PreparedBootstrapMetadataWrite[]): void {
  if (
    writes.length !== 2
    || writes[0]?.role !== 'SNAPSHOT_EVIDENCE'
    || writes[1]?.role !== 'RUN_STAGING'
  ) {
    throw new InitialBootstrapMetadataExecutorError('METADATA_WRITE_SET_INVALID');
  }
}

function snapshotMatches(row: SnapshotReadRow, candidate: InitialBootstrapCandidateEnvelope): boolean {
  return row.captured_at === candidate.snapshot.capturedAt
    && row.source_sheet === candidate.snapshot.sourceSheet
    && row.snapshot_digest === candidate.snapshot.snapshotDigest
    && counterMatches(row.row_count, candidate.snapshot.rowCount);
}

function runMatches(row: RunReadRow, candidate: InitialBootstrapCandidateEnvelope): boolean {
  const run = candidate.run;
  return row.started_at === run.startedAt
    && row.finished_at === run.finishedAt
    && row.source_snapshot_digest === run.sourceSnapshotDigest
    && row.state === 'STAGING'
    && counterMatches(row.rows_seen, run.rowsSeen)
    && counterMatches(row.rows_new, run.rowsNew)
    && counterMatches(row.rows_changed, run.rowsChanged)
    && counterMatches(row.rows_missing, run.rowsMissing)
    && counterMatches(row.rows_ambiguous, run.rowsAmbiguous)
    && row.error_code === null;
}

export async function executeInitialBootstrapMetadataWrites(
  adapter: YdbAdapter,
  candidate: InitialBootstrapCandidateEnvelope,
  writes: readonly PreparedBootstrapMetadataWrite[],
): Promise<void> {
  validateWriteSet(writes);
  const snapshotWrite = writes[0];
  const runWrite = writes[1];
  if (snapshotWrite === undefined || runWrite === undefined) {
    throw new InitialBootstrapMetadataExecutorError('METADATA_WRITE_SET_INVALID');
  }

  const snapshotRead = readStatement(
    'SELECT captured_at, source_sheet, CAST(snapshot_digest AS Utf8) AS snapshot_digest, row_count '
      + 'FROM source_snapshots WHERE id = $id',
    { id: uuidParameter(candidate.snapshot.id) },
  );
  const runRead = readStatement(
    'SELECT started_at, finished_at, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, state, '
      + 'rows_seen, rows_new, rows_changed, rows_missing, rows_ambiguous, error_code '
      + 'FROM migration_runs WHERE id = $id',
    { id: uuidParameter(candidate.run.id) },
  );

  await adapter.serializableReadWrite(async (transaction) => {
    await transaction.execute(snapshotWrite.statement);
    await transaction.execute(runWrite.statement);

    const snapshotResult = await transaction.execute<SnapshotReadRow>(snapshotRead);
    if (snapshotResult.rows.length !== 1 || !snapshotMatches(snapshotResult.rows[0] ?? {}, candidate)) {
      throw new InitialBootstrapMetadataExecutorError('SNAPSHOT_READBACK_MISMATCH');
    }

    const runResult = await transaction.execute<RunReadRow>(runRead);
    if (runResult.rows.length !== 1 || !runMatches(runResult.rows[0] ?? {}, candidate)) {
      throw new InitialBootstrapMetadataExecutorError('RUN_READBACK_MISMATCH');
    }
  });
}
