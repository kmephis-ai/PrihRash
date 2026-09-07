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
  type ScheduledIncrementalCandidatePreparationPlan,
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

export interface PreparedScheduledIncrementalExecutionInput {
  readonly baselineRun: Readonly<MigrationRun>;
  readonly prepared: Readonly<ScheduledIncrementalCandidatePreparationPlan>;
  readonly reconciliationEvidence: Readonly<InitialReconciliationEvidence>;
  readonly promotedAt: string;
  readonly finishedAt: string;
}

export interface ScheduledIncrementalExecutionResult {
  readonly lifecycle: Readonly<ScheduledIncrementalLifecycleResult>;
  readonly candidateRun: Readonly<MigrationRun>;
  readonly sourceAssignmentRequestCount: number;
  readonly transactionAssignmentRequestCount: number;
}

export async function executePreparedScheduledIncrementalCandidate(
  adapter: YdbAdapter,
  input: Readonly<PreparedScheduledIncrementalExecutionInput>,
): Promise<Readonly<ScheduledIncrementalExecutionResult>> {
  const lifecycle = await runScheduledIncrementalLifecycle(adapter, {
    expectedBaseline: input.baselineRun,
    candidateRun: input.prepared.run,
    sourceDelta: input.prepared.structural.sourceDelta,
    reconciliationPlan: input.prepared.reconciliation,
    reconciliationEvidence: input.reconciliationEvidence,
    currentDelta: input.prepared.candidates.currentDelta,
    revisions: input.prepared.structural.revisions,
    promotedAt: input.promotedAt,
    finishedAt: input.finishedAt,
  });

  return Object.freeze({
    lifecycle,
    candidateRun: input.prepared.run,
    sourceAssignmentRequestCount: input.prepared.sourceAssignmentRequests.length,
    transactionAssignmentRequestCount: input.prepared.transactionAssignmentRequests.length,
  });
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

  return executePreparedScheduledIncrementalCandidate(adapter, {
    baselineRun: input.baselineRun,
    prepared,
    reconciliationEvidence: input.reconciliationEvidence,
    promotedAt: input.promotedAt,
    finishedAt: input.finishedAt,
  });
}
