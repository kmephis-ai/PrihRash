import type { IncrementalSemanticTransitionPlan } from './incrementalSemanticTransition.js';

export interface IncrementalTransactionIdentityAssignmentRequest {
  readonly sourceRecordId: string;
}

export function buildIncrementalTransactionIdentityAssignmentRequests(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
): readonly Readonly<IncrementalTransactionIdentityAssignmentRequest>[] {
  return Object.freeze(transition.decisions
    .filter((decision) => decision.kind === 'CREATE_FINANCIAL_CANDIDATE')
    .map((decision) => Object.freeze({ sourceRecordId: decision.sourceRecordId.toLowerCase() })));
}
