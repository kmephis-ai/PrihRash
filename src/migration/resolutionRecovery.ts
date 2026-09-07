import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { uuidParameter } from '../integration/ydb/parameters.js';
import type { PreparedResolutionMetadataWrite } from './resolutionPersistence.js';

interface ResolutionRecoveryRow {
  readonly state?: unknown;
  readonly classification?: unknown;
  readonly transaction_id?: unknown;
  readonly current_revision?: unknown;
  readonly resolution_code?: unknown;
  readonly resolved_at?: unknown;
  readonly resolved_by?: unknown;
}

export type ResolutionCommitRecoveryStatus = 'APPLIED' | 'NOT_APPLIED' | 'RECOVERY_REQUIRED';

export interface ResolutionCommitRecoveryResult {
  readonly status: ResolutionCommitRecoveryStatus;
}

function nullableMatches(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : value === expected;
}

function revisionMatches(value: unknown, expected: number): boolean {
  if (typeof value === 'bigint') return value === BigInt(expected);
  return typeof value === 'number' && Number.isSafeInteger(value) && value === expected;
}

function lineageMatches(
  row: ResolutionRecoveryRow,
  prepared: Readonly<PreparedResolutionMetadataWrite>,
): boolean {
  return (
    nullableMatches(row.state, prepared.expectation.sourceState)
    && nullableMatches(row.classification, prepared.expectation.classification)
    && nullableMatches(row.transaction_id, prepared.expectation.transactionId)
    && revisionMatches(row.current_revision, prepared.expectation.currentRevision)
  );
}

function targetResolutionMatches(
  row: ResolutionRecoveryRow,
  prepared: Readonly<PreparedResolutionMetadataWrite>,
): boolean {
  return (
    row.resolution_code === prepared.resolved.resolutionCode
    && row.resolved_at === prepared.resolved.resolvedAt
    && row.resolved_by === prepared.resolved.resolvedBy
  );
}

function resolutionStillEmpty(row: ResolutionRecoveryRow): boolean {
  return row.resolution_code === null && row.resolved_at === null && row.resolved_by === null;
}

export async function recoverResolutionMetadataCommit(
  adapter: YdbAdapter,
  prepared: Readonly<PreparedResolutionMetadataWrite>,
): Promise<Readonly<ResolutionCommitRecoveryResult>> {
  const read = readStatement(
    'SELECT state, classification, transaction_id, current_revision, resolution_code, resolved_at, resolved_by '
      + 'FROM source_records WHERE id = $id',
    { id: uuidParameter(prepared.expectation.sourceRecordId) },
  );
  const result = await adapter.read<ResolutionRecoveryRow>(read);

  if (result.rows.length !== 1) {
    return Object.freeze({ status: 'RECOVERY_REQUIRED' as const });
  }
  const row = result.rows[0];
  if (row === undefined || !lineageMatches(row, prepared)) {
    return Object.freeze({ status: 'RECOVERY_REQUIRED' as const });
  }
  if (targetResolutionMatches(row, prepared)) {
    return Object.freeze({ status: 'APPLIED' as const });
  }
  if (resolutionStillEmpty(row)) {
    return Object.freeze({ status: 'NOT_APPLIED' as const });
  }
  return Object.freeze({ status: 'RECOVERY_REQUIRED' as const });
}
