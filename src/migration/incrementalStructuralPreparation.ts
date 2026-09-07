import type { MigrationRun } from './migrationRunState.js';
import type { IncrementalCommittedBaseline } from './incrementalCommittedBaseline.js';
import {
  buildIncrementalLineagePlanFromCommittedBaseline,
} from './incrementalCommittedBaseline.js';
import type { IncrementalNewSourceRecordAssignment, IncrementalLineagePlan } from './incrementalLineagePlan.js';
import type { IncrementalSourceObservationRow } from './googleSnapshotProjection.js';
import type { IncrementalPreviousSourceCurrentEvidence } from './incrementalSourceCurrentCandidate.js';
import type { IncrementalCurrentRevisionPayloadEvidence } from './incrementalCurrentRevisionEvidenceReader.js';
import {
  buildIncrementalRevisionChangeEvidence,
  type IncrementalLegacyCloseContextEvidence,
  type IncrementalRevisionChangeEvidencePlan,
} from './incrementalRevisionChangeEvidence.js';
import {
  buildIncrementalRevisionEvidencePlan,
  type IncrementalRevisionEvidencePlan,
  type IncrementalRevisionPayloadObservation,
  type IncrementalPreviousRevisionEvidence,
} from './incrementalRevisionEvidence.js';
import {
  buildIncrementalSourceDeltaIntentPlan,
  type IncrementalPreviousActiveSourceEvidence,
  type IncrementalSourceDeltaIntentPlan,
} from './incrementalSourceDeltaIntent.js';

export interface IncrementalStructuralPreparationInput {
  readonly run: Readonly<MigrationRun>;
  readonly baseline: Readonly<IncrementalCommittedBaseline>;
  readonly currentRows: readonly Readonly<IncrementalSourceObservationRow>[];
  readonly sourceAssignments: readonly Readonly<IncrementalNewSourceRecordAssignment>[];
  readonly previousSourceCurrent: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[];
  readonly previousRevisionPayloads: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[];
  readonly legacyCloseContextEvidence?: readonly Readonly<IncrementalLegacyCloseContextEvidence>[];
  readonly observedAt: string;
}

export interface IncrementalStructuralPreparationPlan {
  readonly lineage: Readonly<IncrementalLineagePlan>;
  readonly changeEvidence: Readonly<IncrementalRevisionChangeEvidencePlan>;
  readonly revisions: Readonly<IncrementalRevisionEvidencePlan>;
  readonly sourceDelta: Readonly<IncrementalSourceDeltaIntentPlan>;
}

function revisedSourceIds(lineage: Readonly<IncrementalLineagePlan>): ReadonlySet<string> {
  return new Set(lineage.outcomes
    .filter((outcome) => outcome.kind === 'REVISED')
    .map((outcome) => outcome.sourceRecordId.toLowerCase()));
}

function revisedCurrentRowHints(lineage: Readonly<IncrementalLineagePlan>): ReadonlySet<number> {
  return new Set(lineage.outcomes
    .filter((outcome) => outcome.kind === 'REVISED')
    .map((outcome) => outcome.currentRowHint));
}

function revisionRowHints(lineage: Readonly<IncrementalLineagePlan>): ReadonlySet<number> {
  return new Set(lineage.outcomes
    .filter((outcome) => outcome.kind === 'REVISED' || outcome.kind === 'INSERTED')
    .map((outcome) => outcome.currentRowHint));
}

function activePreviousSourceEvidence(
  sources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
): readonly Readonly<IncrementalPreviousActiveSourceEvidence>[] {
  return Object.freeze(sources
    .filter((source) => source.state === null)
    .map((source) => Object.freeze({
      sourceRecordId: source.id,
      lastRowHint: source.lastRowHint,
      currentDigest: source.currentDigest,
      currentRevision: source.currentRevision,
    })));
}

function previousRevisionEvidenceFor(
  revisedIds: ReadonlySet<string>,
  evidence: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[],
): readonly Readonly<IncrementalPreviousRevisionEvidence>[] {
  return Object.freeze(evidence
    .filter((item) => revisedIds.has(item.sourceRecordId.toLowerCase()))
    .map((item) => Object.freeze({
      sourceRecordId: item.sourceRecordId,
      currentRevision: item.revision,
    })));
}

function previousRevisionPayloadsFor(
  revisedIds: ReadonlySet<string>,
  evidence: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[],
): readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[] {
  return Object.freeze(evidence.filter((item) => revisedIds.has(item.sourceRecordId.toLowerCase())));
}

function currentRevisionRowsFor(
  rowHints: ReadonlySet<number>,
  currentRows: readonly Readonly<IncrementalSourceObservationRow>[],
): readonly Readonly<IncrementalSourceObservationRow>[] {
  return Object.freeze(currentRows.filter((row) => rowHints.has(row.rowHint)));
}

function payloadObservationsFor(
  rowHints: ReadonlySet<number>,
  currentRows: readonly Readonly<IncrementalSourceObservationRow>[],
): readonly Readonly<IncrementalRevisionPayloadObservation>[] {
  return Object.freeze(currentRows
    .filter((row) => rowHints.has(row.rowHint))
    .map((row) => Object.freeze({
      currentRowHint: row.rowHint,
      payload: row.rawPayload,
    })));
}

export function buildIncrementalStructuralPreparation(
  input: Readonly<IncrementalStructuralPreparationInput>,
): Readonly<IncrementalStructuralPreparationPlan> {
  const lineage = buildIncrementalLineagePlanFromCommittedBaseline(
    input.baseline,
    input.currentRows,
    input.sourceAssignments,
  );

  const revisedIds = revisedSourceIds(lineage);
  const revisedHints = revisedCurrentRowHints(lineage);
  const revisionHints = revisionRowHints(lineage);

  const changeEvidence = buildIncrementalRevisionChangeEvidence(
    lineage,
    previousRevisionPayloadsFor(revisedIds, input.previousRevisionPayloads),
    currentRevisionRowsFor(revisedHints, input.currentRows),
    input.legacyCloseContextEvidence ?? [],
  );

  const revisions = buildIncrementalRevisionEvidencePlan(
    input.run,
    lineage,
    input.observedAt,
    payloadObservationsFor(revisionHints, input.currentRows),
    previousRevisionEvidenceFor(revisedIds, input.previousRevisionPayloads),
    changeEvidence.changeEvidence,
  );

  const sourceDelta = buildIncrementalSourceDeltaIntentPlan(
    input.baseline,
    lineage,
    revisions,
    activePreviousSourceEvidence(input.previousSourceCurrent),
    input.observedAt,
  );

  return Object.freeze({ lineage, changeEvidence, revisions, sourceDelta });
}
