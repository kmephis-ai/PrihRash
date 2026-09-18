import { YdbAdapter } from '../integration/ydb/adapter.js';
import { YdbSchemeAdapter, type YdbSchemeDirectoryEntry } from '../integration/ydb/scheme.js';
import {
  readControlledRebuildCurrentEvidence,
  readControlledRebuildStagingEvidence,
} from './initialControlledRebuildEvidenceReader.js';
import { readScheduledSyncAdmissionEvidence } from './scheduledSyncAdmissionEvidence.js';

export type InitialValidatedControlledRebuildRecoveryReason =
  | 'VALIDATED_CURRENT_EMPTY_STAGING_ABSENT'
  | 'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY'
  | 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'
  | 'VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT'
  | 'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT'
  | 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS'
  | 'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED';

export type ValidatedControlledStagingState =
  | 'ABSENT'
  | 'EMPTY'
  | 'NONEMPTY'
  | 'PRESENT'
  | 'AMBIGUOUS';

function child(
  children: readonly Readonly<YdbSchemeDirectoryEntry>[],
  name: string,
): Readonly<YdbSchemeDirectoryEntry> | undefined {
  return children.find((entry) => entry.name === name);
}

function emptySnapshot(
  snapshot: Awaited<ReturnType<typeof readControlledRebuildCurrentEvidence>>,
): boolean {
  return snapshot.sourceRecordCount === 0
    && snapshot.transactionCount === 0
    && snapshot.missingSourceRecordCount === 0
    && snapshot.typeAggregates.length === 0
    && snapshot.categoryAggregates.length === 0
    && snapshot.accountAggregates.length === 0
    && Object.values(snapshot.classificationCounts).every((value) => value === 0);
}

export function classifyValidatedControlledRebuildStructure(
  currentEmpty: boolean,
  stagingState: ValidatedControlledStagingState,
): InitialValidatedControlledRebuildRecoveryReason {
  if (stagingState === 'AMBIGUOUS') return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
  if (!currentEmpty) {
    return stagingState === 'ABSENT'
      ? 'VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT'
      : 'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT';
  }
  if (stagingState === 'ABSENT') return 'VALIDATED_CURRENT_EMPTY_STAGING_ABSENT';
  if (stagingState === 'EMPTY') return 'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY';
  if (stagingState === 'NONEMPTY') return 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY';
  return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
}

export async function diagnoseValidatedControlledRebuildState(
  adapter: YdbAdapter,
  scheme: YdbSchemeAdapter,
): Promise<InitialValidatedControlledRebuildRecoveryReason> {
  try {
    const admission = await readScheduledSyncAdmissionEvidence(adapter);
    if (
      admission.committedBaselineRun !== null
      || admission.incompleteRuns.length !== 1
      || admission.incompleteRuns[0]?.state !== 'VALIDATED'
    ) {
      return 'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED';
    }

    const run = admission.incompleteRuns[0];
    const runLeaf = `r_${run.id.replaceAll('-', '')}`;
    const stagingDirectory = `rebuild/${runLeaf}`;
    const current = await readControlledRebuildCurrentEvidence(adapter);
    const currentEmpty = emptySnapshot(current);

    const root = await scheme.listDirectory('');
    if (
      child(root.children, 'transactions')?.kind !== 'TABLE'
      || child(root.children, 'source_records')?.kind !== 'TABLE'
    ) {
      return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
    }

    const rebuildEntry = child(root.children, 'rebuild');
    if (rebuildEntry === undefined) {
      return classifyValidatedControlledRebuildStructure(currentEmpty, 'ABSENT');
    }
    if (rebuildEntry.kind !== 'DIRECTORY') {
      return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
    }

    const rebuild = await scheme.listDirectory('rebuild');
    const runEntry = child(rebuild.children, runLeaf);
    if (runEntry === undefined) {
      return classifyValidatedControlledRebuildStructure(currentEmpty, 'ABSENT');
    }
    if (runEntry.kind !== 'DIRECTORY') {
      return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
    }

    const runListing = await scheme.listDirectory(stagingDirectory);
    const allowed = new Set(['transactions', 'source_records']);
    if (runListing.children.some((entry) => !allowed.has(entry.name))) {
      return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
    }
    const transactions = child(runListing.children, 'transactions');
    const sourceRecords = child(runListing.children, 'source_records');
    if (
      (transactions !== undefined && transactions.kind !== 'TABLE')
      || (sourceRecords !== undefined && sourceRecords.kind !== 'TABLE')
      || (transactions === undefined) !== (sourceRecords === undefined)
    ) {
      return 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS';
    }
    if (transactions === undefined && sourceRecords === undefined) {
      return classifyValidatedControlledRebuildStructure(currentEmpty, 'ABSENT');
    }
    if (!currentEmpty) {
      return classifyValidatedControlledRebuildStructure(false, 'PRESENT');
    }

    const staging = await readControlledRebuildStagingEvidence(adapter, Object.freeze({
      transactions: `${stagingDirectory}/transactions`,
      sourceRecords: `${stagingDirectory}/source_records`,
    }));
    return classifyValidatedControlledRebuildStructure(
      true,
      emptySnapshot(staging) ? 'EMPTY' : 'NONEMPTY',
    );
  } catch {
    return 'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED';
  }
}
