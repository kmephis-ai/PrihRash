import {
  classifySourceRevisionChange,
  type LegacyCloseContextEvidence,
  type SourceChangeClassificationResult,
} from './changeClassification.js';
import type { IncrementalCurrentRevisionPayloadEvidence } from './incrementalCurrentRevisionEvidenceReader.js';
import type { IncrementalSourceObservationRow } from './googleSnapshotProjection.js';
import type { IncrementalLineageOutcome, IncrementalLineagePlan } from './incrementalLineagePlan.js';
import type { IncrementalRevisionChangeEvidence } from './incrementalRevisionEvidence.js';
import { projectSourceFinancialRevision } from './sourceFinancialRevisionProjection.js';

export interface IncrementalLegacyCloseContextEvidence {
  readonly sourceRecordId: string;
  readonly context: Readonly<LegacyCloseContextEvidence>;
}

export interface IncrementalRevisionChangeEvidencePlan {
  readonly changeEvidence: readonly Readonly<IncrementalRevisionChangeEvidence>[];
  readonly contextDependentSourceRecordIds: readonly string[];
}

export type IncrementalRevisionChangeEvidenceErrorCode =
  | 'INVALID_SOURCE_RECORD_ID'
  | 'DUPLICATE_PREVIOUS_REVISION_SOURCE_ID'
  | 'DUPLICATE_CURRENT_ROW_HINT'
  | 'DUPLICATE_CONTEXT_SOURCE_ID'
  | 'INVALID_CONTEXT_EVIDENCE'
  | 'MISSING_PREVIOUS_REVISION_EVIDENCE'
  | 'EXTRA_PREVIOUS_REVISION_EVIDENCE'
  | 'MISSING_CURRENT_ROW_EVIDENCE'
  | 'EXTRA_CURRENT_ROW_EVIDENCE'
  | 'PREVIOUS_REVISION_LINEAGE_MISMATCH'
  | 'CURRENT_ROW_LINEAGE_MISMATCH'
  | 'MISSING_CONTEXTUAL_CHANGE_EVIDENCE'
  | 'EXTRA_CONTEXTUAL_CHANGE_EVIDENCE'
  | 'REVISED_FINANCIAL_FIELDS_NO_CHANGE';

export class IncrementalRevisionChangeEvidenceError extends Error {
  readonly code: IncrementalRevisionChangeEvidenceErrorCode;

  constructor(code: IncrementalRevisionChangeEvidenceErrorCode) {
    super(code);
    this.name = 'IncrementalRevisionChangeEvidenceError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NO_CONTEXT: Readonly<LegacyCloseContextEvidence> = Object.freeze({
  preCloseObservationProven: false,
  inJustClosedWorkingSetProven: false,
  closeClusterDetected: false,
  observedAfterClose: false,
  batchCleanupPatternConfirmed: false,
});
const FULL_CONTEXT: Readonly<LegacyCloseContextEvidence> = Object.freeze({
  preCloseObservationProven: true,
  inJustClosedWorkingSetProven: true,
  closeClusterDetected: true,
  observedAfterClose: true,
  batchCleanupPatternConfirmed: true,
});

function normalizedId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new IncrementalRevisionChangeEvidenceError('INVALID_SOURCE_RECORD_ID');
  return value.toLowerCase();
}

function revisedOutcomes(
  lineage: Readonly<IncrementalLineagePlan>,
): readonly Readonly<Extract<IncrementalLineageOutcome, { kind: 'REVISED' }>>[] {
  return lineage.outcomes.filter(
    (outcome): outcome is Extract<IncrementalLineageOutcome, { kind: 'REVISED' }> => outcome.kind === 'REVISED',
  );
}

function sameClassification(
  left: Readonly<SourceChangeClassificationResult>,
  right: Readonly<SourceChangeClassificationResult>,
): boolean {
  return left.changeClass === right.changeClass
    && left.changedFields.length === right.changedFields.length
    && left.changedFields.every((field, index) => field === right.changedFields[index])
    && left.preservePreviousFields.length === right.preservePreviousFields.length
    && left.preservePreviousFields.every((field, index) => field === right.preservePreviousFields[index]);
}

