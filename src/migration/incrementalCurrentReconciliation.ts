import {
  buildExpectedControlledRebuildReconciliation,
  type InitialControlledRebuildReconciliationSnapshot,
} from './initialControlledRebuildReconciliation.js';
import type { IncrementalSourceCurrentCandidatePlan } from './incrementalSourceCurrentCandidate.js';
import type { IncrementalTransactionCurrentCandidatePlan } from './incrementalTransactionCurrentCandidate.js';

export interface IncrementalCurrentReconciliationPlan {
  readonly expected: Readonly<InitialControlledRebuildReconciliationSnapshot>;
  readonly promotionBlocker: 'UNRESOLVED_LINEAGE' | null;
}

export type IncrementalCurrentReconciliationErrorCode = 'PROMOTION_BLOCKER_MISMATCH';

export class IncrementalCurrentReconciliationError extends Error {
  readonly code: IncrementalCurrentReconciliationErrorCode;

  constructor(code: IncrementalCurrentReconciliationErrorCode) {
    super(code);
    this.name = 'IncrementalCurrentReconciliationError';
    this.code = code;
  }
}

export function buildExpectedIncrementalCurrentReconciliation(
  sourcePlan: Readonly<IncrementalSourceCurrentCandidatePlan>,
  transactionPlan: Readonly<IncrementalTransactionCurrentCandidatePlan>,
): Readonly<IncrementalCurrentReconciliationPlan> {
  if (sourcePlan.promotionBlocker !== transactionPlan.promotionBlocker) {
    throw new IncrementalCurrentReconciliationError('PROMOTION_BLOCKER_MISMATCH');
  }

  const expected = buildExpectedControlledRebuildReconciliation({
    sourceRecords: sourcePlan.sourceRecords,
    transactions: transactionPlan.transactions,
  });

  return Object.freeze({
    expected,
    promotionBlocker: sourcePlan.promotionBlocker,
  });
}
