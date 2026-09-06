import {
  type YdbParameter,
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import { type YdbStatement, writeStatement } from '../integration/ydb/adapter.js';
import type { MigrationRun, MigrationRunState } from './migrationRunState.js';

export interface PreparedMigrationRunLifecycleWrite {
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export type MigrationRunPersistenceErrorCode =
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'RUN_IDENTITY_MISMATCH'
  | 'RUN_IMMUTABLE_FIELDS_CHANGED'
  | 'INVALID_FAILED_RUN';

export class MigrationRunPersistenceError extends Error {
  readonly code: MigrationRunPersistenceErrorCode;

  constructor(code: MigrationRunPersistenceErrorCode) {
    super(code);
    this.name = 'MigrationRunPersistenceError';
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const PARAMETER_VALUE_OVERHEAD_BYTES = 16;

function parameterValueBytes(parameter: YdbParameter): number {
  if (parameter.value === null) return 0;
  return TEXT_ENCODER.encode(String(parameter.value)).byteLength;
}

function estimateParameterBytes(parameters: Readonly<Record<string, YdbParameter>>): number {
  return Object.values(parameters).reduce(
    (total, parameter) => total + PARAMETER_VALUE_OVERHEAD_BYTES + parameterValueBytes(parameter),
    0,
  );
}

function assertImmutableRunFields(previous: MigrationRun, next: MigrationRun): void {
  if (previous.id !== next.id) {
    throw new MigrationRunPersistenceError('RUN_IDENTITY_MISMATCH');
  }
  if (
    previous.startedAt !== next.startedAt
    || previous.sourceSnapshotDigest !== next.sourceSnapshotDigest
    || previous.rowsSeen !== next.rowsSeen
    || previous.rowsNew !== next.rowsNew
    || previous.rowsChanged !== next.rowsChanged
    || previous.rowsMissing !== next.rowsMissing
    || previous.rowsAmbiguous !== next.rowsAmbiguous
  ) {
    throw new MigrationRunPersistenceError('RUN_IMMUTABLE_FIELDS_CHANGED');
  }
}

function lifecycleStatement(
  previous: MigrationRun,
  next: MigrationRun,
  expectedState: MigrationRunState,
): Readonly<PreparedMigrationRunLifecycleWrite> {
  const parameters = {
    id: uuidParameter(next.id),
    expected_state: utf8Parameter(expectedState),
    state: utf8Parameter(next.state),
    finished_at: timestampParameter(next.finishedAt),
    error_code: utf8Parameter(next.errorCode),
    source_snapshot_digest: stringParameter(next.sourceSnapshotDigest),
    rows_seen: uint64Parameter(next.rowsSeen),
    rows_new: uint64Parameter(next.rowsNew),
    rows_changed: uint64Parameter(next.rowsChanged),
    rows_missing: uint64Parameter(next.rowsMissing),
    rows_ambiguous: uint64Parameter(next.rowsAmbiguous),
  };
  const statement = writeStatement(
    'UPDATE migration_runs SET state = $state, finished_at = $finished_at, error_code = $error_code '
      + 'WHERE id = $id AND state = $expected_state AND source_snapshot_digest = $source_snapshot_digest '
      + 'AND rows_seen = $rows_seen AND rows_new = $rows_new AND rows_changed = $rows_changed '
      + 'AND rows_missing = $rows_missing AND rows_ambiguous = $rows_ambiguous',
    parameters,
  );
  return Object.freeze({
    statement,
    estimatedParameterBytes: estimateParameterBytes(parameters),
  });
}

export function prepareMigrationRunValidatedWrite(
  previous: MigrationRun,
  validated: MigrationRun,
): Readonly<PreparedMigrationRunLifecycleWrite> {
  assertImmutableRunFields(previous, validated);
  if (
    previous.state !== 'STAGING'
    || validated.state !== 'VALIDATED'
    || previous.finishedAt !== null
    || previous.errorCode !== null
    || validated.finishedAt !== null
    || validated.errorCode !== null
  ) {
    throw new MigrationRunPersistenceError('INVALID_LIFECYCLE_TRANSITION');
  }
  return lifecycleStatement(previous, validated, 'STAGING');
}

export function prepareMigrationRunFailedWrite(
  previous: MigrationRun,
  failed: MigrationRun,
): Readonly<PreparedMigrationRunLifecycleWrite> {
  assertImmutableRunFields(previous, failed);
  if (
    (previous.state !== 'STAGING' && previous.state !== 'VALIDATED')
    || failed.state !== 'FAILED'
    || previous.finishedAt !== null
    || previous.errorCode !== null
    || failed.finishedAt === null
    || failed.errorCode === null
    || failed.errorCode.trim().length === 0
  ) {
    throw new MigrationRunPersistenceError('INVALID_FAILED_RUN');
  }
  return lifecycleStatement(previous, failed, previous.state);
}
