import type { IncrementalCommittedBaseline } from './incrementalCommittedBaseline.js';
import type {
  IncrementalLineageOutcome,
  IncrementalLineagePlan,
} from './incrementalLineagePlan.js';
import type {
  IncrementalRevisionEvidencePlan,
  IncrementalSourceRecordRevisionProjection,
} from './incrementalRevisionEvidence.js';

export interface IncrementalPreviousActiveSourceEvidence {
  readonly sourceRecordId: string;
  readonly lastRowHint: number;
  readonly currentDigest: string;
  readonly currentRevision: number;
}

export type IncrementalSourceDeltaIntent =
  | Readonly<{
      kind: 'TOUCH';
      sourceRecordId: string;
      expectedRevision: number;
      expectedDigest: string;
      previousRowHint: number;
      currentRowHint: number;
      observedAt: string;
    }>
  | Readonly<{
      kind: 'CREATE';
      sourceRecordId: string;
      currentRevision: 1;
      currentDigest: string;
      currentRowHint: number;
      observedAt: string;
    }>
  | Readonly<{
      kind: 'REVISE';
      sourceRecordId: string;
      expectedPreviousRevision: number;
      expectedPreviousDigest: string;
      previousRowHint: number;
      currentRevision: number;
      currentDigest: string;
      currentRowHint: number;
      observedAt: string;
    }>
  | Readonly<{
      kind: 'MARK_MISSING';
      sourceRecordId: string;
      expectedRevision: number;
      expectedDigest: string;
      previousRowHint: number;
    }>;

export interface IncrementalUnresolvedLineageBlock {
  readonly previousSourceRecordIds: readonly string[];
  readonly previousRowHints: readonly number[];
  readonly currentRowHints: readonly number[];
}

export interface IncrementalSourceDeltaIntentPlan {
  readonly intents: readonly IncrementalSourceDeltaIntent[];
  readonly unresolvedBlocks: readonly Readonly<IncrementalUnresolvedLineageBlock>[];
}

export type IncrementalSourceDeltaIntentErrorCode =
  | 'INVALID_PREVIOUS_REVISION'
  | 'DUPLICATE_PREVIOUS_SOURCE_ID'
  | 'PREVIOUS_BASELINE_EVIDENCE_MISMATCH'
  | 'MISSING_PREVIOUS_SOURCE_EVIDENCE'
  | 'EXTRA_PREVIOUS_SOURCE_EVIDENCE'
  | 'DUPLICATE_LINEAGE_PREVIOUS_SOURCE_ID'
  | 'LINEAGE_PREVIOUS_COVERAGE_MISMATCH'
  | 'AMBIGUOUS_BLOCK_PREVIOUS_EVIDENCE_MISMATCH'
  | 'RESERVED_INSERTED_SOURCE_ID'
  | 'DUPLICATE_REVISION_SOURCE_ID'
  | 'MISSING_REVISION_EVIDENCE'
  | 'EXTRA_REVISION_EVIDENCE'
  | 'REVISION_LINEAGE_MISMATCH';

export class IncrementalSourceDeltaIntentError extends Error {
  readonly code: IncrementalSourceDeltaIntentErrorCode;

