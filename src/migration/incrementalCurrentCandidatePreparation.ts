import {
  buildIncrementalCurrentDeltaPlan,
  type IncrementalCurrentDeltaPlan,
} from './incrementalCurrentDelta.js';
import type { IncrementalSemanticPreparationPlan } from './incrementalSemanticPreparation.js';
import {
  buildIncrementalSourceCurrentCandidatePlan,
  type IncrementalNewTransactionIdentityAssignment,
  type IncrementalPreviousSourceCurrentEvidence,
  type IncrementalSourceCurrentCandidatePlan,
} from './incrementalSourceCurrentCandidate.js';
import type { IncrementalStructuralPreparationPlan } from './incrementalStructuralPreparation.js';
import {
  buildIncrementalTransactionCurrentCandidatePlan,
  type IncrementalPreviousTransactionCurrentEvidence,
  type IncrementalTransactionCurrentCandidatePlan,
} from './incrementalTransactionCurrentCandidate.js';

export interface IncrementalCurrentCandidatePreparationInput {
  readonly structural: Readonly<IncrementalStructuralPreparationPlan>;
  readonly semantic: Readonly<IncrementalSemanticPreparationPlan>;
  readonly previousSourceCurrent: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[];
  readonly previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[];
  readonly transactionAssignments: readonly Readonly<IncrementalNewTransactionIdentityAssignment>[];
  readonly observedAt: string;
}

export interface IncrementalCurrentCandidatePreparationPlan {
  readonly sourceCandidates: Readonly<IncrementalSourceCurrentCandidatePlan>;
  readonly transactionCandidates: Readonly<IncrementalTransactionCurrentCandidatePlan>;
  readonly currentDelta: Readonly<IncrementalCurrentDeltaPlan>;
}

export function buildIncrementalCurrentCandidatePreparation(
  input: Readonly<IncrementalCurrentCandidatePreparationInput>,
): Readonly<IncrementalCurrentCandidatePreparationPlan> {
  const sourceCandidates = buildIncrementalSourceCurrentCandidatePlan(
    input.structural.sourceDelta,
    input.semantic.transition,
    input.previousSourceCurrent,
    input.transactionAssignments,
    input.previousTransactions.map((transaction) => transaction.id),
    input.observedAt,
  );

  const transactionCandidates = buildIncrementalTransactionCurrentCandidatePlan(
    input.previousTransactions,
    input.semantic.transition,
    sourceCandidates,
  );

  const currentDelta = buildIncrementalCurrentDeltaPlan(
    input.previousSourceCurrent,
    input.previousTransactions,
    sourceCandidates,
    transactionCandidates,
  );

  return Object.freeze({ sourceCandidates, transactionCandidates, currentDelta });
}
