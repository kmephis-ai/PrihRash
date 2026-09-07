import { YdbAdapter } from '../integration/ydb/adapter.js';
import type { ReferenceResolver } from '../normalization/types.js';
import type { GoogleSnapshotMigrationProjection } from './googleSnapshotProjection.js';
import type { IncrementalCurrentRevisionEvidenceSnapshot } from './incrementalCurrentRevisionEvidenceReader.js';
import type { InitialReconciliationEvidence } from './initialValidationGate.js';
import type { IncrementalSourceCurrentEvidenceSnapshot } from './incrementalSourceCurrentEvidenceReader.js';
import type { IncrementalPreviousTransactionCurrentEvidence } from './incrementalTransactionCurrentCandidate.js';
import {
  prepareScheduledIncrementalCandidate,
  type IncrementalSourceIdentityAllocator,
  type IncrementalTransactionIdentityAllocator,
} from './scheduledIncrementalCandidatePreparation.js';
import {
  runScheduledIncrementalLifecycle,
  type ScheduledIncrementalLifecycleResult,
} from './scheduledIncrementalLifecycle.js';
import type { MigrationRun } from './migrationRunState.js';

export interface ScheduledIncrementalExecutionInput {
  readonly baselineRun: Readonly<MigrationRun>;
  readonly sourceEvidence: Readonly<IncrementalSourceCurrentEvidenceSnapshot>;
  readonly revisionEvidence: Readonly<IncrementalCurrentRevisionEvidenceSnapshot>;
  readonly previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[];
  readonly projection: Readonly<GoogleSnapshotMigrationProjection>;
  readonly leasedSnapshotDigest: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly promotedAt: string;
  readonly finishedAt: string;
  readonly refs: ReferenceResolver;
  readonly sourceIdentityAllocator: IncrementalSourceIdentityAllocator;
  readonly transactionIdentityAllocator: IncrementalTransactionIdentityAllocator;
  readonly reconciliationEvidence: Readonly<InitialReconciliationEvidence>;
}

export interface ScheduledIncrementalExecutionResult {
  readonly lifecycle: Readonly<ScheduledIncrementalLifecycleResult>;
  readonly candidateRun: Readonly<MigrationRun>;
  readonly sourceAssignmentRequestCount: number;
  readonly transactionAssignmentRequestCount: number;
}

export async function runPreparedScheduledIncremental(
  adapter: YdbAdapter,
  input: Readonly<ScheduledIncrementalExecutionInput>,
): Promise<Readonly<ScheduledIncrementalExecutionResult>> {
  const prepared = await prepareScheduledIncrementalCandidate({
    baselineRun: input.baselineRun,
    sourceEvidence: input.sourceEvidence,
    revisionEvidence: input.revisionEvidence,
    previousTransactions: input.previousTransactions,
    projection: input.projection,
    sourceSnapshotDigest: input.leasedSnapshotDigest,
    runId: input.runId,
    startedAt: input.startedAt,
    observedAt: input.observedAt,
    refs: input.refs,
    sourceIdentityAllocator: input.sourceIdentityAllocator,
    transactionIdentityAllocator: input.transactionIdentityAllocator,
  });

  const lifecycle = await runScheduledIncrementalLifecycle(adapter, {
    expectedBaseline: input.baselineRun,
    candidateRun: prepared.run,
    sourceDelta: prepared.structural.sourceDelta,
    reconciliationPlan: prepared.reconciliation,
    reconciliationEvidence: input.reconciliationEvidence,
    currentDelta: prepared.candidates.currentDelta,
    revisions: prepared.structural.revisions,
    promotedAt: input.promotedAt,
    finishedAt: input.finishedAt,
  });

  return Object.freeze({
    lifecycle,
    candidateRun: prepared.run,
    sourceAssignmentRequestCount: prepared.sourceAssignmentRequests.length,
    transactionAssignmentRequestCount: prepared.transactionAssignmentRequests.length,
  });
}
