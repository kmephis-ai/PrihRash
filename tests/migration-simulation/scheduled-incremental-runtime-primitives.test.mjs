import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createScheduledIncrementalRuntimePrimitives,
  ScheduledIncrementalRuntimePrimitiveError,
} from '../../dist/migration/scheduledIncrementalRuntimePrimitives.js';

const UUIDS = [
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000a002',
  '00000000-0000-0000-0000-00000000a003',
  '00000000-0000-0000-0000-00000000a004',
];
const TIMES = [
  '2026-09-07T17:10:00.000Z',
  '2026-09-07T17:10:01.000Z',
  '2026-09-07T17:10:02.000Z',
];

function deterministicPrimitives({ uuids = UUIDS, times = TIMES } = {}) {
  let uuidIndex = 0;
  let timeIndex = 0;
  return createScheduledIncrementalRuntimePrimitives({
    uuidSource: Object.freeze({
      nextUuid() {
        const value = uuids[uuidIndex];
        uuidIndex += 1;
        if (value === undefined) throw new Error('UUID_SOURCE_EXHAUSTED');
        return value;
      },
    }),
    clockSource: Object.freeze({
      now() {
        const value = times[timeIndex];
        timeIndex += 1;
        if (value === undefined) throw new Error('CLOCK_SOURCE_EXHAUSTED');
        return value;
      },
    }),
  });
}

test('runtime primitives assign opaque UUIDs only to explicit requests and expose lifecycle clocks', async () => {
  const primitives = deterministicPrimitives();

  const context = primitives.createRunContext();
  assert.deepEqual(context, {
    runId: UUIDS[0],
    startedAt: TIMES[0],
  });

  const sourceAssignments = await primitives.sourceIdentityAllocator.allocate([
    Object.freeze({ currentRowHint: 2, digest: 'same-financial-content' }),
    Object.freeze({ currentRowHint: 3, digest: 'same-financial-content' }),
  ]);
  assert.deepEqual(sourceAssignments, [
    { currentRowHint: 2, sourceRecordId: UUIDS[1] },
    { currentRowHint: 3, sourceRecordId: UUIDS[2] },
  ]);
  assert.notEqual(sourceAssignments[0].sourceRecordId, sourceAssignments[1].sourceRecordId);

  const transactionAssignments = await primitives.transactionIdentityAllocator.allocate([
    Object.freeze({ sourceRecordId: sourceAssignments[0].sourceRecordId }),
  ]);
  assert.deepEqual(transactionAssignments, [
    { sourceRecordId: UUIDS[1], transactionId: UUIDS[3] },
  ]);

  assert.equal(primitives.lifecycleClock.now(), TIMES[1]);
  assert.equal(primitives.lifecycleClock.now(), TIMES[2]);
});

test('empty allocation requests do not consume identities', async () => {
  const primitives = deterministicPrimitives({
    uuids: [UUIDS[0]],
    times: [TIMES[0]],
  });

  assert.deepEqual(await primitives.sourceIdentityAllocator.allocate([]), []);
  assert.deepEqual(await primitives.transactionIdentityAllocator.allocate([]), []);
  assert.deepEqual(primitives.createRunContext(), {
    runId: UUIDS[0],
    startedAt: TIMES[0],
  });
});

test('duplicate generated UUID fails closed across run, source and transaction identity domains', async () => {
  const primitives = deterministicPrimitives({
    uuids: [UUIDS[0], UUIDS[0]],
    times: [TIMES[0]],
  });

  primitives.createRunContext();
  await assert.rejects(
    () => primitives.sourceIdentityAllocator.allocate([
      Object.freeze({ currentRowHint: 2, digest: 'digest' }),
    ]),
    (error) => error instanceof ScheduledIncrementalRuntimePrimitiveError
      && error.code === 'DUPLICATE_RUNTIME_UUID',
  );
});

test('malformed generated UUID fails closed before assignment', async () => {
  const primitives = deterministicPrimitives({
    uuids: ['not-a-uuid'],
    times: [TIMES[0]],
  });

  await assert.rejects(
    () => primitives.transactionIdentityAllocator.allocate([
      Object.freeze({ sourceRecordId: UUIDS[0] }),
    ]),
    (error) => error instanceof ScheduledIncrementalRuntimePrimitiveError
      && error.code === 'INVALID_RUNTIME_UUID',
  );
});

test('non-canonical runtime timestamp fails closed', () => {
  const primitives = deterministicPrimitives({
    uuids: [UUIDS[0]],
    times: ['2026-09-07T17:10:00Z'],
  });

  assert.throws(
    () => primitives.createRunContext(),
    (error) => error instanceof ScheduledIncrementalRuntimePrimitiveError
      && error.code === 'INVALID_RUNTIME_TIMESTAMP',
  );
});
