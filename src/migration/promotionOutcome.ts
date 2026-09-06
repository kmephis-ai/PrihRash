import {
  readStatement,
  YdbAdapter,
} from '../integration/ydb/adapter.js';
import { uuidParameter } from '../integration/ydb/parameters.js';
import type { MigrationRun } from './migrationRunState.js';

interface MigrationRunReadRow {
  readonly state?: unknown;
  readonly source_snapshot_digest?: unknown;
  readonly rows_seen?: unknown;
  readonly rows_new?: unknown;
  readonly rows_changed?: unknown;
  readonly rows_missing?: unknown;
  readonly rows_ambiguous?: unknown;
}

export type UnknownPromotionResolution =
  | Readonly<{
      status: 'COMMITTED_CONFIRMED';
      observedState: 'COMMITTED';
    }>
  | Readonly<{
      status: 'UNRESOLVED';
      reason: 'RUN_NOT_FOUND' | 'RUN_RESULT_AMBIGUOUS' | 'RUN_EVIDENCE_MISMATCH' | 'RUN_NOT_COMMITTED';
      observedState: string | null;
    }>;

function observedCounterMatches(value: unknown, expected: number): boolean {
  if (!Number.isSafeInteger(expected) || expected < 0) return false;
  if (typeof value === 'bigint') return value === BigInt(expected);
  return typeof value === 'number' && Number.isSafeInteger(value) && value === expected;
}

function evidenceMatches(row: MigrationRunReadRow, run: MigrationRun): boolean {
  return (
    row.source_snapshot_digest === run.sourceSnapshotDigest
    && observedCounterMatches(row.rows_seen, run.rowsSeen)
    && observedCounterMatches(row.rows_new, run.rowsNew)
    && observedCounterMatches(row.rows_changed, run.rowsChanged)
    && observedCounterMatches(row.rows_missing, run.rowsMissing)
    && observedCounterMatches(row.rows_ambiguous, run.rowsAmbiguous)
  );
}

export async function resolveUnknownPromotionOutcome(
  adapter: YdbAdapter,
  run: MigrationRun,
): Promise<UnknownPromotionResolution> {
  const statement = readStatement(
    'SELECT state, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, '
      + 'rows_seen, rows_new, rows_changed, rows_missing, rows_ambiguous '
      + 'FROM migration_runs WHERE id = $id',
    { id: uuidParameter(run.id) },
  );

  const result = await adapter.read<MigrationRunReadRow>(statement);
  if (result.rows.length === 0) {
    return Object.freeze({
      status: 'UNRESOLVED' as const,
      reason: 'RUN_NOT_FOUND' as const,
      observedState: null,
    });
  }
  if (result.rows.length !== 1) {
    return Object.freeze({
      status: 'UNRESOLVED' as const,
      reason: 'RUN_RESULT_AMBIGUOUS' as const,
      observedState: null,
    });
  }

  const row = result.rows[0] as MigrationRunReadRow;
  const observedState = typeof row.state === 'string' ? row.state : null;
  if (!evidenceMatches(row, run)) {
    return Object.freeze({
      status: 'UNRESOLVED' as const,
      reason: 'RUN_EVIDENCE_MISMATCH' as const,
      observedState,
    });
  }

  if (observedState === 'COMMITTED') {
    return Object.freeze({
      status: 'COMMITTED_CONFIRMED' as const,
      observedState: 'COMMITTED' as const,
    });
  }

  return Object.freeze({
    status: 'UNRESOLVED' as const,
    reason: 'RUN_NOT_COMMITTED' as const,
    observedState,
  });
}
