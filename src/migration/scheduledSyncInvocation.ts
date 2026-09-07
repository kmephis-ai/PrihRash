import { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  evaluateScheduledSyncPreflightObservation,
  type AuthoritativeFullSnapshotObservation,
  type ScheduledSyncPreflightResult,
} from './scheduledSyncPreflight.js';

export interface AuthoritativeFullSnapshotLease<TSnapshot>
  extends AuthoritativeFullSnapshotObservation {
  readonly snapshot: TSnapshot;
}

export interface AuthoritativeFullSnapshotLeaseReader<TSnapshot> {
  readFullSnapshotObservation(): Promise<Readonly<AuthoritativeFullSnapshotLease<TSnapshot>>>;
}

export interface ScheduledIncrementalRunner<TSnapshot> {
  runIncremental(observation: Readonly<AuthoritativeFullSnapshotLease<TSnapshot>>): Promise<void>;
}

export interface ScheduledSyncInvocationResult extends ScheduledSyncPreflightResult {
  readonly incrementalStarted: boolean;
}

export async function runScheduledSyncInvocation<TSnapshot>(
  source: AuthoritativeFullSnapshotLeaseReader<TSnapshot>,
  adapter: YdbAdapter,
  incremental: ScheduledIncrementalRunner<TSnapshot>,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  const observation = await source.readFullSnapshotObservation();
  const preflight = await evaluateScheduledSyncPreflightObservation(observation, adapter);

  if (preflight.decision !== 'START_INCREMENTAL') {
    return Object.freeze({
      ...preflight,
      incrementalStarted: false,
    });
  }

  await incremental.runIncremental(observation);

  return Object.freeze({
    ...preflight,
    incrementalStarted: true,
  });
}
