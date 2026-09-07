import type { SourceRowClassification } from '../classification/sourceRow.js';
import { SOURCE_SHEET_NAME } from '../integration/google/sourceSchema.js';
import {
  planIncrementalReviewMaterialization,
  type IncrementalReviewMaterializationDirective,
} from './incrementalReviewMaterialization.js';
import type {
  IncrementalSemanticTransitionDecision,
  IncrementalSemanticTransitionPlan,
} from './incrementalSemanticTransition.js';
import type {
  IncrementalSourceDeltaIntent,
  IncrementalSourceDeltaIntentPlan,
} from './incrementalSourceDeltaIntent.js';

export interface IncrementalPreviousSourceCurrentEvidence {
  readonly id: string;
  readonly sourceType: 'GOOGLE_SHEETS';
  readonly sourceSheet: typeof SOURCE_SHEET_NAME;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastRowHint: number;
  readonly currentDigest: string;
  readonly state: 'MISSING' | null;
  readonly classification: SourceRowClassification;
  readonly normalizationStatus: string | null;
  readonly transactionId: string | null;
  readonly currentRevision: number;
  readonly resolutionCode: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export interface IncrementalNewTransactionIdentityAssignment {
  readonly sourceRecordId: string;
  readonly transactionId: string;
}

export interface IncrementalSourceCurrentCandidate extends IncrementalPreviousSourceCurrentEvidence {}

export interface IncrementalSourceCurrentCandidatePlan {
  readonly sourceRecords: readonly Readonly<IncrementalSourceCurrentCandidate>[];
  readonly promotionBlocker: 'UNRESOLVED_LINEAGE' | null;
  readonly unresolvedRowHints: readonly number[];
}

export type IncrementalSourceCurrentCandidateErrorCode =
  | 'INVALID_OBSERVED_AT'
  | 'INVALID_PREVIOUS_SOURCE_ID'
  | 'DUPLICATE_PREVIOUS_SOURCE_ID'
  | 'INVALID_PREVIOUS_SOURCE_TYPE'
  | 'INVALID_PREVIOUS_SOURCE_SHEET'
  | 'INVALID_PREVIOUS_TIMESTAMP'
  | 'INVALID_PREVIOUS_ROW_HINT'
  | 'INVALID_PREVIOUS_DIGEST'
  | 'INVALID_PREVIOUS_STATE'
  | 'INVALID_PREVIOUS_CLASSIFICATION'
  | 'INVALID_PREVIOUS_TRANSACTION_LINK'
  | 'INVALID_PREVIOUS_REVISION'
  | 'INCONSISTENT_PREVIOUS_RESOLUTION_AUDIT'
  | 'DUPLICATE_INTENT_SOURCE_ID'
  | 'DUPLICATE_TRANSITION_SOURCE_ID'
  | 'MISSING_TRANSITION_DECISION'
  | 'EXTRA_TRANSITION_DECISION'
  | 'PREVIOUS_ACTIVE_COVERAGE_MISMATCH'
  | 'UNRESOLVED_PREVIOUS_EVIDENCE_MISMATCH'
  | 'INTENT_PREVIOUS_EVIDENCE_MISMATCH'
  | 'INTENT_OBSERVED_AT_MISMATCH'
  | 'TRANSITION_INTENT_MISMATCH'
  | 'TRANSITION_BLOCKS_CANDIDATE'
  | 'INVALID_TRANSACTION_ASSIGNMENT_UUID'
  | 'DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID'
  | 'DUPLICATE_TRANSACTION_ASSIGNMENT_ID'
  | 'TRANSACTION_ASSIGNMENT_COLLISION'
  | 'MISSING_TRANSACTION_ASSIGNMENT'
  | 'EXTRA_TRANSACTION_ASSIGNMENT'
  | 'DUPLICATE_RESERVED_TRANSACTION_ID';

export class IncrementalSourceCurrentCandidateError extends Error {
  readonly code: IncrementalSourceCurrentCandidateErrorCode;

