import type { SourceRowClassification } from '../classification/sourceRow.js';
import type { CanonicalTransaction } from '../domain/transaction.js';
import type { SourceChangeClass } from './changeClassification.js';
import type {
  IncrementalCurrentObservationSemanticOutcome,
  IncrementalCurrentObservationSemanticPlan,
} from './incrementalCurrentObservationSemantics.js';
import type { IncrementalRevisionEvidencePlan } from './incrementalRevisionEvidence.js';
import type {
  IncrementalSourceDeltaIntent,
  IncrementalSourceDeltaIntentPlan,
} from './incrementalSourceDeltaIntent.js';

export interface IncrementalPreviousSemanticEvidence {
  readonly sourceRecordId: string;
  readonly classification: SourceRowClassification;
  readonly transactionId: string | null;
  readonly transactionVersion: number | null;
}

export type IncrementalSemanticTransitionDecision =
  | Readonly<{
      kind: 'TOUCH_PRESERVE';
      sourceRecordId: string;
      classification: SourceRowClassification;
    }>
  | Readonly<{
      kind: 'REVIEW_REQUIRED_PRESERVE';
      sourceRecordId: string;
      reason: 'CONTEXTUAL_CLASSIFICATION_DRIFT' | 'SEMANTIC_TRANSITION' | 'AMBIGUOUS_CHANGE';
      previousClassification: SourceRowClassification;
      currentClassification: SourceRowClassification | null;
      transactionId: string | null;
      changeClass: Exclude<SourceChangeClass, 'NO_CHANGE'> | null;
    }>
  | Readonly<{
      kind: 'CREATE_SOURCE_ONLY';
      sourceRecordId: string;
      classification: 'NON_FINANCIAL' | 'LEGACY_PERIOD_CLOSE';
    }>
  | Readonly<{
      kind: 'CREATE_REVIEW_REQUIRED';
      sourceRecordId: string;
      classification: 'AMBIGUOUS';
    }>
  | Readonly<{
      kind: 'CREATE_FINANCIAL_CANDIDATE';
      sourceRecordId: string;
      transaction: Readonly<CanonicalTransaction>;
      transactionIdentityAssignmentRequired: true;
    }>
  | Readonly<{
      kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE';
      sourceRecordId: string;
      transactionId: string;
      expectedTransactionVersion: number;
      transaction: Readonly<CanonicalTransaction>;
    }>
  | Readonly<{
      kind: 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL';
      sourceRecordId: string;
      transactionId: string;
    }>
  | Readonly<{
      kind: 'MARK_MISSING_PRESERVE_CANONICAL';
      sourceRecordId: string;
      transactionId: string | null;
    }>
  | Readonly<{
      kind: 'BLOCK_VALIDATION';
      sourceRecordId: string;
      reason: 'INVALID_CURRENT_OBSERVATION' | 'FINANCIAL_PROJECTION_FAILED' | 'FINANCIAL_PROJECTION_BLOCKED';
    }>;

export interface IncrementalUnresolvedSemanticObservation {
  readonly currentRowHint: number;
  readonly sourceOrdinal: number;
  readonly classification: SourceRowClassification;
  readonly blocksValidation: boolean;
}

export interface IncrementalSemanticTransitionPlan {
  readonly decisions: readonly Readonly<IncrementalSemanticTransitionDecision>[];
  readonly unresolvedObservations: readonly Readonly<IncrementalUnresolvedSemanticObservation>[];
}

export type IncrementalSemanticTransitionErrorCode =
  | 'INVALID_PREVIOUS_SOURCE_ID'
  | 'INVALID_PREVIOUS_CLASSIFICATION'
  | 'INVALID_PREVIOUS_TRANSACTION_LINK'
  | 'DUPLICATE_PREVIOUS_SOURCE_ID'
  | 'MISSING_PREVIOUS_SEMANTIC_EVIDENCE'
  | 'EXTRA_PREVIOUS_SEMANTIC_EVIDENCE'
  | 'DUPLICATE_OBSERVATION_ROW_HINT'
  | 'OBSERVATION_INTENT_MISMATCH'
  | 'UNRESOLVED_OBSERVATION_MISMATCH'
  | 'DUPLICATE_REVISION_SOURCE_ID'
  | 'MISSING_REVISED_CHANGE_CLASS'
  | 'REVISION_INTENT_MISMATCH';

export class IncrementalSemanticTransitionError extends Error {
  readonly code: IncrementalSemanticTransitionErrorCode;

