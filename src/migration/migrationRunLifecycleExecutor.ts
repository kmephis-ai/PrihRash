import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { uuidParameter } from '../integration/ydb/parameters.js';
import type { MigrationRun } from './migrationRunState.js';
import type { PreparedMigrationRunLifecycleWrite } from './migrationRunPersistence.js';

interface MigrationRunLifecycleReadRow {
  readonly state?: unknown;
  readonly finished_at?: unknown;
  readonly error_code?: unknown;
  readonly source_snapshot_digest?: unknown;
  readonly rows_seen?: unknown;
  readonly rows_new?: unknown;
  readonly rows_changed?: unknown;
  readonly rows_missing?: unknown;
  readonly rows_ambiguous?: unknown;
}

export type MigrationRunLifecycleExecutorErrorCode =
  | 'RUN_NOT_FOUND_AFTER_TRANSITION'
  | 'RUN_RESULT_AMBIGUOUS_AFTER_TRANSITION'
  | 'RUN_TRANSITION_EVIDENCE_MISMATCH';

export class MigrationRunLifecycleExecutorError extends Error {
  readonly code: MigrationRunLifecycleExecutorErrorCode;

  constructor(code: MigrationRunLifecycleExecutorErrorCode) {
    super(code);
    this.name = 'MigrationRunLifecycleExecutorError';
    this.code = code;
  }
}

function counterMatches(value: unknown, expected: number): boolean {
  if (!Number.isSafeInteger(expected) || expected < 0) return false;
  if (typeof value === 'bigint') return value === BigInt(expected);
  return typeof value === 'number' && Number.isSafeInteger(value) && value === expected;
}

function nullableTextMatches(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : value === expected;
}

function rowMatches(row: MigrationRunLifecycleReadRow, expected: MigrationRun): boolean {
  return (
    row.state === expected.state
    && nullableTextMatches(row.finished_at, expected.finishedAt)
    && nullableTextMatches(row.error_code, expected.errorCode)
    && row.source_snapshot_digest === expected.sourceSnapshotDigest
    && counterMatches(row.rows_seen, expected.rowsSeen)
    && counterMatches(row.rows_new, expected.rowsNew)
    && counterMatches(row.rows_changed, expected.rowsChanged)
    && counterMatches(row.rows_missing, expected.rowsMissing)
    && counterMatches(row.rows_ambiguous, expected.rowsAmbiguous)
  );
}

export async function executeMigrationRunLifecycleWrite(
  adapter: YdbAdapter,
  prepared: PreparedMigrationRunLifecycleWrite,
  expectedRun: MigrationRun,
): Promise<Readonly<MigrationRun>> {
  const readBack = readStatement(
    'SELECT state, finished_at, error_code, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, '
      + 'rows_seen, rows_new, rows_changed, rows_missing, rows_ambiguous FROM migration_runs WHERE id = $id',
    { id: uuidParameter(expectedRun.id) },
  );

  await adapter.serializableReadWrite(async (transaction) => {
    await transaction.execute(prepared.statement);
    const result = await transaction.execute<MigrationRunLifecycleReadRow>(readBack);
    if (result.rows.length === 0) {
      throw new MigrationRunLifecycleExecutorError('RUN_NOT_FOUND_AFTER_TRANSITION');
    }
    if (result.rows.length !== 1) {
      throw new MigrationRunLifecycleExecutorError('RUN_RESULT_AMBIGUOUS_AFTER_TRANSITION');
    }
    const row = result.rows[0];
    if (row === undefined || !rowMatches(row, expectedRun)) {
      throw new MigrationRunLifecycleExecutorError('RUN_TRANSITION_EVIDENCE_MISMATCH');
    }
  });

  return Object.freeze({ ...expectedRun });
}
