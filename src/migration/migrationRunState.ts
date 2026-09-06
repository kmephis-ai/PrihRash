export type MigrationRunState = 'STAGING' | 'VALIDATED' | 'COMMITTED' | 'FAILED';

export interface MigrationRunCounters {
  readonly rowsSeen: number;
  readonly rowsNew: number;
  readonly rowsChanged: number;
  readonly rowsMissing: number;
  readonly rowsAmbiguous: number;
}

export interface MigrationRun {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly sourceSnapshotDigest: string;
  readonly state: MigrationRunState;
  readonly rowsSeen: number;
  readonly rowsNew: number;
  readonly rowsChanged: number;
  readonly rowsMissing: number;
  readonly rowsAmbiguous: number;
  readonly errorCode: string | null;
}

export interface CreateMigrationRunInput {
  readonly id: string;
  readonly startedAt: string;
  readonly sourceSnapshotDigest: string;
  readonly counters: MigrationRunCounters;
}

export type MigrationRunStateErrorCode = 'ILLEGAL_MIGRATION_RUN_TRANSITION';

export class MigrationRunStateError extends Error {
  readonly code: MigrationRunStateErrorCode;
  readonly from: MigrationRunState;
  readonly to: MigrationRunState;

  constructor(from: MigrationRunState, to: MigrationRunState) {
    super(`ILLEGAL_MIGRATION_RUN_TRANSITION:${from}->${to}`);
    this.name = 'MigrationRunStateError';
    this.code = 'ILLEGAL_MIGRATION_RUN_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

function freezeRun(run: MigrationRun): Readonly<MigrationRun> {
  return Object.freeze(run);
}

function transition(
  run: MigrationRun,
  allowedFrom: readonly MigrationRunState[],
  to: MigrationRunState,
  finishedAt: string | null,
  errorCode: string | null,
): Readonly<MigrationRun> {
  if (!allowedFrom.includes(run.state)) {
    throw new MigrationRunStateError(run.state, to);
  }

  return freezeRun({
    ...run,
    state: to,
    finishedAt,
    errorCode,
  });
}

export function createMigrationRun(input: CreateMigrationRunInput): Readonly<MigrationRun> {
  return freezeRun({
    id: input.id,
    startedAt: input.startedAt,
    finishedAt: null,
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: 'STAGING',
    rowsSeen: input.counters.rowsSeen,
    rowsNew: input.counters.rowsNew,
    rowsChanged: input.counters.rowsChanged,
    rowsMissing: input.counters.rowsMissing,
    rowsAmbiguous: input.counters.rowsAmbiguous,
    errorCode: null,
  });
}

export function markMigrationRunValidated(run: MigrationRun): Readonly<MigrationRun> {
  return transition(run, ['STAGING'], 'VALIDATED', null, null);
}

export function markMigrationRunCommitted(
  run: MigrationRun,
  finishedAt: string,
): Readonly<MigrationRun> {
  return transition(run, ['VALIDATED'], 'COMMITTED', finishedAt, null);
}

export function markMigrationRunFailed(
  run: MigrationRun,
  finishedAt: string,
  errorCode: string | null,
): Readonly<MigrationRun> {
  return transition(run, ['STAGING', 'VALIDATED'], 'FAILED', finishedAt, errorCode);
}

export function isVerifiedShadowEligible(run: MigrationRun): boolean {
  return run.state === 'COMMITTED';
}
