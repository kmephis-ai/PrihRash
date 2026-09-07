import { YdbAdapter } from '../integration/ydb/adapter.js';
import type { GoogleSheetsImmutableSnapshot } from '../integration/google/googleSheetsFullSnapshotReader.js';
import type { ReferenceResolver } from '../normalization/types.js';
import { readYdbReferenceResolverSnapshot } from '../reference/ydbReferenceEvidenceReader.js';
import {
  projectGoogleSnapshotForIncrementalMigration,
  type CanonicalSourceRowDigest,
} from './googleSnapshotProjection.js';
import {
  ScheduledIncrementalApplicationRunner,
} from './scheduledIncrementalApplicationRunner.js';
import {
  createNodeScheduledIncrementalRuntimePrimitives,
  type ScheduledIncrementalRuntimePrimitives,
} from './scheduledIncrementalRuntimePrimitives.js';
import {
  runScheduledSyncInvocation,
  type AuthoritativeFullSnapshotLease,
  type AuthoritativeFullSnapshotLeaseReader,
  type ScheduledIncrementalRunner,
  type ScheduledSyncInvocationResult,
} from './scheduledSyncInvocation.js';

export interface ScheduledSyncObservationClock {
  now(): string;
}

export interface ScheduledSyncApplicationDependencies {
  readonly source: AuthoritativeFullSnapshotLeaseReader<GoogleSheetsImmutableSnapshot>;
  readonly adapter: YdbAdapter;
  readonly rowDigest: CanonicalSourceRowDigest;
  readonly observationClock: ScheduledSyncObservationClock;
  readonly createRuntimePrimitives?: () => Readonly<ScheduledIncrementalRuntimePrimitives>;
  readonly readReferenceResolver?: () => Promise<Readonly<ReferenceResolver>>;
}

function createLazyIncrementalRunner(
  dependencies: Readonly<ScheduledSyncApplicationDependencies>,
): ScheduledIncrementalRunner<GoogleSheetsImmutableSnapshot> {
  return Object.freeze({
    async runIncremental(
      observation: Readonly<AuthoritativeFullSnapshotLease<GoogleSheetsImmutableSnapshot>>,
    ): Promise<void> {
      const runtime = (dependencies.createRuntimePrimitives
        ?? createNodeScheduledIncrementalRuntimePrimitives)();
      const readReferences = dependencies.readReferenceResolver
        ?? (() => readYdbReferenceResolverSnapshot(dependencies.adapter));

      const runner = new ScheduledIncrementalApplicationRunner<GoogleSheetsImmutableSnapshot>(
        dependencies.adapter,
        {
          projectObservation(received) {
            return Object.freeze({
              projection: projectGoogleSnapshotForIncrementalMigration(
                received.snapshot,
                dependencies.rowDigest,
              ),
              observedAt: dependencies.observationClock.now(),
            });
          },
          createRunContext: runtime.createRunContext,
          lifecycleClock: runtime.lifecycleClock,
          readReferenceResolver: readReferences,
          sourceIdentityAllocator: runtime.sourceIdentityAllocator,
          transactionIdentityAllocator: runtime.transactionIdentityAllocator,
        },
      );

      await runner.runIncremental(observation);
    },
  });
}

export async function runScheduledSyncApplication(
  dependencies: Readonly<ScheduledSyncApplicationDependencies>,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  return runScheduledSyncInvocation(
    dependencies.source,
    dependencies.adapter,
    createLazyIncrementalRunner(dependencies),
  );
}
