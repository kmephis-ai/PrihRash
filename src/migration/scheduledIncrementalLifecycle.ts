import { YdbAdapter } from '../integration/ydb/adapter.js';
import type { IncrementalCurrentDeltaPlan } from './incrementalCurrentDelta.js';
import type { IncrementalCurrentReconciliationPlan } from './incrementalCurrentReconciliation.js';
import { prepareIncrementalCurrentWrites } from './incrementalCurrentPersistence.js';
import type { IncrementalRevisionEvidencePlan } from './incrementalRevisionEvidence.js';
import type { IncrementalSourceDeltaIntentPlan } from './incrementalSourceDeltaIntent.js';
import {
  evaluateIncrementalValidation,
  type IncrementalValidationBlocker,
} from './incrementalValidationGate.js';
import type { InitialReconciliationEvidence } from './initialValidationGate.js';
import { executeMigrationRunLifecycleWrite } from './migrationRunLifecycleExecutor.js';
import {
  prepareMigrationRunFailedWrite,
  prepareMigrationRunValidatedWrite,
} from './migrationRunPersistence.js';
import type { MigrationRun } from './migrationRunState.js';
import { promoteAtomicDelta } from './atomicPromotion.js';
import { claimScheduledIncrementalRun } from './scheduledIncrementalRunClaim.js';

export interface ScheduledIncrementalLifecycleInput {
  readonly expectedBaseline: Readonly<MigrationRun>;
  readonly candidateRun: Readonly<MigrationRun>;
  readonly sourceDelta: Readonly<IncrementalSourceDeltaIntentPlan>;
  readonly reconciliationPlan: Readonly<IncrementalCurrentReconciliationPlan>;
  readonly reconciliationEvidence: Readonly<InitialReconciliationEvidence>;
  readonly currentDelta: Readonly<IncrementalCurrentDeltaPlan>;
  readonly revisions: Readonly<IncrementalRevisionEvidencePlan>;
  readonly promotedAt: string;
  readonly finishedAt: string;
}

export type ScheduledIncrementalLifecycleResult =
  | Readonly<{
    status: 'VALIDATION_BLOCKED';
    run: Readonly<MigrationRun>;
    blockers: readonly Readonly<IncrementalValidationBlocker>[];
  }>
  | Readonly<{
    status: 'FAILED_PRECHECK';
    run: Readonly<MigrationRun>;
    errorCode: 'PROMOTION_TOO_LARGE';
  }>
  | Readonly<{
    status: 'COMMITTED';
    run: Readonly<MigrationRun>;
  }>;

export async function runScheduledIncrementalLifecycle(
  adapter: YdbAdapter,
  input: Readonly<ScheduledIncrementalLifecycleInput>,
): Promise<ScheduledIncrementalLifecycleResult> {
  const claimedRun = await claimScheduledIncrementalRun(
    adapter,
    input.expectedBaseline,
    input.candidateRun,
  );

  const validation = evaluateIncrementalValidation(
    claimedRun,
    input.sourceDelta,
    input.reconciliationPlan,
    input.reconciliationEvidence,
    input.currentDelta,
  );

  if (!validation.ok) {
    return Object.freeze({
      status: 'VALIDATION_BLOCKED' as const,
      run: claimedRun,
      blockers: validation.blockers,
    });
  }

  const validatedWrite = prepareMigrationRunValidatedWrite(
    claimedRun,
    validation.validatedRun,
  );
  const validatedRun = await executeMigrationRunLifecycleWrite(
    adapter,
    validatedWrite,
    validation.validatedRun,
  );

  const writePlan = prepareIncrementalCurrentWrites(
    validatedRun,
    input.currentDelta,
    input.revisions,
    input.promotedAt,
  );
  const promotion = await promoteAtomicDelta(
    adapter,
    validatedRun,
    writePlan.writes,
    input.finishedAt,
  );

  if (promotion.status === 'FAILED_PRECHECK') {
    const failedWrite = prepareMigrationRunFailedWrite(validatedRun, promotion.run);
    const failedRun = await executeMigrationRunLifecycleWrite(
      adapter,
      failedWrite,
      promotion.run,
    );
    return Object.freeze({
      status: 'FAILED_PRECHECK' as const,
      run: failedRun,
      errorCode: promotion.errorCode,
    });
  }

  return Object.freeze({
    status: 'COMMITTED' as const,
    run: promotion.run,
  });
}
