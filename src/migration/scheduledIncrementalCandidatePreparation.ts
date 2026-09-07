import type { ReferenceResolver } from '../normalization/types.js';
import {
  buildIncrementalCommittedBaseline,
  buildIncrementalLineagePlanFromCommittedBaseline,
  type IncrementalCommittedBaseline,
} from './incrementalCommittedBaseline.js';
import {
  buildIncrementalCurrentCandidatePreparation,
  type IncrementalCurrentCandidatePreparationPlan,
} from './incrementalCurrentCandidatePreparation.js';
import {
  buildIncrementalCurrentObservationInputs,
  type IncrementalCurrentObservationHandoff,
} from './incrementalCurrentObservationHandoff.js';
import {
  buildExpectedIncrementalCurrentReconciliation,
  type IncrementalCurrentReconciliationPlan,
} from './incrementalCurrentReconciliation.js';
import type { IncrementalCurrentRevisionEvidenceSnapshot } from './incrementalCurrentRevisionEvidenceReader.js';
import type { GoogleSnapshotMigrationProjection } from './googleSnapshotProjection.js';
import {
  buildIncrementalSourceRecordAssignmentRequests,
  type IncrementalNewSourceRecordAssignment,
  type IncrementalSourceRecordAssignmentRequest,
} from './incrementalLineagePlan.js';
import {
  buildIncrementalSemanticPreparation,
  type IncrementalSemanticPreparationPlan,
} from './incrementalSemanticPreparation.js';
import type { IncrementalSourceCurrentEvidenceSnapshot } from './incrementalSourceCurrentEvidenceReader.js';
import {
  buildIncrementalStructuralPreparation,
  type IncrementalStructuralPreparationPlan,
} from './incrementalStructuralPreparation.js';
import type {
  IncrementalNewTransactionIdentityAssignment,
} from './incrementalSourceCurrentCandidate.js';
import {
  buildIncrementalTransactionIdentityAssignmentRequests,
  type IncrementalTransactionIdentityAssignmentRequest,
} from './incrementalTransactionIdentityRequests.js';
import type { IncrementalPreviousTransactionCurrentEvidence } from './incrementalTransactionCurrentCandidate.js';
import {
  createMigrationRun,
  type MigrationRun,
  type MigrationRunCounters,
} from './migrationRunState.js';

export interface IncrementalSourceIdentityAllocator {
  allocate(
    requests: readonly Readonly<IncrementalSourceRecordAssignmentRequest>[],
  ): Promise<readonly Readonly<IncrementalNewSourceRecordAssignment>[]>;
}

export interface IncrementalTransactionIdentityAllocator {
  allocate(
    requests: readonly Readonly<IncrementalTransactionIdentityAssignmentRequest>[],
  ): Promise<readonly Readonly<IncrementalNewTransactionIdentityAssignment>[]>;
}

export interface ScheduledIncrementalCandidatePreparationInput {
  readonly baselineRun: Readonly<MigrationRun>;
  readonly sourceEvidence: Readonly<IncrementalSourceCurrentEvidenceSnapshot>;
  readonly revisionEvidence: Readonly<IncrementalCurrentRevisionEvidenceSnapshot>;
  readonly previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[];
  readonly projection: Readonly<GoogleSnapshotMigrationProjection>;
  readonly sourceSnapshotDigest: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly refs: ReferenceResolver;
  readonly sourceIdentityAllocator: IncrementalSourceIdentityAllocator;
  readonly transactionIdentityAllocator: IncrementalTransactionIdentityAllocator;
}

export interface ScheduledIncrementalCandidatePreparationPlan {
  readonly baseline: Readonly<IncrementalCommittedBaseline>;
  readonly sourceAssignmentRequests: readonly Readonly<IncrementalSourceRecordAssignmentRequest>[];
  readonly sourceAssignments: readonly Readonly<IncrementalNewSourceRecordAssignment>[];
  readonly run: Readonly<MigrationRun>;
  readonly structural: Readonly<IncrementalStructuralPreparationPlan>;
  readonly currentObservations: Readonly<IncrementalCurrentObservationHandoff>;
  readonly semantic: Readonly<IncrementalSemanticPreparationPlan>;
  readonly transactionAssignmentRequests: readonly Readonly<IncrementalTransactionIdentityAssignmentRequest>[];
  readonly transactionAssignments: readonly Readonly<IncrementalNewTransactionIdentityAssignment>[];
  readonly candidates: Readonly<IncrementalCurrentCandidatePreparationPlan>;
  readonly reconciliation: Readonly<IncrementalCurrentReconciliationPlan>;
}

