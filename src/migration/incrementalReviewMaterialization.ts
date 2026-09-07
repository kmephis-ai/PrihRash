import type { SourceRowClassification } from '../classification/sourceRow.js';
import type {
  IncrementalSemanticTransitionDecision,
  IncrementalSemanticTransitionPlan,
} from './incrementalSemanticTransition.js';

export interface IncrementalPreviousReviewStateEvidence {
  readonly sourceRecordId: string;
  readonly classification: SourceRowClassification;
  readonly transactionId: string | null;
  readonly resolutionCode: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export type IncrementalReviewMaterializationDirective =
  | Readonly<{
      kind: 'IDENTIFIED_AMBIGUITY';
      sourceRecordId: string;
      state: null;
      classification: 'AMBIGUOUS';
      transactionId: string | null;
      resolutionCode: null;
      resolvedAt: null;
      resolvedBy: null;
    }>
  | Readonly<{
      kind: 'MISSING';
      sourceRecordId: string;
      state: 'MISSING';
      classification: SourceRowClassification;
      transactionId: string | null;
      resolutionCode: null;
      resolvedAt: null;
      resolvedBy: null;
    }>;

export interface IncrementalReviewMaterializationPlan {
  readonly directives: readonly Readonly<IncrementalReviewMaterializationDirective>[];
  readonly promotionBlocker: 'UNRESOLVED_LINEAGE' | null;
  readonly unresolvedRowHints: readonly number[];
}

export type IncrementalReviewMaterializationErrorCode =
  | 'INVALID_PREVIOUS_SOURCE_ID'
  | 'INVALID_PREVIOUS_CLASSIFICATION'
  | 'INVALID_PREVIOUS_TRANSACTION_LINK'
  | 'INCONSISTENT_RESOLUTION_AUDIT'
  | 'DUPLICATE_PREVIOUS_SOURCE_ID'
  | 'MISSING_PREVIOUS_REVIEW_EVIDENCE'
  | 'EXTRA_PREVIOUS_REVIEW_EVIDENCE'
  | 'PREVIOUS_EVIDENCE_MISMATCH'
  | 'RESOLUTION_EPOCH_ROLLOVER_REQUIRED'
  | 'DUPLICATE_REVIEW_DIRECTIVE_SOURCE_ID'
  | 'DUPLICATE_UNRESOLVED_ROW_HINT';

export class IncrementalReviewMaterializationError extends Error {
  readonly code: IncrementalReviewMaterializationErrorCode;