  constructor(code: IncrementalSourceCurrentCandidateErrorCode) {
    super(code);
    this.name = 'IncrementalSourceCurrentCandidateError';
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

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function assertResolutionAudit(record: Readonly<IncrementalPreviousSourceCurrentEvidence>): void {
  const fields = [record.resolutionCode, record.resolvedAt, record.resolvedBy];
  const nullCount = fields.filter((value) => value === null).length;
  if (nullCount !== 0 && nullCount !== fields.length) {
    throw new IncrementalSourceCurrentCandidateError('INCONSISTENT_PREVIOUS_RESOLUTION_AUDIT');
  }
  if (nullCount === 0 && (
    record.resolutionCode?.trim().length === 0
    || record.resolvedBy?.trim().length === 0
    || !validTimestamp(record.resolvedAt ?? '')
  )) {
    throw new IncrementalSourceCurrentCandidateError('INCONSISTENT_PREVIOUS_RESOLUTION_AUDIT');
  }
}

function previousMap(
  records: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousSourceCurrentEvidence>> {
  const byId = new Map<string, Readonly<IncrementalPreviousSourceCurrentEvidence>>();
  for (const record of records) {
    if (!UUID_PATTERN.test(record.id)) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_SOURCE_ID');
    }
    const id = normalizedId(record.id);
    if (byId.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('DUPLICATE_PREVIOUS_SOURCE_ID');
    }
    if (record.sourceType !== 'GOOGLE_SHEETS') {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_SOURCE_TYPE');
    }
    if (record.sourceSheet !== SOURCE_SHEET_NAME) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_SOURCE_SHEET');
    }
    if (!validTimestamp(record.firstSeenAt) || !validTimestamp(record.lastSeenAt)) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_TIMESTAMP');
    }
    if (!Number.isSafeInteger(record.lastRowHint) || record.lastRowHint <= 0) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_ROW_HINT');
    }
    if (record.currentDigest.trim().length === 0) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_DIGEST');
    }
    if (record.state !== null && record.state !== 'MISSING') {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_STATE');
    }
    if (!CLASSIFICATIONS.includes(record.classification)) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_CLASSIFICATION');
    }
    if (record.transactionId !== null && !UUID_PATTERN.test(record.transactionId)) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_TRANSACTION_LINK');
    }
    if (!Number.isSafeInteger(record.currentRevision) || record.currentRevision < 1) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_PREVIOUS_REVISION');
    }
    assertResolutionAudit(record);
    byId.set(id, Object.freeze({
      ...record,
      id,
      transactionId: record.transactionId?.toLowerCase() ?? null,
    }));
  }
  return byId;
}

function intentMap(
  delta: Readonly<IncrementalSourceDeltaIntentPlan>,
): ReadonlyMap<string, Readonly<IncrementalSourceDeltaIntent>> {
  const byId = new Map<string, Readonly<IncrementalSourceDeltaIntent>>();
  for (const intent of delta.intents) {
    const id = normalizedId(intent.sourceRecordId);
    if (byId.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('DUPLICATE_INTENT_SOURCE_ID');
    }
    byId.set(id, intent);
  }
  return byId;
}

function decisionMap(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
): ReadonlyMap<string, Readonly<IncrementalSemanticTransitionDecision>> {
  const byId = new Map<string, Readonly<IncrementalSemanticTransitionDecision>>();
  for (const decision of transition.decisions) {
    const id = normalizedId(decision.sourceRecordId);
    if (byId.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('DUPLICATE_TRANSITION_SOURCE_ID');
    }
    byId.set(id, decision);
  }
  return byId;
}

function unresolvedPreviousIds(
  delta: Readonly<IncrementalSourceDeltaIntentPlan>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const block of delta.unresolvedBlocks) {
    for (const value of block.previousSourceRecordIds) {
      const id = normalizedId(value);
      if (ids.has(id)) {
        throw new IncrementalSourceCurrentCandidateError('UNRESOLVED_PREVIOUS_EVIDENCE_MISMATCH');
      }
      ids.add(id);
    }
  }
  return ids;
}

