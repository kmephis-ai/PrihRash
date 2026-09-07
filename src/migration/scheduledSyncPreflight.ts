import { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  evaluateScheduledSyncAdmission,
  type ScheduledSyncAdmissionDecision,
} from './scheduledSyncAdmission.js';
import { readScheduledSyncAdmissionEvidence } from './scheduledSyncAdmissionEvidence.js';

export interface AuthoritativeFullSnapshotObservation {
  readonly snapshotDigest: string;
}

export interface AuthoritativeFullSnapshotReader {
  readFullSnapshotObservation(): Promise<Readonly<AuthoritativeFullSnapshotObservation>>;
}

export interface ScheduledSyncPreflightResult {
  readonly decision: ScheduledSyncAdmissionDecision;
  readonly observedSnapshotDigest: string;
}

export async function evaluateScheduledSyncPreflightObservation(
  observation: Readonly<AuthoritativeFullSnapshotObservation>,
  adapter: YdbAdapter,
): Promise<Readonly<ScheduledSyncPreflightResult>> {
  const evidence = await readScheduledSyncAdmissionEvidence(adapter);
  const admission = evaluateScheduledSyncAdmission({
    observedSnapshotDigest: observation.snapshotDigest,
    committedBaselineRun: evidence.committedBaselineRun,
    incompleteRuns: evidence.incompleteRuns,
  });

  return Object.freeze({
    decision: admission.decision,
    observedSnapshotDigest: observation.snapshotDigest,
  });
}

export async function runScheduledSyncPreflight(
  source: AuthoritativeFullSnapshotReader,
  adapter: YdbAdapter,
): Promise<Readonly<ScheduledSyncPreflightResult>> {
  const observation = await source.readFullSnapshotObservation();
  return evaluateScheduledSyncPreflightObservation(observation, adapter);
}
