import { YdbAdapter } from '../integration/ydb/adapter.js';
import { assessAtomicPromotionWrites, type PromotionWrite } from './atomicPromotion.js';
import type { PreparedInitialSourceLineageWrite } from './initialSourceLineagePersistence.js';

export interface InitialRevisionEvidenceBatch {
  readonly writes: readonly PreparedInitialSourceLineageWrite[];
  readonly totalEstimatedParameterBytes: number;
}

export type InitialRevisionEvidenceErrorCode =
  | 'NON_EVIDENCE_WRITE'
  | 'EVIDENCE_WRITE_TOO_LARGE';

export class InitialRevisionEvidenceError extends Error {
  readonly code: InitialRevisionEvidenceErrorCode;

  constructor(code: InitialRevisionEvidenceErrorCode) {
    super(code);
    this.name = 'InitialRevisionEvidenceError';
    this.code = code;
  }
}

function asPromotionWrites(writes: readonly PreparedInitialSourceLineageWrite[]): PromotionWrite[] {
  return writes.map((write) => ({
    statement: write.statement,
    estimatedParameterBytes: write.estimatedParameterBytes,
  }));
}

export function planInitialRevisionEvidenceBatches(
  writes: readonly PreparedInitialSourceLineageWrite[],
): readonly Readonly<InitialRevisionEvidenceBatch>[] {
  for (const write of writes) {
    if (write.role !== 'STAGING_EVIDENCE') {
      throw new InitialRevisionEvidenceError('NON_EVIDENCE_WRITE');
    }
    if (!assessAtomicPromotionWrites(asPromotionWrites([write])).eligible) {
      throw new InitialRevisionEvidenceError('EVIDENCE_WRITE_TOO_LARGE');
    }
  }

  const batches: Readonly<InitialRevisionEvidenceBatch>[] = [];
  let current: PreparedInitialSourceLineageWrite[] = [];

  for (const write of writes) {
    const candidate = [...current, write];
    const assessment = assessAtomicPromotionWrites(asPromotionWrites(candidate));
    if (!assessment.eligible) {
      const currentAssessment = assessAtomicPromotionWrites(asPromotionWrites(current));
      batches.push(Object.freeze({
        writes: Object.freeze([...current]),
        totalEstimatedParameterBytes: currentAssessment.totalEstimatedParameterBytes,
      }));
      current = [write];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    const assessment = assessAtomicPromotionWrites(asPromotionWrites(current));
    batches.push(Object.freeze({
      writes: Object.freeze([...current]),
      totalEstimatedParameterBytes: assessment.totalEstimatedParameterBytes,
    }));
  }

  return Object.freeze(batches);
}

export async function executeInitialRevisionEvidenceBatches(
  adapter: YdbAdapter,
  batches: readonly InitialRevisionEvidenceBatch[],
): Promise<void> {
  for (const batch of batches) {
    if (batch.writes.length === 0) continue;
    await adapter.serializableReadWrite(async (transaction) => {
      for (const write of batch.writes) {
        if (write.role !== 'STAGING_EVIDENCE') {
          throw new InitialRevisionEvidenceError('NON_EVIDENCE_WRITE');
        }
        await transaction.execute(write.statement);
      }
    });
  }
}
