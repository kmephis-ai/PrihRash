import type { InitialSnapshotProjection } from './initialSnapshotProjection.js';
import type { MigrationRun } from './migrationRunState.js';

export type InitialRunCounterRefinementErrorCode =
  | 'RUN_NOT_STAGING'
  | 'INITIAL_COUNTERS_INCONSISTENT'
  | 'PROJECTION_ROW_COUNT_MISMATCH';

export class InitialRunCounterRefinementError extends Error {
  readonly code: InitialRunCounterRefinementErrorCode;

  constructor(code: InitialRunCounterRefinementErrorCode) {
    super(code);
    this.name = 'InitialRunCounterRefinementError';
    this.code = code;
  }
}

export function refineInitialRunCounters(
  run: MigrationRun,
  projection: Readonly<InitialSnapshotProjection>,
): Readonly<MigrationRun> {
  if (run.state !== 'STAGING' || run.finishedAt !== null || run.errorCode !== null) {
    throw new InitialRunCounterRefinementError('RUN_NOT_STAGING');
  }
  if (
    run.rowsSeen !== run.rowsNew
    || run.rowsChanged !== 0
    || run.rowsMissing !== 0
  ) {
    throw new InitialRunCounterRefinementError('INITIAL_COUNTERS_INCONSISTENT');
  }
  if (run.rowsSeen !== projection.counters.rowsSeen) {
    throw new InitialRunCounterRefinementError('PROJECTION_ROW_COUNT_MISMATCH');
  }

  return Object.freeze({
    ...run,
    rowsAmbiguous: projection.counters.ambiguous,
  });
}
