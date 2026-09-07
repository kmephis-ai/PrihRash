import type { ReferenceResolver } from '../normalization/types.js';
import {
  buildIncrementalCurrentObservationSemanticPlan,
  type IncrementalCurrentObservationInput,
  type IncrementalCurrentObservationSemanticPlan,
} from './incrementalCurrentObservationSemantics.js';
import {
  buildIncrementalPreviousSemanticEvidence,
  type IncrementalPreviousSemanticEvidenceProjection,
} from './incrementalPreviousSemanticEvidence.js';
import {
  buildIncrementalSemanticTransitionPlan,
  type IncrementalSemanticTransitionPlan,
} from './incrementalSemanticTransition.js';
import type { IncrementalPreviousSourceCurrentEvidence } from './incrementalSourceCurrentCandidate.js';
import type { IncrementalStructuralPreparationPlan } from './incrementalStructuralPreparation.js';
import type { IncrementalPreviousTransactionCurrentEvidence } from './incrementalTransactionCurrentCandidate.js';

export interface IncrementalSemanticPreparationInput {
  readonly structural: Readonly<IncrementalStructuralPreparationPlan>;
  readonly currentObservations: readonly Readonly<IncrementalCurrentObservationInput>[];
  readonly previousSourceCurrent: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[];
  readonly previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[];
  readonly refs: ReferenceResolver;
}

export interface IncrementalSemanticPreparationPlan {
  readonly previous: Readonly<IncrementalPreviousSemanticEvidenceProjection>;
  readonly observations: Readonly<IncrementalCurrentObservationSemanticPlan>;
  readonly transition: Readonly<IncrementalSemanticTransitionPlan>;
}

export function buildIncrementalSemanticPreparation(
  input: Readonly<IncrementalSemanticPreparationInput>,
): Readonly<IncrementalSemanticPreparationPlan> {
  const previous = buildIncrementalPreviousSemanticEvidence(
    input.structural.sourceDelta,
    input.previousSourceCurrent,
    input.previousTransactions,
  );

  const observations = buildIncrementalCurrentObservationSemanticPlan(
    input.currentObservations,
    input.structural.sourceDelta,
    previous.financialQualityEvidence,
    input.refs,
  );

  const transition = buildIncrementalSemanticTransitionPlan(
    input.structural.sourceDelta,
    observations,
    input.structural.revisions,
    previous.semanticEvidence,
  );

  return Object.freeze({ previous, observations, transition });
}