export type ScheduledIncrementalCandidatePreparationErrorCode = 'LINEAGE_COUNTER_MISMATCH';

export class ScheduledIncrementalCandidatePreparationError extends Error {
  readonly code: ScheduledIncrementalCandidatePreparationErrorCode;

  constructor(code: ScheduledIncrementalCandidatePreparationErrorCode) {
    super(code);
    this.name = 'ScheduledIncrementalCandidatePreparationError';
    this.code = code;
  }
}

function freezeArray<T>(items: readonly Readonly<T>[]): readonly Readonly<T>[] {
  return Object.freeze([...items]);
}

function countersFrom(run: Readonly<MigrationRun>): Readonly<MigrationRunCounters> {
  return Object.freeze({
    rowsSeen: run.rowsSeen,
    rowsNew: run.rowsNew,
    rowsChanged: run.rowsChanged,
    rowsMissing: run.rowsMissing,
    rowsAmbiguous: run.rowsAmbiguous,
  });
}

function countersEqual(
  left: Readonly<MigrationRunCounters>,
  right: Readonly<MigrationRunCounters>,
): boolean {
  return left.rowsSeen === right.rowsSeen
    && left.rowsNew === right.rowsNew
    && left.rowsChanged === right.rowsChanged
    && left.rowsMissing === right.rowsMissing
    && left.rowsAmbiguous === right.rowsAmbiguous;
}

export async function prepareScheduledIncrementalCandidate(
  input: Readonly<ScheduledIncrementalCandidatePreparationInput>,
): Promise<Readonly<ScheduledIncrementalCandidatePreparationPlan>> {
  const baseline = buildIncrementalCommittedBaseline(
    input.baselineRun,
    input.sourceEvidence.lineageRecords,
  );

  const sourceAssignmentRequests = buildIncrementalSourceRecordAssignmentRequests(
    baseline.previousSequence,
    input.projection.rows,
  );
  const sourceAssignments = freezeArray(
    await input.sourceIdentityAllocator.allocate(sourceAssignmentRequests),
  );

  const lineage = buildIncrementalLineagePlanFromCommittedBaseline(
    baseline,
    input.projection.rows,
    sourceAssignments,
  );
  const run = createMigrationRun({
    id: input.runId,
    startedAt: input.startedAt,
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    counters: lineage.counters,
  });

  const structural = buildIncrementalStructuralPreparation({
    run,
    baseline,
    currentRows: input.projection.rows,
    sourceAssignments,
    previousSourceCurrent: input.sourceEvidence.sourceCurrent,
    previousRevisionPayloads: input.revisionEvidence.currentRevisionPayloads,
    observedAt: input.observedAt,
  });
  if (!countersEqual(countersFrom(run), structural.lineage.counters)) {
    throw new ScheduledIncrementalCandidatePreparationError('LINEAGE_COUNTER_MISMATCH');
  }

  const currentObservations = buildIncrementalCurrentObservationInputs(input.projection);
  const semantic = buildIncrementalSemanticPreparation({
    structural,
    currentObservations: currentObservations.currentObservations,
    previousSourceCurrent: input.sourceEvidence.sourceCurrent,
    previousTransactions: input.previousTransactions,
    refs: input.refs,
  });

  const transactionAssignmentRequests = buildIncrementalTransactionIdentityAssignmentRequests(
    semantic.transition,
  );
  const transactionAssignments = freezeArray(
    await input.transactionIdentityAllocator.allocate(transactionAssignmentRequests),
  );

  const candidates = buildIncrementalCurrentCandidatePreparation({
    structural,
    semantic,
    previousSourceCurrent: input.sourceEvidence.sourceCurrent,
    previousTransactions: input.previousTransactions,
    transactionAssignments,
    observedAt: input.observedAt,
  });
  const reconciliation = buildExpectedIncrementalCurrentReconciliation(
    candidates.sourceCandidates,
    candidates.transactionCandidates,
  );

  return Object.freeze({
    baseline,
    sourceAssignmentRequests,
    sourceAssignments,
    run,
    structural,
    currentObservations,
    semantic,
    transactionAssignmentRequests,
    transactionAssignments,
    candidates,
    reconciliation,
  });
}
