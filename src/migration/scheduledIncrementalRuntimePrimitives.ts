import { randomUUID } from 'node:crypto';
import type { IncrementalSourceRecordAssignmentRequest } from './incrementalLineagePlan.js';
import type { IncrementalTransactionIdentityAssignmentRequest } from './incrementalTransactionIdentityRequests.js';
import type {
  IncrementalSourceIdentityAllocator,
  IncrementalTransactionIdentityAllocator,
} from './scheduledIncrementalCandidatePreparation.js';
import type { ScheduledIncrementalLifecycleClock } from './scheduledIncrementalLifecycle.js';
import type { ScheduledIncrementalRunContext } from './scheduledIncrementalApplicationRunner.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface ScheduledIncrementalRuntimeUuidSource {
  nextUuid(): string;
}

export interface ScheduledIncrementalRuntimeClockSource {
  now(): string;
}

export interface ScheduledIncrementalRuntimePrimitiveDependencies {
  readonly uuidSource: ScheduledIncrementalRuntimeUuidSource;
  readonly clockSource: ScheduledIncrementalRuntimeClockSource;
}

export interface ScheduledIncrementalRuntimePrimitives {
  readonly createRunContext: () => Readonly<ScheduledIncrementalRunContext>;
  readonly lifecycleClock: Readonly<ScheduledIncrementalLifecycleClock>;
  readonly sourceIdentityAllocator: Readonly<IncrementalSourceIdentityAllocator>;
  readonly transactionIdentityAllocator: Readonly<IncrementalTransactionIdentityAllocator>;
}

export type ScheduledIncrementalRuntimePrimitiveErrorCode =
  | 'INVALID_RUNTIME_UUID'
  | 'DUPLICATE_RUNTIME_UUID'
  | 'INVALID_RUNTIME_TIMESTAMP';

export class ScheduledIncrementalRuntimePrimitiveError extends Error {
  readonly code: ScheduledIncrementalRuntimePrimitiveErrorCode;

  constructor(code: ScheduledIncrementalRuntimePrimitiveErrorCode) {
    super(code);
    this.name = 'ScheduledIncrementalRuntimePrimitiveError';
    this.code = code;
  }
}

function canonicalUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ScheduledIncrementalRuntimePrimitiveError('INVALID_RUNTIME_UUID');
  }
  return value.toLowerCase();
}

function canonicalTimestamp(value: string): string {
  if (value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new ScheduledIncrementalRuntimePrimitiveError('INVALID_RUNTIME_TIMESTAMP');
  }
  const canonical = new Date(value).toISOString();
  if (canonical !== value) {
    throw new ScheduledIncrementalRuntimePrimitiveError('INVALID_RUNTIME_TIMESTAMP');
  }
  return canonical;
}

export function createScheduledIncrementalRuntimePrimitives(
  dependencies: Readonly<ScheduledIncrementalRuntimePrimitiveDependencies>,
): Readonly<ScheduledIncrementalRuntimePrimitives> {
  const usedUuids = new Set<string>();

  function nextUuid(): string {
    const uuid = canonicalUuid(dependencies.uuidSource.nextUuid());
    if (usedUuids.has(uuid)) {
      throw new ScheduledIncrementalRuntimePrimitiveError('DUPLICATE_RUNTIME_UUID');
    }
    usedUuids.add(uuid);
    return uuid;
  }

  function now(): string {
    return canonicalTimestamp(dependencies.clockSource.now());
  }

  const sourceIdentityAllocator: IncrementalSourceIdentityAllocator = Object.freeze({
    async allocate(requests: readonly Readonly<IncrementalSourceRecordAssignmentRequest>[]) {
      return Object.freeze(requests.map((request) => Object.freeze({
        currentRowHint: request.currentRowHint,
        sourceRecordId: nextUuid(),
      })));
    },
  });

  const transactionIdentityAllocator: IncrementalTransactionIdentityAllocator = Object.freeze({
    async allocate(requests: readonly Readonly<IncrementalTransactionIdentityAssignmentRequest>[]) {
      return Object.freeze(requests.map((request) => Object.freeze({
        sourceRecordId: request.sourceRecordId,
        transactionId: nextUuid(),
      })));
    },
  });

  const lifecycleClock: ScheduledIncrementalLifecycleClock = Object.freeze({ now });

  return Object.freeze({
    createRunContext() {
      return Object.freeze({
        runId: nextUuid(),
        startedAt: now(),
      });
    },
    lifecycleClock,
    sourceIdentityAllocator,
    transactionIdentityAllocator,
  });
}

export function createNodeScheduledIncrementalRuntimePrimitives(): Readonly<ScheduledIncrementalRuntimePrimitives> {
  return createScheduledIncrementalRuntimePrimitives({
    uuidSource: Object.freeze({ nextUuid: () => randomUUID() }),
    clockSource: Object.freeze({ now: () => new Date().toISOString() }),
  });
}
