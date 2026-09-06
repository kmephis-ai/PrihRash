import { YdbAdapter } from '../integration/ydb/adapter.js';
import { assessAtomicPromotionWrites, type PromotionWrite } from './atomicPromotion.js';
import type {
  ControlledInitialRebuildBatch,
  ControlledInitialRebuildPlan,
} from './initialControlledRebuild.js';
import { retargetInitialVerifiedCurrentWritesToStaging } from './initialControlledRebuildRetarget.js';
import type { PreparedInitialVerifiedCurrentWrite } from './initialVerifiedCurrentPersistence.js';

export interface PreparedControlledRebuildStagingBatch {
  readonly index: number;
  readonly writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[];
  readonly estimatedParameterBytes: number;
}

export interface ControlledRebuildStagingExecutionResult {
  readonly completedBatchIndexes: readonly number[];
  readonly completedWriteCount: number;
}

export type ControlledRebuildStagingExecutorErrorCode =
  | 'INVALID_BATCH_INDEX'
  | 'INVALID_STAGING_BATCH'
  | 'STAGING_BATCH_NOT_ATOMIC_ELIGIBLE';

export class ControlledRebuildStagingExecutorError extends Error {
  readonly code: ControlledRebuildStagingExecutorErrorCode;

  constructor(code: ControlledRebuildStagingExecutorErrorCode) {
    super(code);
    this.name = 'ControlledRebuildStagingExecutorError';
    this.code = code;
  }
}

function asPromotionWrite(write: Readonly<PreparedInitialVerifiedCurrentWrite>): PromotionWrite {
  return Object.freeze({
    statement: write.statement,
    estimatedParameterBytes: write.estimatedParameterBytes,
  });
}

function prepareBatch(
  batch: Readonly<ControlledInitialRebuildBatch>,
  controlled: Readonly<ControlledInitialRebuildPlan>,
): Readonly<PreparedControlledRebuildStagingBatch> {
  if (!Number.isSafeInteger(batch.index) || batch.index < 0 || batch.writes.length === 0) {
    throw new ControlledRebuildStagingExecutorError('INVALID_STAGING_BATCH');
  }

  const writes = retargetInitialVerifiedCurrentWritesToStaging(batch.writes, controlled.stagingTables);
  const assessment = assessAtomicPromotionWrites(writes.map(asPromotionWrite));
  if (!assessment.eligible) {
    throw new ControlledRebuildStagingExecutorError('STAGING_BATCH_NOT_ATOMIC_ELIGIBLE');
  }

  return Object.freeze({
    index: batch.index,
    writes,
    estimatedParameterBytes: assessment.totalEstimatedParameterBytes,
  });
}

export function prepareControlledRebuildStagingBatches(
  controlled: Readonly<ControlledInitialRebuildPlan>,
): readonly Readonly<PreparedControlledRebuildStagingBatch>[] {
  const prepared = controlled.batches.map((batch, expectedIndex) => {
    if (batch.index !== expectedIndex) {
      throw new ControlledRebuildStagingExecutorError('INVALID_BATCH_INDEX');
    }
    return prepareBatch(batch, controlled);
  });
  return Object.freeze(prepared);
}

export async function executeControlledRebuildStagingBatches(
  adapter: YdbAdapter,
  batches: readonly Readonly<PreparedControlledRebuildStagingBatch>[],
): Promise<Readonly<ControlledRebuildStagingExecutionResult>> {
  const completedBatchIndexes: number[] = [];
  let completedWriteCount = 0;

  for (const [expectedIndex, batch] of batches.entries()) {
    if (batch.index !== expectedIndex || batch.writes.length === 0) {
      throw new ControlledRebuildStagingExecutorError('INVALID_BATCH_INDEX');
    }
    const assessment = assessAtomicPromotionWrites(batch.writes.map(asPromotionWrite));
    if (!assessment.eligible) {
      throw new ControlledRebuildStagingExecutorError('STAGING_BATCH_NOT_ATOMIC_ELIGIBLE');
    }

    await adapter.serializableReadWrite(async (transaction) => {
      for (const write of batch.writes) {
        await transaction.execute(write.statement);
      }
    });

    completedBatchIndexes.push(batch.index);
    completedWriteCount += batch.writes.length;
  }

  return Object.freeze({
    completedBatchIndexes: Object.freeze(completedBatchIndexes),
    completedWriteCount,
  });
}