function assertPlanCoverage(
  previousById: ReadonlyMap<string, Readonly<IncrementalPreviousSourceCurrentEvidence>>,
  intentsById: ReadonlyMap<string, Readonly<IncrementalSourceDeltaIntent>>,
  decisionsById: ReadonlyMap<string, Readonly<IncrementalSemanticTransitionDecision>>,
  unresolvedIds: ReadonlySet<string>,
): void {
  for (const [id, intent] of intentsById) {
    if (!decisionsById.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('MISSING_TRANSITION_DECISION');
    }
    const previous = previousById.get(id);
    if (intent.kind === 'CREATE') {
      if (previous !== undefined) {
        throw new IncrementalSourceCurrentCandidateError('INTENT_PREVIOUS_EVIDENCE_MISMATCH');
      }
    } else if (previous === undefined || previous.state !== null) {
      throw new IncrementalSourceCurrentCandidateError('INTENT_PREVIOUS_EVIDENCE_MISMATCH');
    }
  }
  for (const id of decisionsById.keys()) {
    if (!intentsById.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('EXTRA_TRANSITION_DECISION');
    }
  }
  for (const id of unresolvedIds) {
    const previous = previousById.get(id);
    if (previous === undefined || previous.state !== null || intentsById.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('UNRESOLVED_PREVIOUS_EVIDENCE_MISMATCH');
    }
  }
  for (const [id, previous] of previousById) {
    if (previous.state === null && !intentsById.has(id) && !unresolvedIds.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('PREVIOUS_ACTIVE_COVERAGE_MISMATCH');
    }
    if (previous.state === 'MISSING' && (intentsById.has(id) || unresolvedIds.has(id))) {
      throw new IncrementalSourceCurrentCandidateError('PREVIOUS_ACTIVE_COVERAGE_MISMATCH');
    }
  }
}

function reservedTransactionIds(values: readonly string[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (!UUID_PATTERN.test(value)) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_TRANSACTION_ASSIGNMENT_UUID');
    }
    const id = normalizedId(value);
    if (ids.has(id)) {
      throw new IncrementalSourceCurrentCandidateError('DUPLICATE_RESERVED_TRANSACTION_ID');
    }
    ids.add(id);
  }
  return ids;
}

function transactionAssignmentMap(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
  assignments: readonly Readonly<IncrementalNewTransactionIdentityAssignment>[],
  reserved: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const required = new Set(
    transition.decisions
      .filter((decision) => decision.kind === 'CREATE_FINANCIAL_CANDIDATE')
      .map((decision) => normalizedId(decision.sourceRecordId)),
  );
  const bySource = new Map<string, string>();
  const assignedTransactionIds = new Set<string>();

  for (const assignment of assignments) {
    if (!UUID_PATTERN.test(assignment.sourceRecordId) || !UUID_PATTERN.test(assignment.transactionId)) {
      throw new IncrementalSourceCurrentCandidateError('INVALID_TRANSACTION_ASSIGNMENT_UUID');
    }
    const sourceId = normalizedId(assignment.sourceRecordId);
    const transactionId = normalizedId(assignment.transactionId);
    if (bySource.has(sourceId)) {
      throw new IncrementalSourceCurrentCandidateError('DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID');
    }
    if (assignedTransactionIds.has(transactionId)) {
      throw new IncrementalSourceCurrentCandidateError('DUPLICATE_TRANSACTION_ASSIGNMENT_ID');
    }
    if (reserved.has(transactionId)) {
      throw new IncrementalSourceCurrentCandidateError('TRANSACTION_ASSIGNMENT_COLLISION');
    }
    if (!required.has(sourceId)) {
      throw new IncrementalSourceCurrentCandidateError('EXTRA_TRANSACTION_ASSIGNMENT');
    }
    bySource.set(sourceId, transactionId);
    assignedTransactionIds.add(transactionId);
  }
  for (const sourceId of required) {
    if (!bySource.has(sourceId)) {
      throw new IncrementalSourceCurrentCandidateError('MISSING_TRANSACTION_ASSIGNMENT');
    }
  }
  return bySource;
}

function assertIntentPrevious(
  intent: Exclude<IncrementalSourceDeltaIntent, { kind: 'CREATE' }>,
  previous: Readonly<IncrementalPreviousSourceCurrentEvidence>,
): void {
  const expectedRevision = intent.kind === 'REVISE' ? intent.expectedPreviousRevision : intent.expectedRevision;
  const expectedDigest = intent.kind === 'REVISE' ? intent.expectedPreviousDigest : intent.expectedDigest;
  if (
    previous.currentRevision !== expectedRevision
    || previous.currentDigest !== expectedDigest
    || previous.lastRowHint !== intent.previousRowHint
  ) {
    throw new IncrementalSourceCurrentCandidateError('INTENT_PREVIOUS_EVIDENCE_MISMATCH');
  }
}

