import {
  type YdbParameter,
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import {
  type YdbStatement,
  writeStatement,
} from '../integration/ydb/adapter.js';
import type { InitialBootstrapCandidateEnvelope } from './initialBootstrapCandidate.js';

export type BootstrapMetadataWriteRole = 'SNAPSHOT_EVIDENCE' | 'RUN_STAGING';

export interface PreparedBootstrapMetadataWrite {
  readonly role: BootstrapMetadataWriteRole;
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export type InitialBootstrapPersistenceErrorCode =
  | 'RUN_NOT_STAGING'
  | 'SNAPSHOT_RUN_DIGEST_MISMATCH'
  | 'SNAPSHOT_ROW_COUNT_MISMATCH'
  | 'RUN_COUNTERS_MISMATCH';

export class InitialBootstrapPersistenceError extends Error {
  readonly code: InitialBootstrapPersistenceErrorCode;

  constructor(code: InitialBootstrapPersistenceErrorCode) {
    super(code);
    this.name = 'InitialBootstrapPersistenceError';
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

function preparedWrite(
  statement: YdbStatement,
  role: BootstrapMetadataWriteRole,
): Readonly<PreparedBootstrapMetadataWrite> {
  return Object.freeze({
    role,
    statement,
    estimatedParameterBytes: estimateParameterBytes(statement.parameters),
  });
}

function validateEnvelope(candidate: InitialBootstrapCandidateEnvelope): void {
  if (candidate.run.state !== 'STAGING') {
    throw new InitialBootstrapPersistenceError('RUN_NOT_STAGING');
  }
  if (candidate.snapshot.snapshotDigest !== candidate.run.sourceSnapshotDigest) {
    throw new InitialBootstrapPersistenceError('SNAPSHOT_RUN_DIGEST_MISMATCH');
  }
  if (candidate.snapshot.rowCount !== candidate.plan.candidates.length) {
    throw new InitialBootstrapPersistenceError('SNAPSHOT_ROW_COUNT_MISMATCH');
  }

  const counters = candidate.plan.counters;
  if (
    candidate.run.rowsSeen !== counters.rowsSeen
    || candidate.run.rowsNew !== counters.rowsNew
    || candidate.run.rowsChanged !== counters.rowsChanged
    || candidate.run.rowsMissing !== counters.rowsMissing
    || candidate.run.rowsAmbiguous !== counters.rowsAmbiguous
  ) {
    throw new InitialBootstrapPersistenceError('RUN_COUNTERS_MISMATCH');
  }
}

function sourceSnapshotStatement(candidate: InitialBootstrapCandidateEnvelope): YdbStatement {
  const parameters = {
    id: uuidParameter(candidate.snapshot.id),
    captured_at: timestampParameter(candidate.snapshot.capturedAt),
    source_sheet: utf8Parameter(candidate.snapshot.sourceSheet),
    snapshot_digest: stringParameter(candidate.snapshot.snapshotDigest),
    row_count: uint64Parameter(candidate.snapshot.rowCount),
  };

  return writeStatement(
    'UPSERT INTO source_snapshots (id, captured_at, source_sheet, snapshot_digest, row_count) '
      + 'VALUES ($id, $captured_at, $source_sheet, $snapshot_digest, $row_count)',
    parameters,
  );
}

function migrationRunStatement(candidate: InitialBootstrapCandidateEnvelope): YdbStatement {
  const run = candidate.run;
  const parameters = {
    id: uuidParameter(run.id),
    started_at: timestampParameter(run.startedAt),
    finished_at: timestampParameter(run.finishedAt),
    source_snapshot_digest: stringParameter(run.sourceSnapshotDigest),
    state: utf8Parameter(run.state),
    rows_seen: uint64Parameter(run.rowsSeen),
    rows_new: uint64Parameter(run.rowsNew),
    rows_changed: uint64Parameter(run.rowsChanged),
    rows_missing: uint64Parameter(run.rowsMissing),
    rows_ambiguous: uint64Parameter(run.rowsAmbiguous),
    error_code: utf8Parameter(run.errorCode),
  };

  return writeStatement(
    'UPSERT INTO migration_runs '
      + '(id, started_at, finished_at, source_snapshot_digest, state, rows_seen, rows_new, rows_changed, '
      + 'rows_missing, rows_ambiguous, error_code) '
      + 'VALUES ($id, $started_at, $finished_at, $source_snapshot_digest, $state, $rows_seen, $rows_new, '
      + '$rows_changed, $rows_missing, $rows_ambiguous, $error_code)',
    parameters,
  );
}

export function prepareInitialBootstrapMetadataWrites(
  candidate: InitialBootstrapCandidateEnvelope,
): readonly Readonly<PreparedBootstrapMetadataWrite>[] {
  validateEnvelope(candidate);

  return Object.freeze([
    preparedWrite(sourceSnapshotStatement(candidate), 'SNAPSHOT_EVIDENCE'),
    preparedWrite(migrationRunStatement(candidate), 'RUN_STAGING'),
  ]);
}