  constructor(code: IncrementalSemanticTransitionErrorCode) {
    super(code);
    this.name = 'IncrementalSemanticTransitionError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLASSIFICATIONS: readonly SourceRowClassification[] = [
  'FINANCIAL_RECORD', 'LEGACY_PERIOD_CLOSE', 'NON_FINANCIAL', 'INVALID', 'AMBIGUOUS',
];

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function requiredPreviousIds(deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>): ReadonlySet<string> {
  return new Set(deltaPlan.intents
    .filter((intent) => intent.kind !== 'CREATE')
    .map((intent) => normalizedId(intent.sourceRecordId)));
}

function previousEvidenceMap(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  evidence: readonly Readonly<IncrementalPreviousSemanticEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousSemanticEvidence>> {
  const required = requiredPreviousIds(deltaPlan);
  const byId = new Map<string, Readonly<IncrementalPreviousSemanticEvidence>>();
  for (const item of evidence) {
    if (!UUID_PATTERN.test(item.sourceRecordId)) {
      throw new IncrementalSemanticTransitionError('INVALID_PREVIOUS_SOURCE_ID');
    }
    if (!CLASSIFICATIONS.includes(item.classification)) {
      throw new IncrementalSemanticTransitionError('INVALID_PREVIOUS_CLASSIFICATION');
    }
    const sourceRecordId = normalizedId(item.sourceRecordId);
    if (byId.has(sourceRecordId)) {
      throw new IncrementalSemanticTransitionError('DUPLICATE_PREVIOUS_SOURCE_ID');
    }
    if (!required.has(sourceRecordId)) {
      throw new IncrementalSemanticTransitionError('EXTRA_PREVIOUS_SEMANTIC_EVIDENCE');
    }
    if (item.transactionId === null) {
      if (item.transactionVersion !== null) {
        throw new IncrementalSemanticTransitionError('INVALID_PREVIOUS_TRANSACTION_LINK');
      }
    } else if (
      !UUID_PATTERN.test(item.transactionId)
      || !Number.isSafeInteger(item.transactionVersion)
      || (item.transactionVersion ?? 0) < 1
    ) {
      throw new IncrementalSemanticTransitionError('INVALID_PREVIOUS_TRANSACTION_LINK');
    }
    byId.set(sourceRecordId, Object.freeze({
      ...item,
      sourceRecordId,
      transactionId: item.transactionId?.toLowerCase() ?? null,
    }));
  }
  for (const sourceRecordId of required) {
    if (!byId.has(sourceRecordId)) {
      throw new IncrementalSemanticTransitionError('MISSING_PREVIOUS_SEMANTIC_EVIDENCE');
    }
  }
  return byId;
}

function observationMaps(plan: Readonly<IncrementalCurrentObservationSemanticPlan>): {
  byRowHint: ReadonlyMap<number, Readonly<IncrementalCurrentObservationSemanticOutcome>>;
  unresolved: readonly Readonly<IncrementalCurrentObservationSemanticOutcome>[];
} {
  const byRowHint = new Map<number, Readonly<IncrementalCurrentObservationSemanticOutcome>>();
  const unresolved: Readonly<IncrementalCurrentObservationSemanticOutcome>[] = [];
  for (const outcome of plan.outcomes) {
    if (byRowHint.has(outcome.currentRowHint)) {
      throw new IncrementalSemanticTransitionError('DUPLICATE_OBSERVATION_ROW_HINT');
    }
    byRowHint.set(outcome.currentRowHint, outcome);
    if (outcome.lineageKind === 'UNRESOLVED') unresolved.push(outcome);
  }
  return { byRowHint, unresolved };
}

function assertObservationMatchesIntent(
  intent: Exclude<IncrementalSourceDeltaIntent, { kind: 'MARK_MISSING' }>,
  outcome: Readonly<IncrementalCurrentObservationSemanticOutcome> | undefined,
): Readonly<IncrementalCurrentObservationSemanticOutcome> {
  if (
    outcome === undefined
    || outcome.lineageKind !== intent.kind
    || outcome.sourceRecordId === null
    || normalizedId(outcome.sourceRecordId) !== normalizedId(intent.sourceRecordId)
  ) {
    throw new IncrementalSemanticTransitionError('OBSERVATION_INTENT_MISMATCH');
  }
  return outcome;
}

function revisionChangeMap(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  revisionPlan: Readonly<IncrementalRevisionEvidencePlan>,
): ReadonlyMap<string, Exclude<SourceChangeClass, 'NO_CHANGE'>> {
  const expected = new Map(deltaPlan.intents
    .filter((intent): intent is Extract<IncrementalSourceDeltaIntent, { kind: 'REVISE' }> => intent.kind === 'REVISE')
    .map((intent) => [normalizedId(intent.sourceRecordId), intent] as const));
  const byId = new Map<string, Exclude<SourceChangeClass, 'NO_CHANGE'>>();
  for (const revision of revisionPlan.revisions) {
    const sourceRecordId = normalizedId(revision.sourceRecordId);
    const reviseIntent = expected.get(sourceRecordId);
    if (reviseIntent === undefined) continue;
    if (byId.has(sourceRecordId)) {
      throw new IncrementalSemanticTransitionError('DUPLICATE_REVISION_SOURCE_ID');
    }
    if (
      revision.changeClass === null
      || revision.revision !== reviseIntent.currentRevision
      || revision.rowHint !== reviseIntent.currentRowHint
      || revision.rowDigest !== reviseIntent.currentDigest
    ) {
      throw new IncrementalSemanticTransitionError('REVISION_INTENT_MISMATCH');
    }
    byId.set(sourceRecordId, revision.changeClass);
  }
  for (const sourceRecordId of expected.keys()) {
    if (!byId.has(sourceRecordId)) {
      throw new IncrementalSemanticTransitionError('MISSING_REVISED_CHANGE_CLASS');
    }
  }
  return byId;
}

function blockedDecision(
  sourceRecordId: string,
  outcome: Readonly<IncrementalCurrentObservationSemanticOutcome>,
): Readonly<IncrementalSemanticTransitionDecision> | null {
  if (outcome.classification === 'INVALID') {
    return Object.freeze({
      kind: 'BLOCK_VALIDATION' as const,
      sourceRecordId,
      reason: 'INVALID_CURRENT_OBSERVATION' as const,
    });
  }
  if (outcome.classification === 'FINANCIAL_RECORD') {
    if (outcome.financialProjection.status === 'FAILED') {
      return Object.freeze({
        kind: 'BLOCK_VALIDATION' as const,
        sourceRecordId,
        reason: 'FINANCIAL_PROJECTION_FAILED' as const,
      });
    }
    if (outcome.financialProjection.status === 'BLOCKED') {
      return Object.freeze({
        kind: 'BLOCK_VALIDATION' as const,
        sourceRecordId,
        reason: 'FINANCIAL_PROJECTION_BLOCKED' as const,
      });
    }
  }
  return null;
}

function reviewPreserve(
  sourceRecordId: string,
  reason: 'CONTEXTUAL_CLASSIFICATION_DRIFT' | 'SEMANTIC_TRANSITION' | 'AMBIGUOUS_CHANGE',
  previous: Readonly<IncrementalPreviousSemanticEvidence>,
  currentClassification: SourceRowClassification | null,
  changeClass: Exclude<SourceChangeClass, 'NO_CHANGE'> | null,
): Readonly<IncrementalSemanticTransitionDecision> {
  return Object.freeze({
    kind: 'REVIEW_REQUIRED_PRESERVE' as const,
    sourceRecordId,
    reason,
    previousClassification: previous.classification,
    currentClassification,
    transactionId: previous.transactionId,
    changeClass,
  });
}

export function buildIncrementalSemanticTransitionPlan(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  observationPlan: Readonly<IncrementalCurrentObservationSemanticPlan>,
  revisionPlan: Readonly<IncrementalRevisionEvidencePlan>,
  previousSemanticEvidence: readonly Readonly<IncrementalPreviousSemanticEvidence>[],
): Readonly<IncrementalSemanticTransitionPlan> {
  const previousById = previousEvidenceMap(deltaPlan, previousSemanticEvidence);
  const observations = observationMaps(observationPlan);
  const changeById = revisionChangeMap(deltaPlan, revisionPlan);
  const decisions: Readonly<IncrementalSemanticTransitionDecision>[] = [];
  const consumedRows = new Set<number>();

  for (const intent of deltaPlan.intents) {
    const sourceRecordId = normalizedId(intent.sourceRecordId);
    if (intent.kind === 'MARK_MISSING') {
      const previous = previousById.get(sourceRecordId);
      if (previous === undefined) {
        throw new IncrementalSemanticTransitionError('MISSING_PREVIOUS_SEMANTIC_EVIDENCE');
      }
      decisions.push(Object.freeze({
        kind: 'MARK_MISSING_PRESERVE_CANONICAL' as const,
        sourceRecordId,
        transactionId: previous.transactionId,
      }));
      continue;
    }

    const outcome = assertObservationMatchesIntent(intent, observations.byRowHint.get(intent.currentRowHint));
    consumedRows.add(intent.currentRowHint);
    const blocked = blockedDecision(sourceRecordId, outcome);
    if (blocked !== null) {
      decisions.push(blocked);
      continue;
    }

    if (intent.kind === 'CREATE') {
      if (outcome.classification === 'FINANCIAL_RECORD') {
        if (outcome.financialProjection.status !== 'CANDIDATE') {
          throw new IncrementalSemanticTransitionError('OBSERVATION_INTENT_MISMATCH');
        }
        decisions.push(Object.freeze({
          kind: 'CREATE_FINANCIAL_CANDIDATE' as const,
          sourceRecordId,
          transaction: outcome.financialProjection.transaction,
          transactionIdentityAssignmentRequired: true as const,
        }));
      } else if (outcome.classification === 'AMBIGUOUS') {
        decisions.push(Object.freeze({
          kind: 'CREATE_REVIEW_REQUIRED' as const,
          sourceRecordId,
          classification: 'AMBIGUOUS' as const,
        }));
      } else if (
        outcome.classification === 'NON_FINANCIAL'
        || outcome.classification === 'LEGACY_PERIOD_CLOSE'
      ) {
        decisions.push(Object.freeze({
          kind: 'CREATE_SOURCE_ONLY' as const,
          sourceRecordId,
          classification: outcome.classification,
        }));
      } else {
        throw new IncrementalSemanticTransitionError('OBSERVATION_INTENT_MISMATCH');
      }
      continue;
    }

    const previous = previousById.get(sourceRecordId);
    if (previous === undefined) {
      throw new IncrementalSemanticTransitionError('MISSING_PREVIOUS_SEMANTIC_EVIDENCE');
    }
    if (intent.kind === 'TOUCH') {
      decisions.push(
        outcome.classification === previous.classification
          ? Object.freeze({
              kind: 'TOUCH_PRESERVE' as const,
              sourceRecordId,
              classification: previous.classification,
            })
          : reviewPreserve(
              sourceRecordId,
              'CONTEXTUAL_CLASSIFICATION_DRIFT',
              previous,
              outcome.classification,
              null,
            ),
      );
      continue;
    }

    const changeClass = changeById.get(sourceRecordId);
    if (changeClass === undefined) {
      throw new IncrementalSemanticTransitionError('MISSING_REVISED_CHANGE_CLASS');
    }
    if (changeClass === 'AMBIGUOUS_CHANGE') {
      decisions.push(reviewPreserve(
        sourceRecordId, 'AMBIGUOUS_CHANGE', previous, outcome.classification, changeClass,
      ));
      continue;
    }
    if (changeClass === 'WORKFLOW_TRANSFORM') {
      if (
        previous.classification === 'FINANCIAL_RECORD'
        && previous.transactionId !== null
        && outcome.classification === 'FINANCIAL_RECORD'
      ) {
        decisions.push(Object.freeze({
          kind: 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL' as const,
          sourceRecordId,
          transactionId: previous.transactionId,
        }));
      } else {
        decisions.push(reviewPreserve(
          sourceRecordId, 'SEMANTIC_TRANSITION', previous, outcome.classification, changeClass,
        ));
      }
      continue;
    }

    if (
      previous.classification === 'FINANCIAL_RECORD'
      && previous.transactionId !== null
      && previous.transactionVersion !== null
      && outcome.classification === 'FINANCIAL_RECORD'
      && outcome.financialProjection.status === 'CANDIDATE'
    ) {
      decisions.push(Object.freeze({
        kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE' as const,
        sourceRecordId,
        transactionId: previous.transactionId,
        expectedTransactionVersion: previous.transactionVersion,
        transaction: outcome.financialProjection.transaction,
      }));
    } else {
      decisions.push(reviewPreserve(
        sourceRecordId, 'SEMANTIC_TRANSITION', previous, outcome.classification, changeClass,
      ));
    }
  }

  const expectedUnresolvedRows = new Set(deltaPlan.unresolvedBlocks.flatMap((block) => block.currentRowHints));
  const unresolvedObservations: Readonly<IncrementalUnresolvedSemanticObservation>[] = [];
  for (const outcome of observations.unresolved) {
    if (!expectedUnresolvedRows.has(outcome.currentRowHint)) {
      throw new IncrementalSemanticTransitionError('UNRESOLVED_OBSERVATION_MISMATCH');
    }
    consumedRows.add(outcome.currentRowHint);
    unresolvedObservations.push(Object.freeze({
      currentRowHint: outcome.currentRowHint,
      sourceOrdinal: outcome.sourceOrdinal,
      classification: outcome.classification,
      blocksValidation: outcome.classification === 'INVALID',
    }));
  }
  if (unresolvedObservations.length !== expectedUnresolvedRows.size) {
    throw new IncrementalSemanticTransitionError('UNRESOLVED_OBSERVATION_MISMATCH');
  }
  if (consumedRows.size !== observationPlan.outcomes.length) {
    throw new IncrementalSemanticTransitionError('OBSERVATION_INTENT_MISMATCH');
  }

  return Object.freeze({
    decisions: Object.freeze(decisions),
    unresolvedObservations: Object.freeze(unresolvedObservations),
  });
}
