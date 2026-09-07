import {
  hasCompleteResolutionAudit,
  type ReconciliationItem,
} from './resolution.js';

export interface SourceScopedReconciliationMismatch {
  readonly sourceRecordId: string;
  readonly highImpact: boolean;
}

export interface ReconciliationResolutionAccounting {
  readonly totalSourceMismatchCount: number;
  readonly highImpactSourceMismatchCount: number;
  readonly explainedHighImpactMismatchCount: number;
  readonly unexplainedHighImpactMismatchCount: number;
}

export type ReconciliationResolutionAccountingErrorCode =
  | 'DUPLICATE_MISMATCH_SOURCE_ID'
  | 'DUPLICATE_REVIEW_SOURCE_ID'
  | 'RESOLUTION_WITHOUT_MISMATCH';

export class ReconciliationResolutionAccountingError extends Error {
  readonly code: ReconciliationResolutionAccountingErrorCode;

  constructor(code: ReconciliationResolutionAccountingErrorCode) {
    super(code);
    this.name = 'ReconciliationResolutionAccountingError';
    this.code = code;
  }
}

function sourceKey(value: string): string {
  return value.toLowerCase();
}

export function accountReconciliationResolutions(
  mismatches: readonly Readonly<SourceScopedReconciliationMismatch>[],
  reviews: readonly Readonly<ReconciliationItem>[],
): Readonly<ReconciliationResolutionAccounting> {
  const mismatchBySource = new Map<string, Readonly<SourceScopedReconciliationMismatch>>();
  for (const mismatch of mismatches) {
    const key = sourceKey(mismatch.sourceRecordId);
    if (mismatchBySource.has(key)) {
      throw new ReconciliationResolutionAccountingError('DUPLICATE_MISMATCH_SOURCE_ID');
    }
    mismatchBySource.set(key, mismatch);
  }

  const reviewBySource = new Map<string, Readonly<ReconciliationItem>>();
  for (const review of reviews) {
    const key = sourceKey(review.sourceRecordId);
    if (reviewBySource.has(key)) {
      throw new ReconciliationResolutionAccountingError('DUPLICATE_REVIEW_SOURCE_ID');
    }
    reviewBySource.set(key, review);
    if (review.reviewState === 'RESOLVED' && !mismatchBySource.has(key)) {
      throw new ReconciliationResolutionAccountingError('RESOLUTION_WITHOUT_MISMATCH');
    }
  }

  let highImpactSourceMismatchCount = 0;
  let explainedHighImpactMismatchCount = 0;

  for (const [sourceId, mismatch] of mismatchBySource) {
    if (!mismatch.highImpact) continue;
    highImpactSourceMismatchCount += 1;
    const review = reviewBySource.get(sourceId);
    if (review !== undefined && hasCompleteResolutionAudit(review)) {
      explainedHighImpactMismatchCount += 1;
    }
  }

  return Object.freeze({
    totalSourceMismatchCount: mismatches.length,
    highImpactSourceMismatchCount,
    explainedHighImpactMismatchCount,
    unexplainedHighImpactMismatchCount:
      highImpactSourceMismatchCount - explainedHighImpactMismatchCount,
  });
}
