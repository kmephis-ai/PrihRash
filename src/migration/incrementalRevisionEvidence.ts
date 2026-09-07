import type { SourceChangeClass } from './changeClassification.js';
import type {
  IncrementalLineageOutcome,
  IncrementalLineagePlan,
} from './incrementalLineagePlan.js';
import type { MigrationRun } from './migrationRunState.js';
import { serializeRawPayloadV2 } from './rawPayloadProvenance.js';

export interface IncrementalRevisionPayloadObservation {
  readonly currentRowHint: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface IncrementalPreviousRevisionEvidence {
  readonly sourceRecordId: string;
  readonly currentRevision: number;
}

export interface IncrementalRevisionChangeEvidence {
  readonly sourceRecordId: string;
  readonly changeClass: Exclude<SourceChangeClass, 'NO_CHANGE'>;
}

export interface IncrementalSourceRecordRevisionProjection {
  readonly sourceRecordId: string;
  readonly revision: number;
  readonly migrationRunId: string;
  readonly observedAt: string;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly changeClass: Exclude<SourceChangeClass, 'NO_CHANGE'> | null;
  readonly rawPayload: string;
}

export interface IncrementalRevisionEvidencePlan {
  readonly revisions: readonly Readonly<IncrementalSourceRecordRevisionProjection>[];
}

export type IncrementalRevisionEvidenceErrorCode =
  | 'RUN_NOT_STAGING'
  | 'DUPLICATE_PAYLOAD_ROW_HINT'
  | 'MISSING_PAYLOAD_ROW_HINT'
  | 'EXTRA_PAYLOAD_ROW_HINT'
  | 'DUPLICATE_PREVIOUS_REVISION_SOURCE_ID'
  | 'MISSING_PREVIOUS_REVISION_EVIDENCE'
  | 'EXTRA_PREVIOUS_REVISION_EVIDENCE'
  | 'INVALID_PREVIOUS_REVISION'
  | 'REVISION_OVERFLOW'
  | 'DUPLICATE_CHANGE_CLASS_SOURCE_ID'
  | 'MISSING_CHANGE_CLASS_EVIDENCE'
  | 'EXTRA_CHANGE_CLASS_EVIDENCE'
  | 'INVALID_CHANGE_CLASS';

export class IncrementalRevisionEvidenceError extends Error {
  readonly code: IncrementalRevisionEvidenceErrorCode;

