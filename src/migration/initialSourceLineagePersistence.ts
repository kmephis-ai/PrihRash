import {
  type YdbParameter,
  jsonDocumentParameter,
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
import type { InitialSourceLineageProjection } from './initialSourceLineage.js';

export interface PreparedInitialSourceLineageWrite {
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export type InitialSourceLineagePersistenceErrorCode =
  | 'LINEAGE_LENGTH_MISMATCH'
  | 'REVISION_RECORD_MISMATCH'
  | 'INVALID_INITIAL_REVISION';

export class InitialSourceLineagePersistenceError extends Error {
  readonly code: InitialSourceLineagePersistenceErrorCode;

  constructor(code: InitialSourceLineagePersistenceErrorCode) {
    super(code);
    this.name = 'InitialSourceLineagePersistenceError';
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

function preparedWrite(statement: YdbStatement): Readonly<PreparedInitialSourceLineageWrite> {
  return Object.freeze({
    statement,
    estimatedParameterBytes: estimateParameterBytes(statement.parameters),
  });
}

function validateProjection(projection: InitialSourceLineageProjection): void {
  if (projection.records.length !== projection.revisions.length) {
    throw new InitialSourceLineagePersistenceError('LINEAGE_LENGTH_MISMATCH');
  }

  for (const [index, record] of projection.records.entries()) {
    const revision = projection.revisions[index];
    if (revision === undefined || record.id !== revision.sourceRecordId) {
      throw new InitialSourceLineagePersistenceError('REVISION_RECORD_MISMATCH');
    }
    if (record.currentRevision !== 1 || revision.revision !== 1) {
      throw new InitialSourceLineagePersistenceError('INVALID_INITIAL_REVISION');
    }
  }
}

function sourceRecordStatement(record: InitialSourceLineageProjection['records'][number]): YdbStatement {
  const parameters = {
    id: uuidParameter(record.id),
    source_type: utf8Parameter(record.sourceType),
    source_sheet: utf8Parameter(record.sourceSheet),
    first_seen_at: timestampParameter(record.firstSeenAt),
    last_seen_at: timestampParameter(record.lastSeenAt),
    last_row_hint: uint64Parameter(record.lastRowHint),
    current_digest: stringParameter(record.currentDigest),
    state: utf8Parameter(record.state),
    classification: utf8Parameter(record.classification),
    normalization_status: utf8Parameter(record.normalizationStatus),
    transaction_id: uuidParameter(record.transactionId),
    current_revision: uint64Parameter(record.currentRevision),
    resolution_code: utf8Parameter(record.resolutionCode),
    resolved_at: timestampParameter(record.resolvedAt),
    resolved_by: utf8Parameter(record.resolvedBy),
  };

  return writeStatement(
    'UPSERT INTO source_records '
      + '(id, source_type, source_sheet, first_seen_at, last_seen_at, last_row_hint, current_digest, state, '
      + 'classification, normalization_status, transaction_id, current_revision, resolution_code, resolved_at, resolved_by) '
      + 'VALUES ($id, $source_type, $source_sheet, $first_seen_at, $last_seen_at, $last_row_hint, $current_digest, '
      + '$state, $classification, $normalization_status, $transaction_id, $current_revision, $resolution_code, '
      + '$resolved_at, $resolved_by)',
    parameters,
  );
}

function sourceRevisionStatement(
  revision: InitialSourceLineageProjection['revisions'][number],
): YdbStatement {
  const parameters = {
    source_record_id: uuidParameter(revision.sourceRecordId),
    revision: uint64Parameter(revision.revision),
    migration_run_id: uuidParameter(revision.migrationRunId),
    observed_at: timestampParameter(revision.observedAt),
    row_hint: uint64Parameter(revision.rowHint),
    row_digest: stringParameter(revision.rowDigest),
    change_class: utf8Parameter(revision.changeClass),
    raw_payload: jsonDocumentParameter(revision.rawPayload),
  };

  return writeStatement(
    'UPSERT INTO source_record_revisions '
      + '(source_record_id, revision, migration_run_id, observed_at, row_hint, row_digest, change_class, raw_payload) '
      + 'VALUES ($source_record_id, $revision, $migration_run_id, $observed_at, $row_hint, $row_digest, '
      + '$change_class, $raw_payload)',
    parameters,
  );
}

export function prepareInitialSourceLineageWrites(
  projection: InitialSourceLineageProjection,
): readonly Readonly<PreparedInitialSourceLineageWrite>[] {
  validateProjection(projection);

  const writes: Readonly<PreparedInitialSourceLineageWrite>[] = [];
  for (const [index, record] of projection.records.entries()) {
    const revision = projection.revisions[index];
    if (revision === undefined) {
      throw new InitialSourceLineagePersistenceError('LINEAGE_LENGTH_MISMATCH');
    }
    writes.push(preparedWrite(sourceRecordStatement(record)));
    writes.push(preparedWrite(sourceRevisionStatement(revision)));
  }
  return Object.freeze(writes);
}
