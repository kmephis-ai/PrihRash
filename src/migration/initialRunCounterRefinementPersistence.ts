import { type YdbStatement, writeStatement, type YdbAdapter } from '../integration/ydb/adapter.js';
import {
  stringParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
  type YdbParameter,
} from '../integration/ydb/parameters.js';
import { executeMigrationRunLifecycleWrite } from './migrationRunLifecycleExecutor.js';
import type { MigrationRun } from './migrationRunState.js';

export interface PreparedInitialRunCounterRefinementWrite {
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export type InitialRunCounterRefinementPersistenceErrorCode =
  | 'RUN_IDENTITY_MISMATCH'
  | 'RUN_IMMUTABLE_FIELDS_CHANGED'
  | 'INVALID_COUNTER_REFINEMENT'
  | 'COUNTER_NOT_CHANGED';

export class InitialRunCounterRefinementPersistenceError extends Error {
  readonly code: InitialRunCounterRefinementPersistenceErrorCode;

  constructor(code: InitialRunCounterRefinementPersistenceErrorCode) {
    super(code);
    this.name = 'InitialRunCounterRefinementPersistenceError';
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const PARAMETER_VALUE_OVERHEAD_BYTES = 16;

function estimateParameterBytes(parameters: Readonly<Record<string, YdbParameter>>): number {
  return Object.values(parameters).reduce((total, parameter) => {
    const valueBytes = parameter.value === null
      ? 0
      : TEXT_ENCODER.encode(String(parameter.value)).byteLength;
    return total + PARAMETER_VALUE_OVERHEAD_BYTES + valueBytes;
  }, 0);
}

export function prepareInitialRunCounterRefinementWrite(
  previous: MigrationRun,
  refined: MigrationRun,
): Readonly<PreparedInitialRunCounterRefinementWrite> {
  if (previous.id !== refined.id) {
    throw new InitialRunCounterRefinementPersistenceError('RUN_IDENTITY_MISMATCH');
  }
  if (
    previous.startedAt !== refined.startedAt
    || previous.sourceSnapshotDigest !== refined.sourceSnapshotDigest
    || previous.rowsSeen !== refined.rowsSeen
    || previous.rowsNew !== refined.rowsNew
    || previous.rowsChanged !== refined.rowsChanged
    || previous.rowsMissing !== refined.rowsMissing
  ) {
    throw new InitialRunCounterRefinementPersistenceError('RUN_IMMUTABLE_FIELDS_CHANGED');
  }
  if (
    previous.state !== 'STAGING'
    || refined.state !== 'STAGING'
    || previous.finishedAt !== null
    || refined.finishedAt !== null
    || previous.errorCode !== null
    || refined.errorCode !== null
  ) {
    throw new InitialRunCounterRefinementPersistenceError('INVALID_COUNTER_REFINEMENT');
  }
  if (previous.rowsAmbiguous === refined.rowsAmbiguous) {
    throw new InitialRunCounterRefinementPersistenceError('COUNTER_NOT_CHANGED');
  }

  const parameters = {
    id: uuidParameter(previous.id),
    expected_state: utf8Parameter('STAGING'),
    source_snapshot_digest: stringParameter(previous.sourceSnapshotDigest),
    rows_seen: uint64Parameter(previous.rowsSeen),
    rows_new: uint64Parameter(previous.rowsNew),
    rows_changed: uint64Parameter(previous.rowsChanged),
    rows_missing: uint64Parameter(previous.rowsMissing),
    expected_rows_ambiguous: uint64Parameter(previous.rowsAmbiguous),
    rows_ambiguous: uint64Parameter(refined.rowsAmbiguous),
  };

  return Object.freeze({
    statement: writeStatement(
      'UPDATE migration_runs SET rows_ambiguous = $rows_ambiguous '
        + 'WHERE id = $id AND state = $expected_state AND source_snapshot_digest = $source_snapshot_digest '
        + 'AND rows_seen = $rows_seen AND rows_new = $rows_new AND rows_changed = $rows_changed '
        + 'AND rows_missing = $rows_missing AND rows_ambiguous = $expected_rows_ambiguous',
      parameters,
    ),
    estimatedParameterBytes: estimateParameterBytes(parameters),
  });
}

export async function executeInitialRunCounterRefinementWrite(
  adapter: YdbAdapter,
  prepared: PreparedInitialRunCounterRefinementWrite,
  expectedRun: MigrationRun,
): Promise<Readonly<MigrationRun>> {
  return executeMigrationRunLifecycleWrite(adapter, prepared, expectedRun);
}
