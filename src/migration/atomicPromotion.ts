import {
  type YdbStatement,
  YdbAdapter,
  writeStatement,
} from '../integration/ydb/adapter.js';
import {
  timestampParameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import {
  type MigrationRun,
  markMigrationRunCommitted,
  markMigrationRunFailed,
} from './migrationRunState.js';

export const PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT = 2 * 1024 * 1024;
export const PRELIVE_PROMOTION_QUERY_BYTES_LIMIT = 8 * 1024;
export const COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES = 256;

export interface PromotionWrite {
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export type AtomicPromotionErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'INVALID_PROMOTION_STATEMENT'
  | 'INVALID_PROMOTION_ESTIMATE';

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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateWrites(writes: readonly PromotionWrite[]): boolean {
  let totalEstimatedParameterBytes = COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES;

  for (const write of writes) {
    if (write.statement.kind !== 'WRITE') {
      throw new AtomicPromotionError('INVALID_PROMOTION_STATEMENT');
    }
    if (!Number.isSafeInteger(write.estimatedParameterBytes) || write.estimatedParameterBytes < 0) {
      throw new AtomicPromotionError('INVALID_PROMOTION_ESTIMATE');
    }
    if (utf8ByteLength(write.statement.text) > PRELIVE_PROMOTION_QUERY_BYTES_LIMIT) {
      return false;
    }
    totalEstimatedParameterBytes += write.estimatedParameterBytes;
    if (totalEstimatedParameterBytes > PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT) {
      return false;
    }
  }

  return true;
}

function commitMarkerStatement(run: MigrationRun, finishedAt: string): YdbStatement {
  return writeStatement(
    'UPDATE migration_runs SET state = $state, finished_at = $finished_at, error_code = $error_code '
      + 'WHERE id = $id AND state = $expected_state',
    {
      id: uuidParameter(run.id),
      state: utf8Parameter('COMMITTED'),
      expected_state: utf8Parameter('VALIDATED'),
      finished_at: timestampParameter(finishedAt),
      error_code: utf8Parameter(null),
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

  if (!validateWrites(writes)) {
    return Object.freeze({
      status: 'FAILED_PRECHECK' as const,
      errorCode: 'PROMOTION_TOO_LARGE' as const,
      run: markMigrationRunFailed(run, finishedAt, 'PROMOTION_TOO_LARGE'),
    });
  }

  const marker = commitMarkerStatement(run, finishedAt);
  await adapter.serializableReadWrite(async (transaction) => {
    for (const write of writes) {
      await transaction.execute(write.statement);
    }
    await transaction.execute(marker);
  });

  return Object.freeze({
    status: 'COMMITTED' as const,
    run: markMigrationRunCommitted(run, finishedAt),
  });
}