function assertObservedAt(intent: Exclude<IncrementalSourceDeltaIntent, { kind: 'MARK_MISSING' }>, observedAt: string): void {
  if (intent.observedAt !== observedAt) {
    throw new IncrementalSourceCurrentCandidateError('INTENT_OBSERVED_AT_MISMATCH');
  }
}

function reviewDirectiveMap(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
  previousById: ReadonlyMap<string, Readonly<IncrementalPreviousSourceCurrentEvidence>>,
): ReturnType<typeof planIncrementalReviewMaterialization> & {
  readonly bySource: ReadonlyMap<string, Readonly<IncrementalReviewMaterializationDirective>>;
} {
  const previousReviewEvidence = transition.decisions
    .filter((decision) => decision.kind === 'REVIEW_REQUIRED_PRESERVE'
      || decision.kind === 'MARK_MISSING_PRESERVE_CANONICAL')
    .map((decision) => {
      const previous = previousById.get(normalizedId(decision.sourceRecordId));
      if (previous === undefined) {
        throw new IncrementalSourceCurrentCandidateError('INTENT_PREVIOUS_EVIDENCE_MISMATCH');
      }
      return Object.freeze({
        sourceRecordId: previous.id,
        classification: previous.classification,
        transactionId: previous.transactionId,
        resolutionCode: previous.resolutionCode,
        resolvedAt: previous.resolvedAt,
        resolvedBy: previous.resolvedBy,
      });
    });
  const review = planIncrementalReviewMaterialization(transition, previousReviewEvidence);
  return Object.freeze({
    ...review,
    bySource: new Map(review.directives.map((directive) => [directive.sourceRecordId, directive] as const)),
  });
}

function frozenRecord(record: IncrementalSourceCurrentCandidate): Readonly<IncrementalSourceCurrentCandidate> {
  return Object.freeze({ ...record });
}

