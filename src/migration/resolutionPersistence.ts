import { readStatement, type YdbStatement, writeStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import {
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import {
  hasCompleteResolutionAudit,
  type ReconciliationItem,
} from './resolution.js';

export interface ResolutionPersistenceExpectation {
  readonly sourceRecordId: string;
  readonly sourceState: string | null;
  readonly classification: string | null;
  readonly transactionId: string | null;
  readonly currentRevision: number;
}

export interface PreparedResolutionMetadataWrite {
  readonly expectation: Readonly<ResolutionPersistenceExpectation>;
  readonly resolved: Readonly<ReconciliationItem>;
  readonly statement: YdbStatement;
}

interface ResolutionReadBackRow {
  readonly state?: unknown;
  readonly classification?: unknown;
  readonly transaction_id?: unknown;
  readonly current_revision?: unknown;
  readonly resolution_code?: unknown;
  readonly resolved_at?: unknown;
  readonly resolved_by?: unknown;
}

export type ResolutionPersistenceErrorCode =
  | 'RESOLUTION_NOT_COMPLETE'
  | 'SOURCE_RECORD_ID_MISMATCH'
  | 'TRANSACTION_LINK_MISMATCH'
  | 'INVALID_CURRENT_REVISION'
  | 'REVIEW_REASON_MISMATCH'
  | 'SOURCE_RECORD_NOT_FOUND_AFTER_RESOLUTION'
  | 'SOURCE_RECORD_RESULT_AMBIGUOUS'
  | 'RESOLUTION_EVIDENCE_MISMATCH';

export class ResolutionPersistenceError extends Error {
  readonly code: ResolutionPersistenceErrorCode;

  constructor(code: ResolutionPersistenceErrorCode) {
    super(code);
    this.name = 'ResolutionPersistenceError';
    this.code = code;
  }
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

function nullableMatches(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : value === expected;
}

function revisionMatches(value: unknown, expected: number): boolean {
  if (typeof value === 'bigint') return value === BigInt(expected);
  return typeof value === 'number' && Number.isSafeInteger(value) && value === expected;
}

function validateExpectation(
  resolved: Readonly<ReconciliationItem>,
  expectation: Readonly<ResolutionPersistenceExpectation>,
): void {
  if (!hasCompleteResolutionAudit(resolved)) {
    throw new ResolutionPersistenceError('RESOLUTION_NOT_COMPLETE');
  }
  if (normalizeUuid(resolved.sourceRecordId) !== normalizeUuid(expectation.sourceRecordId)) {
    throw new ResolutionPersistenceError('SOURCE_RECORD_ID_MISMATCH');
  }
  if (resolved.transactionId !== expectation.transactionId) {
    throw new ResolutionPersistenceError('TRANSACTION_LINK_MISMATCH');
  }
  if (!Number.isSafeInteger(expectation.currentRevision) || expectation.currentRevision <= 0) {
    throw new ResolutionPersistenceError('INVALID_CURRENT_REVISION');
  }
  if (resolved.state === 'MISSING' && expectation.sourceState !== 'MISSING') {
    throw new ResolutionPersistenceError('REVIEW_REASON_MISMATCH');
  }
  if (resolved.state === 'AMBIGUOUS' && expectation.classification !== 'AMBIGUOUS') {
    throw new ResolutionPersistenceError('REVIEW_REASON_MISMATCH');
  }
}

function readBackMatches(
  row: ResolutionReadBackRow,
  prepared: Readonly<PreparedResolutionMetadataWrite>,
): boolean {
  const { expectation, resolved } = prepared;
  return (
    nullableMatches(row.state, expectation.sourceState)
    && nullableMatches(row.classification, expectation.classification)
    && nullableMatches(row.transaction_id, expectation.transactionId)
    && revisionMatches(row.current_revision, expectation.currentRevision)
    && row.resolution_code === resolved.resolutionCode
    && row.resolved_at === resolved.resolvedAt
    && row.resolved_by === resolved.resolvedBy
  );
}

export function prepareResolutionMetadataWrite(
  resolved: Readonly<ReconciliationItem>,
  expectation: Readonly<ResolutionPersistenceExpectation>,
): Readonly<PreparedResolutionMetadataWrite> {
  validateExpectation(resolved, expectation);

  const statement = writeStatement(
    'UPDATE source_records SET resolution_code = $resolution_code, resolved_at = $resolved_at, resolved_by = $resolved_by '
      + 'WHERE id = $id AND current_revision = $current_revision '
      + 'AND resolution_code IS NULL AND resolved_at IS NULL AND resolved_by IS NULL',
    {
      id: uuidParameter(expectation.sourceRecordId),
      current_revision: uint64Parameter(expectation.currentRevision),
      resolution_code: utf8Parameter(resolved.resolutionCode),
      resolved_at: timestampParameter(resolved.resolvedAt),
      resolved_by: utf8Parameter(resolved.resolvedBy),
    },
  );

  return Object.freeze({
    expectation: Object.freeze({ ...expectation, sourceRecordId: normalizeUuid(expectation.sourceRecordId) }),
    resolved: Object.freeze({ ...resolved, sourceRecordId: normalizeUuid(resolved.sourceRecordId) }),
    statement,
  });
}

export async function executeResolutionMetadataWrite(
  adapter: YdbAdapter,
  prepared: Readonly<PreparedResolutionMetadataWrite>,
): Promise<Readonly<ReconciliationItem>> {
  const readBack = readStatement(
    'SELECT state, classification, transaction_id, current_revision, resolution_code, resolved_at, resolved_by '
      + 'FROM source_records WHERE id = $id',
    { id: uuidParameter(prepared.expectation.sourceRecordId) },
  );

  await adapter.serializableReadWrite(async (transaction) => {
    await transaction.execute(prepared.statement);
    const result = await transaction.execute<ResolutionReadBackRow>(readBack);
    if (result.rows.length === 0) {
      throw new ResolutionPersistenceError('SOURCE_RECORD_NOT_FOUND_AFTER_RESOLUTION');
    }
    if (result.rows.length !== 1) {
      throw new ResolutionPersistenceError('SOURCE_RECORD_RESULT_AMBIGUOUS');
    }
    const row = result.rows[0];
    if (row === undefined || !readBackMatches(row, prepared)) {
      throw new ResolutionPersistenceError('RESOLUTION_EVIDENCE_MISMATCH');
    }
  });

  return Object.freeze({ ...prepared.resolved });
}
