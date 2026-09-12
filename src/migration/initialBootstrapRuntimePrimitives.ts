import { randomUUID } from 'node:crypto';

import type {
  InitialBootstrapApplicationClock,
  InitialBootstrapIdentityAllocator,
} from './initialBootstrapApplication.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface InitialBootstrapRuntimeUuidSource {
  nextUuid(): string;
}

export interface InitialBootstrapRuntimeClockSource {
  now(): string;
}

export interface InitialBootstrapRuntimePrimitiveDependencies {
  readonly uuidSource: InitialBootstrapRuntimeUuidSource;
  readonly clockSource: InitialBootstrapRuntimeClockSource;
}

export interface InitialBootstrapRuntimePrimitives {
  readonly identityAllocator: Readonly<InitialBootstrapIdentityAllocator>;
  readonly clock: Readonly<InitialBootstrapApplicationClock>;
}

export type InitialBootstrapRuntimePrimitiveErrorCode =
  | 'INVALID_RUNTIME_UUID'
  | 'DUPLICATE_RUNTIME_UUID'
  | 'INVALID_RUNTIME_TIMESTAMP';

export class InitialBootstrapRuntimePrimitiveError extends Error {
  readonly code: InitialBootstrapRuntimePrimitiveErrorCode;

  constructor(code: InitialBootstrapRuntimePrimitiveErrorCode) {
    super(code);
    this.name = 'InitialBootstrapRuntimePrimitiveError';
    this.code = code;
  }
}

function canonicalUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new InitialBootstrapRuntimePrimitiveError('INVALID_RUNTIME_UUID');
  return value.toLowerCase();
}

function canonicalTimestamp(value: string): string {
  if (value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new InitialBootstrapRuntimePrimitiveError('INVALID_RUNTIME_TIMESTAMP');
  }
  const canonical = new Date(value).toISOString();
  if (canonical !== value) throw new InitialBootstrapRuntimePrimitiveError('INVALID_RUNTIME_TIMESTAMP');
  return canonical;
}

export function createInitialBootstrapRuntimePrimitives(
  dependencies: Readonly<InitialBootstrapRuntimePrimitiveDependencies>,
): Readonly<InitialBootstrapRuntimePrimitives> {
  const usedUuids = new Set<string>();

  function nextUuid(): string {
    const value = canonicalUuid(dependencies.uuidSource.nextUuid());
    if (usedUuids.has(value)) throw new InitialBootstrapRuntimePrimitiveError('DUPLICATE_RUNTIME_UUID');
    usedUuids.add(value);
    return value;
  }

  const clock = Object.freeze({
    now() {
      return canonicalTimestamp(dependencies.clockSource.now());
    },
  });

  const identityAllocator: InitialBootstrapIdentityAllocator = Object.freeze({
    allocateSnapshotId: nextUuid,
    allocateMigrationRunId: nextUuid,
    allocateSourceRecordId: nextUuid,
    allocateTransactionId: nextUuid,
  });

  return Object.freeze({ identityAllocator, clock });
}

export function createNodeInitialBootstrapRuntimePrimitives(): Readonly<InitialBootstrapRuntimePrimitives> {
  return createInitialBootstrapRuntimePrimitives({
    uuidSource: Object.freeze({ nextUuid: () => randomUUID() }),
    clockSource: Object.freeze({ now: () => new Date().toISOString() }),
  });
}
