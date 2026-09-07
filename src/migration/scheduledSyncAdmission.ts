import type { MigrationRun } from './migrationRunState.js';

export type ScheduledSyncAdmissionDecision =
  | 'NO_CHANGE'
  | 'START_INCREMENTAL'
  | 'BOOTSTRAP_REQUIRED'
  | 'RECOVERY_REQUIRED';

export interface ScheduledSyncAdmissionInput {
  readonly observedSnapshotDigest: string;
  readonly committedBaselineRun: Readonly<MigrationRun> | null;
  readonly incompleteRuns: readonly Readonly<MigrationRun>[];
}

export interface ScheduledSyncAdmission {
  readonly decision: ScheduledSyncAdmissionDecision;
}

export type ScheduledSyncAdmissionErrorCode =
  | 'INVALID_OBSERVED_SNAPSHOT_DIGEST'
  | 'INVALID_COMMITTED_BASELINE'
  | 'INVALID_INCOMPLETE_RUN'
  | 'DUPLICATE_INCOMPLETE_RUN_ID';

export class ScheduledSyncAdmissionError extends Error {
  readonly code: ScheduledSyncAdmissionErrorCode;

  constructor(code: ScheduledSyncAdmissionErrorCode) {
    super(code);
    this.name = 'ScheduledSyncAdmissionError';
    this.code = code;
  }
}

function isCanonicalNonEmptyText(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function validateCommittedBaseline(run: Readonly<MigrationRun>): void {
  if (
    run.state !== 'COMMITTED'
    || run.finishedAt === null
    || run.errorCode !== null
    || !isCanonicalNonEmptyText(run.id)
    || !isCanonicalNonEmptyText(run.sourceSnapshotDigest)
  ) {
    throw new ScheduledSyncAdmissionError('INVALID_COMMITTED_BASELINE');
  }
}

function validateIncompleteRuns(runs: readonly Readonly<MigrationRun>[]): void {
  const ids = new Set<string>();
  for (const run of runs) {
    if (
      (run.state !== 'STAGING' && run.state !== 'VALIDATED')
      || run.finishedAt !== null
      || run.errorCode !== null
      || !isCanonicalNonEmptyText(run.id)
      || !isCanonicalNonEmptyText(run.sourceSnapshotDigest)
    ) {
      throw new ScheduledSyncAdmissionError('INVALID_INCOMPLETE_RUN');
    }
    if (ids.has(run.id)) {
      throw new ScheduledSyncAdmissionError('DUPLICATE_INCOMPLETE_RUN_ID');
    }
    ids.add(run.id);
  }
}

function decision(value: ScheduledSyncAdmissionDecision): Readonly<ScheduledSyncAdmission> {
  return Object.freeze({ decision: value });
}

export function evaluateScheduledSyncAdmission(
  input: Readonly<ScheduledSyncAdmissionInput>,
): Readonly<ScheduledSyncAdmission> {
  if (!isCanonicalNonEmptyText(input.observedSnapshotDigest)) {
    throw new ScheduledSyncAdmissionError('INVALID_OBSERVED_SNAPSHOT_DIGEST');
  }

  if (input.committedBaselineRun !== null) {
    validateCommittedBaseline(input.committedBaselineRun);
  }
  validateIncompleteRuns(input.incompleteRuns);

  if (input.incompleteRuns.length > 0) {
    return decision('RECOVERY_REQUIRED');
  }
  if (input.committedBaselineRun === null) {
    return decision('BOOTSTRAP_REQUIRED');
  }
  if (input.committedBaselineRun.sourceSnapshotDigest === input.observedSnapshotDigest) {
    return decision('NO_CHANGE');
  }
  return decision('START_INCREMENTAL');
}