  constructor(code: IncrementalSourceDeltaIntentErrorCode) {
    super(code);
    this.name = 'IncrementalSourceDeltaIntentError';
    this.code = code;
  }
}

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function previousEvidenceMap(
  baseline: Readonly<IncrementalCommittedBaseline>,
  evidence: readonly Readonly<IncrementalPreviousActiveSourceEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousActiveSourceEvidence>> {
  const baselineById = new Map(
    baseline.previousSequence.map((row) => [normalizedId(row.sourceRecordId), row] as const),
  );
  const byId = new Map<string, Readonly<IncrementalPreviousActiveSourceEvidence>>();

  for (const item of evidence) {
    const sourceRecordId = normalizedId(item.sourceRecordId);
    if (byId.has(sourceRecordId)) {
      throw new IncrementalSourceDeltaIntentError('DUPLICATE_PREVIOUS_SOURCE_ID');
    }
    if (!Number.isSafeInteger(item.currentRevision) || item.currentRevision < 1) {
      throw new IncrementalSourceDeltaIntentError('INVALID_PREVIOUS_REVISION');
    }
    const baselineRow = baselineById.get(sourceRecordId);
    if (baselineRow === undefined) {
      throw new IncrementalSourceDeltaIntentError('EXTRA_PREVIOUS_SOURCE_EVIDENCE');
    }
    if (
      baselineRow.rowHint !== item.lastRowHint
      || baselineRow.digest !== item.currentDigest
    ) {
      throw new IncrementalSourceDeltaIntentError('PREVIOUS_BASELINE_EVIDENCE_MISMATCH');
    }
    byId.set(sourceRecordId, Object.freeze({ ...item, sourceRecordId }));
  }

  for (const sourceRecordId of baselineById.keys()) {
    if (!byId.has(sourceRecordId)) {
      throw new IncrementalSourceDeltaIntentError('MISSING_PREVIOUS_SOURCE_EVIDENCE');
    }
  }
  return byId;
}

function revisionEvidenceMap(
  revisionPlan: Readonly<IncrementalRevisionEvidencePlan>,
): ReadonlyMap<string, Readonly<IncrementalSourceRecordRevisionProjection>> {
  const byId = new Map<string, Readonly<IncrementalSourceRecordRevisionProjection>>();
  for (const revision of revisionPlan.revisions) {
    const sourceRecordId = normalizedId(revision.sourceRecordId);
    if (byId.has(sourceRecordId)) {
      throw new IncrementalSourceDeltaIntentError('DUPLICATE_REVISION_SOURCE_ID');
    }
    byId.set(sourceRecordId, revision);
  }
  return byId;
}

function existingEvidence(
  operation: Extract<IncrementalLineageOutcome, { kind: 'UNCHANGED' | 'REVISED' | 'MISSING' }>,
  previousById: ReadonlyMap<string, Readonly<IncrementalPreviousActiveSourceEvidence>>,
): Readonly<IncrementalPreviousActiveSourceEvidence> {
  const sourceRecordId = normalizedId(operation.sourceRecordId);
  const previous = previousById.get(sourceRecordId);
  if (previous === undefined) {
    throw new IncrementalSourceDeltaIntentError('MISSING_PREVIOUS_SOURCE_EVIDENCE');
  }

  const previousDigest = operation.kind === 'REVISED' ? operation.previousDigest : operation.digest;
  if (
    previous.lastRowHint !== operation.previousRowHint
    || previous.currentDigest !== previousDigest
  ) {
    throw new IncrementalSourceDeltaIntentError('PREVIOUS_BASELINE_EVIDENCE_MISMATCH');
  }
  return previous;
}

function markPreviousCoverage(
  sourceRecordId: string,
  coveredPreviousIds: Set<string>,
): void {
  const normalized = normalizedId(sourceRecordId);
  if (coveredPreviousIds.has(normalized)) {
    throw new IncrementalSourceDeltaIntentError('DUPLICATE_LINEAGE_PREVIOUS_SOURCE_ID');
  }
  coveredPreviousIds.add(normalized);
}

function assertInsertedRevision(
  operation: Extract<IncrementalLineageOutcome, { kind: 'INSERTED' }>,
  revision: Readonly<IncrementalSourceRecordRevisionProjection>,
  observedAt: string,
): void {
  if (
    revision.revision !== 1
    || revision.changeClass !== null
    || revision.observedAt !== observedAt
    || revision.rowHint !== operation.currentRowHint
    || revision.rowDigest !== operation.digest
    || normalizedId(revision.sourceRecordId) !== normalizedId(operation.sourceRecordId)
  ) {
    throw new IncrementalSourceDeltaIntentError('REVISION_LINEAGE_MISMATCH');
  }
}

function assertRevisedRevision(
  operation: Extract<IncrementalLineageOutcome, { kind: 'REVISED' }>,
  previous: Readonly<IncrementalPreviousActiveSourceEvidence>,
  revision: Readonly<IncrementalSourceRecordRevisionProjection>,
  observedAt: string,
): void {
  if (
    revision.revision !== previous.currentRevision + 1
    || revision.changeClass === null
    || revision.observedAt !== observedAt
    || revision.rowHint !== operation.currentRowHint
    || revision.rowDigest !== operation.currentDigest
    || normalizedId(revision.sourceRecordId) !== normalizedId(operation.sourceRecordId)
  ) {
    throw new IncrementalSourceDeltaIntentError('REVISION_LINEAGE_MISMATCH');
  }
}

function preserveAmbiguousBlock(
  outcome: Extract<IncrementalLineageOutcome, { kind: 'AMBIGUOUS_BLOCK' }>,
  previousById: ReadonlyMap<string, Readonly<IncrementalPreviousActiveSourceEvidence>>,
  coveredPreviousIds: Set<string>,
): Readonly<IncrementalUnresolvedLineageBlock> {
  if (outcome.previousSourceRecordIds.length !== outcome.previousRowHints.length) {
    throw new IncrementalSourceDeltaIntentError('AMBIGUOUS_BLOCK_PREVIOUS_EVIDENCE_MISMATCH');
  }

  for (let index = 0; index < outcome.previousSourceRecordIds.length; index += 1) {
    const sourceRecordId = outcome.previousSourceRecordIds[index];
    const previousRowHint = outcome.previousRowHints[index];
    if (sourceRecordId === undefined || previousRowHint === undefined) {
      throw new IncrementalSourceDeltaIntentError('AMBIGUOUS_BLOCK_PREVIOUS_EVIDENCE_MISMATCH');
    }
    const previous = previousById.get(normalizedId(sourceRecordId));
    if (previous === undefined || previous.lastRowHint !== previousRowHint) {
      throw new IncrementalSourceDeltaIntentError('AMBIGUOUS_BLOCK_PREVIOUS_EVIDENCE_MISMATCH');
    }
    markPreviousCoverage(sourceRecordId, coveredPreviousIds);
  }

  return Object.freeze({
    previousSourceRecordIds: Object.freeze(outcome.previousSourceRecordIds.map(normalizedId)),
    previousRowHints: Object.freeze([...outcome.previousRowHints]),
    currentRowHints: Object.freeze([...outcome.currentRowHints]),
  });
}

export function buildIncrementalSourceDeltaIntentPlan(
  baseline: Readonly<IncrementalCommittedBaseline>,
  lineage: Readonly<IncrementalLineagePlan>,
  revisionPlan: Readonly<IncrementalRevisionEvidencePlan>,
  previousEvidence: readonly Readonly<IncrementalPreviousActiveSourceEvidence>[],
  observedAt: string,
): Readonly<IncrementalSourceDeltaIntentPlan> {
  const previousById = previousEvidenceMap(baseline, previousEvidence);
  const revisionById = revisionEvidenceMap(revisionPlan);
  const reservedIds = new Set(baseline.reservedSourceRecordIds.map(normalizedId));
  const usedRevisionIds = new Set<string>();
  const coveredPreviousIds = new Set<string>();
  const intents: IncrementalSourceDeltaIntent[] = [];
  const unresolvedBlocks: Readonly<IncrementalUnresolvedLineageBlock>[] = [];

  for (const outcome of lineage.outcomes) {
    switch (outcome.kind) {
      case 'UNCHANGED': {
        const previous = existingEvidence(outcome, previousById);
        markPreviousCoverage(outcome.sourceRecordId, coveredPreviousIds);
        intents.push(Object.freeze({
          kind: 'TOUCH' as const,
          sourceRecordId: normalizedId(outcome.sourceRecordId),
          expectedRevision: previous.currentRevision,
          expectedDigest: previous.currentDigest,
          previousRowHint: outcome.previousRowHint,
          currentRowHint: outcome.currentRowHint,
          observedAt,
        }));
        break;
      }

      case 'INSERTED': {
        const sourceRecordId = normalizedId(outcome.sourceRecordId);
        if (reservedIds.has(sourceRecordId)) {
          throw new IncrementalSourceDeltaIntentError('RESERVED_INSERTED_SOURCE_ID');
        }
        const revision = revisionById.get(sourceRecordId);
        if (revision === undefined) {
          throw new IncrementalSourceDeltaIntentError('MISSING_REVISION_EVIDENCE');
        }
        assertInsertedRevision(outcome, revision, observedAt);
        usedRevisionIds.add(sourceRecordId);
        intents.push(Object.freeze({
          kind: 'CREATE' as const,
          sourceRecordId,
          currentRevision: 1 as const,
          currentDigest: outcome.digest,
          currentRowHint: outcome.currentRowHint,
          observedAt,
        }));
        break;
      }

      case 'REVISED': {
        const previous = existingEvidence(outcome, previousById);
        markPreviousCoverage(outcome.sourceRecordId, coveredPreviousIds);
        const sourceRecordId = normalizedId(outcome.sourceRecordId);
        const revision = revisionById.get(sourceRecordId);
        if (revision === undefined) {
          throw new IncrementalSourceDeltaIntentError('MISSING_REVISION_EVIDENCE');
        }
        assertRevisedRevision(outcome, previous, revision, observedAt);
        usedRevisionIds.add(sourceRecordId);
        intents.push(Object.freeze({
          kind: 'REVISE' as const,
          sourceRecordId,
          expectedPreviousRevision: previous.currentRevision,
          expectedPreviousDigest: previous.currentDigest,
          previousRowHint: outcome.previousRowHint,
          currentRevision: revision.revision,
          currentDigest: outcome.currentDigest,
          currentRowHint: outcome.currentRowHint,
          observedAt,
        }));
        break;
      }

      case 'MISSING': {
        const previous = existingEvidence(outcome, previousById);
        markPreviousCoverage(outcome.sourceRecordId, coveredPreviousIds);
        intents.push(Object.freeze({
          kind: 'MARK_MISSING' as const,
          sourceRecordId: normalizedId(outcome.sourceRecordId),
          expectedRevision: previous.currentRevision,
          expectedDigest: previous.currentDigest,
          previousRowHint: outcome.previousRowHint,
        }));
        break;
      }

      case 'AMBIGUOUS_BLOCK':
        unresolvedBlocks.push(preserveAmbiguousBlock(outcome, previousById, coveredPreviousIds));
        break;
    }
  }

  for (const sourceRecordId of previousById.keys()) {
    if (!coveredPreviousIds.has(sourceRecordId)) {
      throw new IncrementalSourceDeltaIntentError('LINEAGE_PREVIOUS_COVERAGE_MISMATCH');
    }
  }

  for (const sourceRecordId of revisionById.keys()) {
    if (!usedRevisionIds.has(sourceRecordId)) {
      throw new IncrementalSourceDeltaIntentError('EXTRA_REVISION_EVIDENCE');
    }
  }

  return Object.freeze({
    intents: Object.freeze(intents),
    unresolvedBlocks: Object.freeze(unresolvedBlocks),
  });
}
