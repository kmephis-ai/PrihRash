import {
  type YdbParameter,
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import {
  readStatement,
  writeStatement,
  YdbAdapter,
} from '../integration/ydb/adapter.js';
import type { MigrationRun } from './migrationRunState.js';
import {
  type MigrationRunEvidenceRow,
  parseScheduledSyncAdmissionEvidence,
  scheduledSyncAdmissionEvidenceStatement,
} from './scheduledSyncAdmissionEvidence.js';

export type ScheduledIncrementalRunClaimErrorCode =
  | 'EXPECTED_BASELINE_NOT_COMMITTED'
  | 'CANDIDATE_NOT_STAGING'
  | 'CANDIDATE_NOT_INCREMENTAL'
  | 'IN_FLIGHT_RUN_EXISTS'
  | 'BASELINE_CHANGED'
  | 'CLAIM_READBACK_MISMATCH';

export class ScheduledIncrementalRunClaimError extends Error {
  readonly code: ScheduledIncrementalRunClaimErrorCode;

  constructor(code: ScheduledIncrementalRunClaimErrorCode) {
    super(code);
    this.name = 'ScheduledIncrementalRunClaimError';
    this.code = code;
  }
}

function countersValid(run: Readonly<MigrationRun>): boolean {
  return [run.rowsSeen, run.rowsNew, run.rowsChanged, run.rowsMissing, run.rowsAmbiguous]
    .every((value) => Number.isSafeInteger(value) && value >= 0);
}

function validateExpectedBaseline(run: Readonly<MigrationRun>): void {
  if (
    run.state !== 'COMMITTED'
    || run.finishedAt === null
    || run.errorCode !== null
    || !countersValid(run)
  ) {
    throw new ScheduledIncrementalRunClaimError('EXPECTED_BASELINE_NOT_COMMITTED');
  }
}

function validateCandidate(candidate: Readonly<MigrationRun>, expectedBaseline: Readonly<MigrationRun>): void {
  if (
    candidate.state !== 'STAGING'
    || candidate.finishedAt !== null
    || candidate.errorCode !== null
    || !countersValid(candidate)
  ) {
    throw new ScheduledIncrementalRunClaimError('CANDIDATE_NOT_STAGING');
  }
  if (candidate.sourceSnapshotDigest === expectedBaseline.sourceSnapshotDigest) {
    throw new ScheduledIncrementalRunClaimError('CANDIDATE_NOT_INCREMENTAL');
  }
}

function sameRun(left: Readonly<MigrationRun>, right: Readonly<MigrationRun>): boolean {
  return (
    left.id === right.id
    && left.startedAt === right.startedAt
    && left.finishedAt === right.finishedAt
    && left.sourceSnapshotDigest === right.sourceSnapshotDigest
    && left.state === right.state
    && left.rowsSeen === right.rowsSeen
    && left.rowsNew === right.rowsNew
    && left.rowsChanged === right.rowsChanged
    && left.rowsMissing === right.rowsMissing
    && left.rowsAmbiguous === right.rowsAmbiguous
    && left.errorCode === right.errorCode
  );
}

function migrationRunInsert(candidate: Readonly<MigrationRun>) {
  const parameters: Readonly<Record<string, YdbParameter>> = Object.freeze({
    id: uuidParameter(candidate.id),
    started_at: timestampParameter(candidate.startedAt),
    finished_at: timestampParameter(candidate.finishedAt),
    source_snapshot_digest: stringParameter(candidate.sourceSnapshotDigest),
    state: utf8Parameter(candidate.state),
    rows_seen: uint64Parameter(candidate.rowsSeen),
    rows_new: uint64Parameter(candidate.rowsNew),
    rows_changed: uint64Parameter(candidate.rowsChanged),
    rows_missing: uint64Parameter(candidate.rowsMissing),
    rows_ambiguous: uint64Parameter(candidate.rowsAmbiguous),
    error_code: utf8Parameter(candidate.errorCode),
  });
  return writeStatement(
    'INSERT INTO migration_runs '
      + '(id, started_at, finished_at, source_snapshot_digest, state, rows_seen, rows_new, rows_changed, '
      + 'rows_missing, rows_ambiguous, error_code) '
      + 'VALUES ($id, $started_at, $finished_at, $source_snapshot_digest, $state, $rows_seen, $rows_new, '
      + '$rows_changed, $rows_missing, $rows_ambiguous, $error_code)',
    parameters,
  );
}

function migrationRunReadback(candidate: Readonly<MigrationRun>) {
  return readStatement(
    'SELECT id, started_at, finished_at, CAST(source_snapshot_digest AS Utf8) AS source_snapshot_digest, '
      + 'state, rows_seen, rows_new, rows_changed, rows_missing, rows_ambiguous, error_code '
      + 'FROM migration_runs WHERE id = $id',
    { id: uuidParameter(candidate.id) },
  );
}

export async function claimScheduledIncrementalRun(
  adapter: YdbAdapter,
  expectedBaseline: Readonly<MigrationRun>,
  candidate: Readonly<MigrationRun>,
): Promise<Readonly<MigrationRun>> {
  validateExpectedBaseline(expectedBaseline);
  validateCandidate(candidate, expectedBaseline);

  return adapter.serializableReadWrite(async (transaction) => {
    const evidenceResult = await transaction.execute<MigrationRunEvidenceRow>(
      scheduledSyncAdmissionEvidenceStatement(),
    );
    const evidence = parseScheduledSyncAdmissionEvidence(evidenceResult.rows);

    if (evidence.incompleteRuns.length > 0) {
      throw new ScheduledIncrementalRunClaimError('IN_FLIGHT_RUN_EXISTS');
    }
    if (
      evidence.committedBaselineRun === null
      || !sameRun(evidence.committedBaselineRun, expectedBaseline)
    ) {
      throw new ScheduledIncrementalRunClaimError('BASELINE_CHANGED');
    }

    await transaction.execute(migrationRunInsert(candidate));
    const readbackResult = await transaction.execute<MigrationRunEvidenceRow>(migrationRunReadback(candidate));
    const readback = parseScheduledSyncAdmissionEvidence(readbackResult.rows);
    if (
      readback.committedBaselineRun !== null
      || readback.incompleteRuns.length !== 1
      || !sameRun(readback.incompleteRuns[0] as Readonly<MigrationRun>, candidate)
    ) {
      throw new ScheduledIncrementalRunClaimError('CLAIM_READBACK_MISMATCH');
    }

    return Object.freeze({ ...candidate });
  });
}