function previousMap(
  evidence: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalCurrentRevisionPayloadEvidence>> {
  const byId = new Map<string, Readonly<IncrementalCurrentRevisionPayloadEvidence>>();
  for (const item of evidence) {
    const id = normalizedId(item.sourceRecordId);
    if (byId.has(id)) throw new IncrementalRevisionChangeEvidenceError('DUPLICATE_PREVIOUS_REVISION_SOURCE_ID');
    byId.set(id, item);
  }
  return byId;
}

function currentMap(
  rows: readonly Readonly<IncrementalSourceObservationRow>[],
): ReadonlyMap<number, Readonly<IncrementalSourceObservationRow>> {
  const byHint = new Map<number, Readonly<IncrementalSourceObservationRow>>();
  for (const row of rows) {
    if (byHint.has(row.rowHint)) throw new IncrementalRevisionChangeEvidenceError('DUPLICATE_CURRENT_ROW_HINT');
    byHint.set(row.rowHint, row);
  }
  return byHint;
}

function validContext(context: Readonly<LegacyCloseContextEvidence>): boolean {
  return typeof context.preCloseObservationProven === 'boolean'
    && typeof context.inJustClosedWorkingSetProven === 'boolean'
    && typeof context.closeClusterDetected === 'boolean'
    && typeof context.observedAfterClose === 'boolean'
    && typeof context.batchCleanupPatternConfirmed === 'boolean';
}

function contextMap(
  evidence: readonly Readonly<IncrementalLegacyCloseContextEvidence>[],
): ReadonlyMap<string, Readonly<LegacyCloseContextEvidence>> {
  const byId = new Map<string, Readonly<LegacyCloseContextEvidence>>();
  for (const item of evidence) {
    const id = normalizedId(item.sourceRecordId);
    if (byId.has(id)) throw new IncrementalRevisionChangeEvidenceError('DUPLICATE_CONTEXT_SOURCE_ID');
    if (!validContext(item.context)) throw new IncrementalRevisionChangeEvidenceError('INVALID_CONTEXT_EVIDENCE');
    byId.set(id, Object.freeze({ ...item.context }));
  }
  return byId;
}

export function buildIncrementalRevisionChangeEvidence(
  lineage: Readonly<IncrementalLineagePlan>,
  previousRevisionPayloads: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[],
  currentRows: readonly Readonly<IncrementalSourceObservationRow>[],
  contextEvidence: readonly Readonly<IncrementalLegacyCloseContextEvidence>[] = [],
): Readonly<IncrementalRevisionChangeEvidencePlan> {
  const outcomes = revisedOutcomes(lineage);
  const previousById = previousMap(previousRevisionPayloads);
  const currentByHint = currentMap(currentRows);
  const contextById = contextMap(contextEvidence);
  const requiredPreviousIds = new Set(outcomes.map((outcome) => normalizedId(outcome.sourceRecordId)));
  const requiredCurrentHints = new Set(outcomes.map((outcome) => outcome.currentRowHint));
  const usedContexts = new Set<string>();
  const contextDependentSourceRecordIds: string[] = [];
  const changeEvidence: Readonly<IncrementalRevisionChangeEvidence>[] = [];

  for (const sourceRecordId of previousById.keys()) {
    if (!requiredPreviousIds.has(sourceRecordId)) {
      throw new IncrementalRevisionChangeEvidenceError('EXTRA_PREVIOUS_REVISION_EVIDENCE');
    }
  }
  for (const rowHint of currentByHint.keys()) {
    if (!requiredCurrentHints.has(rowHint)) {
      throw new IncrementalRevisionChangeEvidenceError('EXTRA_CURRENT_ROW_EVIDENCE');
    }
  }

  for (const outcome of outcomes) {
    const sourceRecordId = normalizedId(outcome.sourceRecordId);
    const previous = previousById.get(sourceRecordId);
    if (previous === undefined) {
      throw new IncrementalRevisionChangeEvidenceError('MISSING_PREVIOUS_REVISION_EVIDENCE');
    }
    if (previous.rowHint !== outcome.previousRowHint || previous.rowDigest !== outcome.previousDigest) {
      throw new IncrementalRevisionChangeEvidenceError('PREVIOUS_REVISION_LINEAGE_MISMATCH');
    }

    const current = currentByHint.get(outcome.currentRowHint);
    if (current === undefined) {
      throw new IncrementalRevisionChangeEvidenceError('MISSING_CURRENT_ROW_EVIDENCE');
    }
    if (current.rowHint !== outcome.currentRowHint || current.digest !== outcome.currentDigest) {
      throw new IncrementalRevisionChangeEvidenceError('CURRENT_ROW_LINEAGE_MISMATCH');
    }

    const previousFinancial = projectSourceFinancialRevision(previous.rawPayload);
    const currentFinancial = projectSourceFinancialRevision(current.rawPayload);
    const withoutContext = classifySourceRevisionChange(previousFinancial, currentFinancial, NO_CONTEXT);
    const withFullContext = classifySourceRevisionChange(previousFinancial, currentFinancial, FULL_CONTEXT);
    const contextDependent = !sameClassification(withoutContext, withFullContext);
    let classification = withoutContext;

    if (contextDependent) {
      contextDependentSourceRecordIds.push(sourceRecordId);
      const context = contextById.get(sourceRecordId);
      if (context === undefined) {
        throw new IncrementalRevisionChangeEvidenceError('MISSING_CONTEXTUAL_CHANGE_EVIDENCE');
      }
      usedContexts.add(sourceRecordId);
      classification = classifySourceRevisionChange(previousFinancial, currentFinancial, context);
    }

    if (classification.changeClass === 'NO_CHANGE') {
      throw new IncrementalRevisionChangeEvidenceError('REVISED_FINANCIAL_FIELDS_NO_CHANGE');
    }
    changeEvidence.push(Object.freeze({ sourceRecordId, changeClass: classification.changeClass }));
  }

  for (const sourceRecordId of contextById.keys()) {
    if (!usedContexts.has(sourceRecordId)) {
      throw new IncrementalRevisionChangeEvidenceError('EXTRA_CONTEXTUAL_CHANGE_EVIDENCE');
    }
  }

  changeEvidence.sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
  contextDependentSourceRecordIds.sort();
  return Object.freeze({
    changeEvidence: Object.freeze(changeEvidence),
    contextDependentSourceRecordIds: Object.freeze(contextDependentSourceRecordIds),
  });
}