  constructor(code: IncrementalRevisionEvidenceErrorCode) {
    super(code);
    this.name = 'IncrementalRevisionEvidenceError';
    this.code = code;
  }
}

function revisionOutcomes(
  lineage: Readonly<IncrementalLineagePlan>,
): readonly Readonly<Extract<IncrementalLineageOutcome, { kind: 'INSERTED' | 'REVISED' }>>[] {
  return lineage.outcomes.filter(
    (outcome): outcome is Extract<IncrementalLineageOutcome, { kind: 'INSERTED' | 'REVISED' }> => (
      outcome.kind === 'INSERTED' || outcome.kind === 'REVISED'
    ),
  );
}

function payloadsByRowHint(
  observations: readonly Readonly<IncrementalRevisionPayloadObservation>[],
): ReadonlyMap<number, string> {
  const byRowHint = new Map<number, string>();
  for (const observation of observations) {
    if (byRowHint.has(observation.currentRowHint)) {
      throw new IncrementalRevisionEvidenceError('DUPLICATE_PAYLOAD_ROW_HINT');
    }
    byRowHint.set(observation.currentRowHint, serializeRawPayloadV2(observation.payload));
  }
  return byRowHint;
}

function previousRevisionsBySourceId(
  evidence: readonly Readonly<IncrementalPreviousRevisionEvidence>[],
): ReadonlyMap<string, number> {
  const bySourceId = new Map<string, number>();
  for (const item of evidence) {
    const sourceRecordId = item.sourceRecordId.toLowerCase();
    if (bySourceId.has(sourceRecordId)) {
      throw new IncrementalRevisionEvidenceError('DUPLICATE_PREVIOUS_REVISION_SOURCE_ID');
    }
    if (!Number.isSafeInteger(item.currentRevision) || item.currentRevision < 1) {
      throw new IncrementalRevisionEvidenceError('INVALID_PREVIOUS_REVISION');
    }
    bySourceId.set(sourceRecordId, item.currentRevision);
  }
  return bySourceId;
}

function changesBySourceId(
  evidence: readonly Readonly<IncrementalRevisionChangeEvidence>[],
): ReadonlyMap<string, Exclude<SourceChangeClass, 'NO_CHANGE'>> {
  const bySourceId = new Map<string, Exclude<SourceChangeClass, 'NO_CHANGE'>>();
  for (const item of evidence) {
    const sourceRecordId = item.sourceRecordId.toLowerCase();
    if (bySourceId.has(sourceRecordId)) {
      throw new IncrementalRevisionEvidenceError('DUPLICATE_CHANGE_CLASS_SOURCE_ID');
    }
    if (
      item.changeClass !== 'WORKFLOW_TRANSFORM'
      && item.changeClass !== 'OWNER_CORRECTION'
      && item.changeClass !== 'AMBIGUOUS_CHANGE'
    ) {
      throw new IncrementalRevisionEvidenceError('INVALID_CHANGE_CLASS');
    }
    bySourceId.set(sourceRecordId, item.changeClass);
  }
  return bySourceId;
}

export function buildIncrementalRevisionEvidencePlan(
  run: Readonly<MigrationRun>,
  lineage: Readonly<IncrementalLineagePlan>,
  observedAt: string,
  payloadObservations: readonly Readonly<IncrementalRevisionPayloadObservation>[],
  previousRevisionEvidence: readonly Readonly<IncrementalPreviousRevisionEvidence>[],
  changeEvidence: readonly Readonly<IncrementalRevisionChangeEvidence>[],
): Readonly<IncrementalRevisionEvidencePlan> {
  if (run.state !== 'STAGING' || run.finishedAt !== null || run.errorCode !== null) {
    throw new IncrementalRevisionEvidenceError('RUN_NOT_STAGING');
  }

  const outcomes = revisionOutcomes(lineage);
  const requiredRowHints = new Set(outcomes.map((outcome) => outcome.currentRowHint));
  const requiredRevisedSourceIds = new Set(
    outcomes
      .filter((outcome) => outcome.kind === 'REVISED')
      .map((outcome) => outcome.sourceRecordId.toLowerCase()),
  );

  const payloadByRowHint = payloadsByRowHint(payloadObservations);
  for (const rowHint of requiredRowHints) {
    if (!payloadByRowHint.has(rowHint)) {
      throw new IncrementalRevisionEvidenceError('MISSING_PAYLOAD_ROW_HINT');
    }
  }
  for (const rowHint of payloadByRowHint.keys()) {
    if (!requiredRowHints.has(rowHint)) {
      throw new IncrementalRevisionEvidenceError('EXTRA_PAYLOAD_ROW_HINT');
    }
  }

  const previousRevisionBySourceId = previousRevisionsBySourceId(previousRevisionEvidence);
  for (const sourceRecordId of requiredRevisedSourceIds) {
    if (!previousRevisionBySourceId.has(sourceRecordId)) {
      throw new IncrementalRevisionEvidenceError('MISSING_PREVIOUS_REVISION_EVIDENCE');
    }
  }
  for (const sourceRecordId of previousRevisionBySourceId.keys()) {
    if (!requiredRevisedSourceIds.has(sourceRecordId)) {
      throw new IncrementalRevisionEvidenceError('EXTRA_PREVIOUS_REVISION_EVIDENCE');
    }
  }

  const changeBySourceId = changesBySourceId(changeEvidence);
  for (const sourceRecordId of requiredRevisedSourceIds) {
    if (!changeBySourceId.has(sourceRecordId)) {
      throw new IncrementalRevisionEvidenceError('MISSING_CHANGE_CLASS_EVIDENCE');
    }
  }
  for (const sourceRecordId of changeBySourceId.keys()) {
    if (!requiredRevisedSourceIds.has(sourceRecordId)) {
      throw new IncrementalRevisionEvidenceError('EXTRA_CHANGE_CLASS_EVIDENCE');
    }
  }

  const revisions: Readonly<IncrementalSourceRecordRevisionProjection>[] = [];
  for (const outcome of outcomes) {
    const rawPayload = payloadByRowHint.get(outcome.currentRowHint);
    if (rawPayload === undefined) {
      throw new IncrementalRevisionEvidenceError('MISSING_PAYLOAD_ROW_HINT');
    }

    if (outcome.kind === 'INSERTED') {
      revisions.push(Object.freeze({
        sourceRecordId: outcome.sourceRecordId,
        revision: 1,
        migrationRunId: run.id,
        observedAt,
        rowHint: outcome.currentRowHint,
        rowDigest: outcome.digest,
        changeClass: null,
        rawPayload,
      }));
      continue;
    }

    const sourceRecordId = outcome.sourceRecordId.toLowerCase();
    const previousRevision = previousRevisionBySourceId.get(sourceRecordId);
    const changeClass = changeBySourceId.get(sourceRecordId);
    if (previousRevision === undefined) {
      throw new IncrementalRevisionEvidenceError('MISSING_PREVIOUS_REVISION_EVIDENCE');
    }
    if (previousRevision >= Number.MAX_SAFE_INTEGER) {
      throw new IncrementalRevisionEvidenceError('REVISION_OVERFLOW');
    }
    if (changeClass === undefined) {
      throw new IncrementalRevisionEvidenceError('MISSING_CHANGE_CLASS_EVIDENCE');
    }

    revisions.push(Object.freeze({
      sourceRecordId,
      revision: previousRevision + 1,
      migrationRunId: run.id,
      observedAt,
      rowHint: outcome.currentRowHint,
      rowDigest: outcome.currentDigest,
      changeClass,
      rawPayload,
    }));
  }

  return Object.freeze({ revisions: Object.freeze(revisions) });
}
