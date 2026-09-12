import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InitialBootstrapRuntimePrimitiveError,
  createInitialBootstrapRuntimePrimitives,
} from '../../dist/migration/initialBootstrapRuntimePrimitives.js';

const UUIDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
];

test('initial bootstrap runtime allocates globally unique migration and reference identities', () => {
  let index = 0;
  const runtime = createInitialBootstrapRuntimePrimitives({
    uuidSource: { nextUuid: () => UUIDS[index++] },
    clockSource: { now: () => '2026-09-12T08:30:00.000Z' },
  });
  assert.equal(runtime.referenceIdentityAllocator.allocateReferenceId(), UUIDS[0]);
  assert.equal(runtime.identityAllocator.allocateSnapshotId(), UUIDS[1]);
  assert.equal(runtime.identityAllocator.allocateMigrationRunId(), UUIDS[2]);
  assert.equal(runtime.identityAllocator.allocateSourceRecordId({ sourceOrdinal: 0, rowHint: 2, digest: 'x' }), UUIDS[3]);
  assert.equal(runtime.identityAllocator.allocateTransactionId({ sourceOrdinal: 0, sourceRecordId: UUIDS[3] }), UUIDS[4]);
  assert.equal(runtime.clock.now(), '2026-09-12T08:30:00.000Z');
});

test('initial bootstrap runtime rejects duplicate UUID evidence across reference and migration identities', () => {
  const runtime = createInitialBootstrapRuntimePrimitives({
    uuidSource: { nextUuid: () => UUIDS[0] },
    clockSource: { now: () => '2026-09-12T08:30:00.000Z' },
  });
  runtime.referenceIdentityAllocator.allocateReferenceId();
  assert.throws(
    () => runtime.identityAllocator.allocateMigrationRunId(),
    (error) => error instanceof InitialBootstrapRuntimePrimitiveError
      && error.code === 'DUPLICATE_RUNTIME_UUID',
  );
});
