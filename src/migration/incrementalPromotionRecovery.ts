import { YdbAdapter } from '../integration/ydb/adapter.js';
import { readControlledRebuildCurrentEvidence } from './initialControlledRebuildEvidenceReader.js';
import { compareControlledRebuildStagingReconciliation } from './initialControlledRebuildReconciliation.js';
import type { IncrementalCurrentReconciliationPlan } from './incrementalCurrentReconciliation.js';
import type { MigrationRun } from './migrationRunState.js';
import { resolveUnknownPromotionOutcome } from './promotionOutcome.js';

export type IncrementalPromotionRecoveryReason =
  | 'PROMOTION_BLOCKED'
  | 'RUN_NOT_FOUND'
  | 'RUN_RESULT_AMBIGUOUS'
  | 'RUN_EVIDENCE_MISMATCH'
  | 'RUN_NOT_COMMITTED'
  | 'RUN_EVIDENCE_READ_FAILED'
  | 'CURRENT_EVIDENCE_MISMATCH'
  | 'CURRENT_EVIDENCE_READ_FAILED';

export type IncrementalPromotionRecoveryResult =
  | Readonly<{
      status: 'COMMITTED_CURRENT_VERIFIED';
      reason: null;
    }>
  | Readonly<{
      status: 'RECOVERY_REQUIRED';
      reason: IncrementalPromotionRecoveryReason;
    }>;

export async function verifyUnknownIncrementalPromotionOutcome(
  adapter: YdbAdapter,
  run: Readonly<MigrationRun>,
  plan: Readonly<IncrementalCurrentReconciliationPlan>,
): Promise<IncrementalPromotionRecoveryResult> {
  if (plan.promotionBlocker !== null) {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      reason: 'PROMOTION_BLOCKED' as const,
    });
  }

  let durable;
  try {
    durable = await resolveUnknownPromotionOutcome(adapter, run);
  } catch {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      reason: 'RUN_EVIDENCE_READ_FAILED' as const,
    });
  }

  if (durable.status !== 'COMMITTED_CONFIRMED') {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      reason: durable.reason,
    });
  }

  try {
    const observed = await readControlledRebuildCurrentEvidence(adapter);
    const reconciliation = compareControlledRebuildStagingReconciliation(plan.expected, observed);
    if (reconciliation.unexplainedHighImpactMismatchCount !== 0) {
      return Object.freeze({
        status: 'RECOVERY_REQUIRED' as const,
        reason: 'CURRENT_EVIDENCE_MISMATCH' as const,
      });
    }
  } catch {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      reason: 'CURRENT_EVIDENCE_READ_FAILED' as const,
    });
  }

  return Object.freeze({
    status: 'COMMITTED_CURRENT_VERIFIED' as const,
    reason: null,
  });
}
