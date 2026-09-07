import {
  classifySourceRevisionChange,
  type LegacyCloseContextEvidence,
  type SourceChangeClassificationResult,
} from './changeClassification.js';
import type { IncrementalCurrentRevisionPayloadEvidence } from './incrementalCurrentRevisionEvidenceReader.js';
import type { IncrementalSourceObservationRow } from './googleSnapshotProjection.js';
import type { IncrementalRevisionChangeEvidence } from './incrementalRevisionEvidence.js';
import type {
  IncrementalSourceDeltaIntent,
  IncrementalSourceDeltaIntentPlan,
} from './incrementalSourceDeltaIntent.js';
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
  | 'PREVIOUS_REVISION_INTENT_MISMATCH'
  | 'CURRENT_ROW_INTENT_MISMATCH'
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

function revisedIntents(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
): readonly Readonly<Extract<IncrementalSourceDeltaIntent, { kind: 'REVISE' }>>[] {
  return deltaPlan.intents.filter(
    (intent): intent is Extract<IncrementalSourceDeltaIntent, { kind: 'REVISE' }> => intent.kind === 'REVISE',
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
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  previousRevisionPayloads: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[],
  currentRows: readonly Readonly<IncrementalSourceObservationRow>[],
  contextEvidence: readonly Readonly<IncrementalLegacyCloseContextEvidence>[] = [],
): Readonly<IncrementalRevisionChangeEvidencePlan> {
  const intents = revisedIntents(deltaPlan);
  const previousById = previousMap(previousRevisionPayloads);
  const currentByHint = currentMap(currentRows);
  const contextById = contextMap(contextEvidence);
  const requiredPreviousIds = new Set(intents.map((intent) => normalizedId(intent.sourceRecordId)));
  const requiredCurrentHints = new Set(intents.map((intent) => intent.currentRowHint));
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

  for (const intent of intents) {
    const sourceRecordId = normalizedId(intent.sourceRecordId);
    const previous = previousById.get(sourceRecordId);
    if (previous === undefined) {
      throw new IncrementalRevisionChangeEvidenceError('MISSING_PREVIOUS_REVISION_EVIDENCE');
    }
    if (
      previous.revision !== intent.expectedPreviousRevision
      || previous.rowHint !== intent.previousRowHint
      || previous.rowDigest !== intent.expectedPreviousDigest
    ) {
      throw new IncrementalRevisionChangeEvidenceError('PREVIOUS_REVISION_INTENT_MISMATCH');
    }

    const current = currentByHint.get(intent.currentRowHint);
    if (current === undefined) {
      throw new IncrementalRevisionChangeEvidenceError('MISSING_CURRENT_ROW_EVIDENCE');
    }
    if (current.rowHint !== intent.currentRowHint || current.digest !== intent.currentDigest) {
      throw new IncrementalRevisionChangeEvidenceError('CURRENT_ROW_INTENT_MISMATCH');
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
    changeEvidence.push(Object.freeze({
      sourceRecordId,
      changeClass: classification.changeClass,
    }));
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
