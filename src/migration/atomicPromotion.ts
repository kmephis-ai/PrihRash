import {
  type YdbStatement,
  YdbAdapter,
  writeStatement,
} from '../integration/ydb/adapter.js';
import {
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import {
  type MigrationRun,
  markMigrationRunCommitted,
  markMigrationRunFailed,
} from './migrationRunState.js';

// Live TEST_PRIVATE calibration on 2026-09-06 showed a clear latency step above 512 KiB:
// 512 KiB p50/p95 ~= 333/498 ms; 1 MiB ~= 720/823 ms; 1.5 MiB ~= 1018/1110 ms.
// Keep the ordinary atomic-promotion path conservatively below that step; larger rebuilds
// must use the separate controlled staging/rebuild path instead of widening this guard.
export const PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT = 512 * 1024;
export const PRELIVE_PROMOTION_QUERY_BYTES_LIMIT = 8 * 1024;
// Reserve conservatively for exact run evidence + marker values. This is intentionally
// larger than the earlier 256-byte estimate and therefore only narrows the ordinary cap.
export const COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES = 512;

export interface PromotionWrite {
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
  readonly expectedReturnedRowCount?: number;
}

export type AtomicPromotionErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'INVALID_PROMOTION_STATEMENT'
  | 'INVALID_PROMOTION_ESTIMATE'
  | 'INVALID_RETURNED_ROW_GUARD'
  | 'PROMOTION_WRITE_PRECONDITION_FAILED'
  | 'COMMIT_MARKER_PRECONDITION_FAILED';

export class AtomicPromotionError extends Error {
  readonly code: AtomicPromotionErrorCode;

  constructor(code: AtomicPromotionErrorCode) {
    super(code);
    this.name = 'AtomicPromotionError';
    this.code = code;
  }
}

export interface CommittedPromotionResult {
  readonly status: 'COMMITTED';
  readonly run: Readonly<MigrationRun>;
}

export interface RejectedPromotionResult {
  readonly status: 'FAILED_PRECHECK';
  readonly errorCode: 'PROMOTION_TOO_LARGE';
  readonly run: Readonly<MigrationRun>;
}

export type AtomicPromotionResult = CommittedPromotionResult | RejectedPromotionResult;

export type AtomicPromotionPreflightReason =
  | 'QUERY_LIMIT_EXCEEDED'
  | 'PARAMETER_LIMIT_EXCEEDED';

export interface AtomicPromotionPreflightAssessment {
  readonly eligible: boolean;
  readonly reason: AtomicPromotionPreflightReason | null;
  readonly totalEstimatedParameterBytes: number;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertReturnedRowGuard(write: PromotionWrite): void {
  if (
    write.expectedReturnedRowCount !== undefined
    && (!Number.isSafeInteger(write.expectedReturnedRowCount) || write.expectedReturnedRowCount < 0)
  ) {
    throw new AtomicPromotionError('INVALID_RETURNED_ROW_GUARD');
  }
}

export function assessAtomicPromotionWrites(
  writes: readonly PromotionWrite[],
): Readonly<AtomicPromotionPreflightAssessment> {
  let totalEstimatedParameterBytes = COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES;

  for (const write of writes) {
    if (write.statement.kind !== 'WRITE') {
      throw new AtomicPromotionError('INVALID_PROMOTION_STATEMENT');
    }
    if (!Number.isSafeInteger(write.estimatedParameterBytes) || write.estimatedParameterBytes < 0) {
      throw new AtomicPromotionError('INVALID_PROMOTION_ESTIMATE');
    }
    assertReturnedRowGuard(write);
    if (utf8ByteLength(write.statement.text) > PRELIVE_PROMOTION_QUERY_BYTES_LIMIT) {
      return Object.freeze({
        eligible: false,
        reason: 'QUERY_LIMIT_EXCEEDED' as const,
        totalEstimatedParameterBytes,
      });
    }
    totalEstimatedParameterBytes += write.estimatedParameterBytes;
    if (totalEstimatedParameterBytes > PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT) {
      return Object.freeze({
        eligible: false,
        reason: 'PARAMETER_LIMIT_EXCEEDED' as const,
        totalEstimatedParameterBytes,
      });
    }
  }

  return Object.freeze({
    eligible: true,
    reason: null,
    totalEstimatedParameterBytes,
  });
}

function commitMarkerStatement(run: MigrationRun, finishedAt: string): YdbStatement {
  return writeStatement(
    'UPDATE migration_runs SET state = $state, finished_at = $finished_at, error_code = $error_code '
      + 'WHERE id = $id AND state = $expected_state '
      + 'AND source_snapshot_digest = $source_snapshot_digest '
      + 'AND rows_seen = $rows_seen AND rows_new = $rows_new AND rows_changed = $rows_changed '
      + 'AND rows_missing = $rows_missing AND rows_ambiguous = $rows_ambiguous '
      + 'AND finished_at IS NULL AND error_code IS NULL RETURNING id',
    {
      id: uuidParameter(run.id),
      state: utf8Parameter('COMMITTED'),
      expected_state: utf8Parameter('VALIDATED'),
      finished_at: timestampParameter(finishedAt),
      error_code: utf8Parameter(null),
      source_snapshot_digest: stringParameter(run.sourceSnapshotDigest),
      rows_seen: uint64Parameter(run.rowsSeen),
      rows_new: uint64Parameter(run.rowsNew),
      rows_changed: uint64Parameter(run.rowsChanged),
      rows_missing: uint64Parameter(run.rowsMissing),
      rows_ambiguous: uint64Parameter(run.rowsAmbiguous),
    },
  );
}

export async function promoteAtomicDelta(
  adapter: YdbAdapter,
  run: MigrationRun,
  writes: readonly PromotionWrite[],
  finishedAt: string,
): Promise<AtomicPromotionResult> {
  if (run.state !== 'VALIDATED') {
    throw new AtomicPromotionError('RUN_NOT_VALIDATED');
  }

  if (!assessAtomicPromotionWrites(writes).eligible) {
    return Object.freeze({
      status: 'FAILED_PRECHECK' as const,
      errorCode: 'PROMOTION_TOO_LARGE' as const,
      run: markMigrationRunFailed(run, finishedAt, 'PROMOTION_TOO_LARGE'),
    });
  }

  const marker = commitMarkerStatement(run, finishedAt);
  await adapter.serializableReadWrite(async (transaction) => {
    for (const write of writes) {
      const result = await transaction.execute(write.statement);
      if (
        write.expectedReturnedRowCount !== undefined
        && result.rows.length !== write.expectedReturnedRowCount
      ) {
        throw new AtomicPromotionError('PROMOTION_WRITE_PRECONDITION_FAILED');
      }
    }
    const markerResult = await transaction.execute(marker);
    if (markerResult.rows.length !== 1) {
      throw new AtomicPromotionError('COMMIT_MARKER_PRECONDITION_FAILED');
    }
  });

  return Object.freeze({
    status: 'COMMITTED' as const,
    run: markMigrationRunCommitted(run, finishedAt),
  });
}