export function buildIncrementalSourceCurrentCandidatePlan(
  delta: Readonly<IncrementalSourceDeltaIntentPlan>,
  transition: Readonly<IncrementalSemanticTransitionPlan>,
  previousRecords: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  transactionAssignments: readonly Readonly<IncrementalNewTransactionIdentityAssignment>[],
  existingTransactionIds: readonly string[],
  observedAt: string,
): Readonly<IncrementalSourceCurrentCandidatePlan> {
  if (!validTimestamp(observedAt)) {
    throw new IncrementalSourceCurrentCandidateError('INVALID_OBSERVED_AT');
  }

  const previousById = previousMap(previousRecords);
  const intentsById = intentMap(delta);
  const decisionsById = decisionMap(transition);
  const unresolvedIds = unresolvedPreviousIds(delta);
  assertPlanCoverage(previousById, intentsById, decisionsById, unresolvedIds);
  const assignments = transactionAssignmentMap(transition, transactionAssignments, reservedTransactionIds(existingTransactionIds));
  const review = reviewDirectiveMap(transition, previousById);
  const candidates = new Map<string, Readonly<IncrementalSourceCurrentCandidate>>();

  for (const [id, previous] of previousById) {
    candidates.set(id, previous);
  }

  for (const [id, intent] of intentsById) {
    const decision = decisionsById.get(id);
    if (decision === undefined) {
      throw new IncrementalSourceCurrentCandidateError('MISSING_TRANSITION_DECISION');
    }
    if (decision.kind === 'BLOCK_VALIDATION') {
      throw new IncrementalSourceCurrentCandidateError('TRANSITION_BLOCKS_CANDIDATE');
    }

    if (intent.kind === 'CREATE') {
      assertObservedAt(intent, observedAt);
      let classification: SourceRowClassification;
      let transactionId: string | null = null;
      if (decision.kind === 'CREATE_FINANCIAL_CANDIDATE') {
        classification = 'FINANCIAL_RECORD';
        transactionId = assignments.get(id) ?? null;
        if (transactionId === null) {
          throw new IncrementalSourceCurrentCandidateError('MISSING_TRANSACTION_ASSIGNMENT');
        }
      } else if (decision.kind === 'CREATE_SOURCE_ONLY') {
        classification = decision.classification;
      } else if (decision.kind === 'CREATE_REVIEW_REQUIRED') {
        const directive = review.bySource.get(id);
        if (directive === undefined || directive.kind !== 'IDENTIFIED_AMBIGUITY') {
          throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
        }
        classification = directive.classification;
      } else {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }

      candidates.set(id, frozenRecord({
        id,
        sourceType: 'GOOGLE_SHEETS',
        sourceSheet: SOURCE_SHEET_NAME,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        lastRowHint: intent.currentRowHint,
        currentDigest: intent.currentDigest,
        state: null,
        classification,
        normalizationStatus: null,
        transactionId,
        currentRevision: 1,
        resolutionCode: null,
        resolvedAt: null,
        resolvedBy: null,
      }));
      continue;
    }

    const previous = previousById.get(id);
    if (previous === undefined) {
      throw new IncrementalSourceCurrentCandidateError('INTENT_PREVIOUS_EVIDENCE_MISMATCH');
    }
    assertIntentPrevious(intent, previous);

    if (intent.kind === 'MARK_MISSING') {
      if (decision.kind !== 'MARK_MISSING_PRESERVE_CANONICAL') {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }
      const directive = review.bySource.get(id);
      if (directive === undefined || directive.kind !== 'MISSING') {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }
      candidates.set(id, frozenRecord({
        ...previous,
        state: directive.state,
        classification: directive.classification,
        transactionId: directive.transactionId,
        resolutionCode: directive.resolutionCode,
        resolvedAt: directive.resolvedAt,
        resolvedBy: directive.resolvedBy,
      }));
      continue;
    }

    assertObservedAt(intent, observedAt);
    if (intent.kind === 'TOUCH') {
      if (decision.kind === 'TOUCH_PRESERVE') {
        if (decision.classification !== previous.classification) {
          throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
        }
        candidates.set(id, frozenRecord({
          ...previous,
          lastSeenAt: observedAt,
          lastRowHint: intent.currentRowHint,
        }));
      } else if (decision.kind === 'REVIEW_REQUIRED_PRESERVE') {
        const directive = review.bySource.get(id);
        if (directive === undefined || directive.kind !== 'IDENTIFIED_AMBIGUITY') {
          throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
        }
        candidates.set(id, frozenRecord({
          ...previous,
          lastSeenAt: observedAt,
          lastRowHint: intent.currentRowHint,
          state: directive.state,
          classification: directive.classification,
          transactionId: directive.transactionId,
          resolutionCode: directive.resolutionCode,
          resolvedAt: directive.resolvedAt,
          resolvedBy: directive.resolvedBy,
        }));
      } else {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }
      continue;
    }

    const revisedBase = {
      ...previous,
      lastSeenAt: observedAt,
      lastRowHint: intent.currentRowHint,
      currentDigest: intent.currentDigest,
      currentRevision: intent.currentRevision,
      state: null as null,
    };

    if (decision.kind === 'OWNER_CORRECTION_REPLACE_CANDIDATE') {
      if (previous.transactionId !== decision.transactionId) {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }
      candidates.set(id, frozenRecord({
        ...revisedBase,
        classification: 'FINANCIAL_RECORD',
      }));
    } else if (decision.kind === 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL') {
      if (previous.transactionId !== decision.transactionId) {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }
      candidates.set(id, frozenRecord({
        ...revisedBase,
        classification: 'FINANCIAL_RECORD',
      }));
    } else if (decision.kind === 'REVIEW_REQUIRED_PRESERVE') {
      const directive = review.bySource.get(id);
      if (directive === undefined || directive.kind !== 'IDENTIFIED_AMBIGUITY') {
        throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
      }
      candidates.set(id, frozenRecord({
        ...revisedBase,
        classification: directive.classification,
        transactionId: directive.transactionId,
        resolutionCode: directive.resolutionCode,
        resolvedAt: directive.resolvedAt,
        resolvedBy: directive.resolvedBy,
      }));
    } else {
      throw new IncrementalSourceCurrentCandidateError('TRANSITION_INTENT_MISMATCH');
    }
  }

  const sourceRecords = [...candidates.values()].sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    sourceRecords: Object.freeze(sourceRecords),
    promotionBlocker: review.promotionBlocker,
    unresolvedRowHints: review.unresolvedRowHints,
  });
}