  constructor(code: IncrementalReviewMaterializationErrorCode) {
    super(code);
    this.name = 'IncrementalReviewMaterializationError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLASSIFICATIONS: readonly SourceRowClassification[] = [
  'FINANCIAL_RECORD',
  'LEGACY_PERIOD_CLOSE',
  'NON_FINANCIAL',
  'INVALID',
  'AMBIGUOUS',
];

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function isExistingReviewDecision(
  decision: Readonly<IncrementalSemanticTransitionDecision>,
): decision is Extract<IncrementalSemanticTransitionDecision, {
  kind: 'REVIEW_REQUIRED_PRESERVE' | 'MARK_MISSING_PRESERVE_CANONICAL';
}> {
  return decision.kind === 'REVIEW_REQUIRED_PRESERVE'
    || decision.kind === 'MARK_MISSING_PRESERVE_CANONICAL';
}

function requiredPreviousIds(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
): ReadonlySet<string> {
  return new Set(
    transition.decisions
      .filter(isExistingReviewDecision)
      .map((decision) => normalizedId(decision.sourceRecordId)),
  );
}

function assertAuditShape(item: Readonly<IncrementalPreviousReviewStateEvidence>): void {
  const fields = [item.resolutionCode, item.resolvedAt, item.resolvedBy];
  const nullCount = fields.filter((value) => value === null).length;
  if (nullCount !== 0 && nullCount !== fields.length) {
    throw new IncrementalReviewMaterializationError('INCONSISTENT_RESOLUTION_AUDIT');
  }
  if (nullCount === 0) {
    if (
      item.resolutionCode?.trim().length === 0
      || item.resolvedBy?.trim().length === 0
      || !Number.isFinite(Date.parse(item.resolvedAt ?? ''))
    ) {
      throw new IncrementalReviewMaterializationError('INCONSISTENT_RESOLUTION_AUDIT');
    }
  }
}

function previousEvidenceMap(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
  evidence: readonly Readonly<IncrementalPreviousReviewStateEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousReviewStateEvidence>> {
  const required = requiredPreviousIds(transition);
  const byId = new Map<string, Readonly<IncrementalPreviousReviewStateEvidence>>();

  for (const item of evidence) {
    if (!UUID_PATTERN.test(item.sourceRecordId)) {
      throw new IncrementalReviewMaterializationError('INVALID_PREVIOUS_SOURCE_ID');
    }
    if (!CLASSIFICATIONS.includes(item.classification)) {
      throw new IncrementalReviewMaterializationError('INVALID_PREVIOUS_CLASSIFICATION');
    }
    if (item.transactionId !== null && !UUID_PATTERN.test(item.transactionId)) {
      throw new IncrementalReviewMaterializationError('INVALID_PREVIOUS_TRANSACTION_LINK');
    }
    assertAuditShape(item);

    const sourceRecordId = normalizedId(item.sourceRecordId);
    if (byId.has(sourceRecordId)) {
      throw new IncrementalReviewMaterializationError('DUPLICATE_PREVIOUS_SOURCE_ID');
    }
    if (!required.has(sourceRecordId)) {
      throw new IncrementalReviewMaterializationError('EXTRA_PREVIOUS_REVIEW_EVIDENCE');
    }
    byId.set(sourceRecordId, Object.freeze({
      ...item,
      sourceRecordId,
      transactionId: item.transactionId?.toLowerCase() ?? null,
    }));
  }

  for (const sourceRecordId of required) {
    if (!byId.has(sourceRecordId)) {
      throw new IncrementalReviewMaterializationError('MISSING_PREVIOUS_REVIEW_EVIDENCE');
    }
  }
  return byId;
}

function requireFreshReviewEpoch(
  previous: Readonly<IncrementalPreviousReviewStateEvidence>,
): void {
  if (
    previous.resolutionCode !== null
    || previous.resolvedAt !== null
    || previous.resolvedBy !== null
  ) {
    throw new IncrementalReviewMaterializationError('RESOLUTION_EPOCH_ROLLOVER_REQUIRED');
  }
}

function assertPreviousMatchesDecision(
  decision: Extract<IncrementalSemanticTransitionDecision, { kind: 'REVIEW_REQUIRED_PRESERVE' }>,
  previous: Readonly<IncrementalPreviousReviewStateEvidence>,
): void {
  if (
    previous.classification !== decision.previousClassification
    || previous.transactionId !== decision.transactionId
  ) {
    throw new IncrementalReviewMaterializationError('PREVIOUS_EVIDENCE_MISMATCH');
  }
}

function identifiedAmbiguity(
  sourceRecordId: string,
  transactionId: string | null,
): Readonly<IncrementalReviewMaterializationDirective> {
  return Object.freeze({
    kind: 'IDENTIFIED_AMBIGUITY' as const,
    sourceRecordId,
    state: null,
    classification: 'AMBIGUOUS' as const,
    transactionId,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

function missingDirective(
  sourceRecordId: string,
  previous: Readonly<IncrementalPreviousReviewStateEvidence>,
  transactionId: string | null,
): Readonly<IncrementalReviewMaterializationDirective> {
  if (previous.transactionId !== transactionId) {
    throw new IncrementalReviewMaterializationError('PREVIOUS_EVIDENCE_MISMATCH');
  }
  return Object.freeze({
    kind: 'MISSING' as const,
    sourceRecordId,
    state: 'MISSING' as const,
    classification: previous.classification,
    transactionId,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

export function planIncrementalReviewMaterialization(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
  previousEvidence: readonly Readonly<IncrementalPreviousReviewStateEvidence>[],
): Readonly<IncrementalReviewMaterializationPlan> {
  const previousById = previousEvidenceMap(transition, previousEvidence);
  const directives: Readonly<IncrementalReviewMaterializationDirective>[] = [];
  const directiveIds = new Set<string>();

  const pushDirective = (directive: Readonly<IncrementalReviewMaterializationDirective>): void => {
    if (directiveIds.has(directive.sourceRecordId)) {
      throw new IncrementalReviewMaterializationError('DUPLICATE_REVIEW_DIRECTIVE_SOURCE_ID');
    }
    directiveIds.add(directive.sourceRecordId);
    directives.push(directive);
  };

  for (const decision of transition.decisions) {
    const sourceRecordId = normalizedId(decision.sourceRecordId);

    if (decision.kind === 'CREATE_REVIEW_REQUIRED') {
      pushDirective(identifiedAmbiguity(sourceRecordId, null));
      continue;
    }

    if (decision.kind === 'REVIEW_REQUIRED_PRESERVE') {
      const previous = previousById.get(sourceRecordId);
      if (previous === undefined) {
        throw new IncrementalReviewMaterializationError('MISSING_PREVIOUS_REVIEW_EVIDENCE');
      }
      assertPreviousMatchesDecision(decision, previous);
      requireFreshReviewEpoch(previous);
      pushDirective(identifiedAmbiguity(sourceRecordId, decision.transactionId));
      continue;
    }

    if (decision.kind === 'MARK_MISSING_PRESERVE_CANONICAL') {
      const previous = previousById.get(sourceRecordId);
      if (previous === undefined) {
        throw new IncrementalReviewMaterializationError('MISSING_PREVIOUS_REVIEW_EVIDENCE');
      }
      requireFreshReviewEpoch(previous);
      pushDirective(missingDirective(sourceRecordId, previous, decision.transactionId));
    }
  }

  const unresolvedRowHints: number[] = [];
  const unresolvedHints = new Set<number>();
  for (const observation of transition.unresolvedObservations) {
    if (unresolvedHints.has(observation.currentRowHint)) {
      throw new IncrementalReviewMaterializationError('DUPLICATE_UNRESOLVED_ROW_HINT');
    }
    unresolvedHints.add(observation.currentRowHint);
    unresolvedRowHints.push(observation.currentRowHint);
  }
  unresolvedRowHints.sort((left, right) => left - right);

  return Object.freeze({
    directives: Object.freeze(directives),
    promotionBlocker: unresolvedRowHints.length > 0 ? 'UNRESOLVED_LINEAGE' as const : null,
    unresolvedRowHints: Object.freeze(unresolvedRowHints),
  });
}
