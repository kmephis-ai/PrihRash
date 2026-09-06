import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { resolveUnknownPromotionOutcome } from '../../dist/migration/promotionOutcome.js';

const RUN = Object.freeze({
  id: '123e4567-e89b-42d3-a456-426614174100',
  startedAt: '2026-09-06T17:00:00Z',
  finishedAt: null,
  sourceSnapshotDigest: 'synthetic-digest',
  state: 'VALIDATED',
  rowsSeen: 17,
  rowsNew: 3,
  rowsChanged: 2,
  rowsMissing: 1,
  rowsAmbiguous: 4,
  errorCode: null,
});

function row(overrides = {}) {
  return {
    state: 'COMMITTED',
    source_snapshot_digest: RUN.sourceSnapshotDigest,
    rows_seen: 17n,
    rows_new: 3n,
    rows_changed: 2n,
    rows_missing: 1n,
    rows_ambiguous: 4n,
    ...overrides,
  };
}

function createReadTransport(rows, options = {}) {
  const events = [];
  const transport = {
    async executeRead(statement) {
      events.push(statement);
      if (options.readError) throw options.readError;
      return { rows };
    },
    async serializableReadWrite() {
      throw new Error('write transaction must not be opened by outcome resolver');
    },
  };
  return { events, transport };
}

test('unknown commit outcome resolves only from exact COMMITTED read-back evidence', async () => {
  const fake = createReadTransport([row()]);
  const result = await resolveUnknownPromotionOutcome(new YdbAdapter(fake.transport), RUN);

  assert.deepEqual(result, { status: 'COMMITTED_CONFIRMED', observedState: 'COMMITTED' });
  assert.equal(fake.events.length, 1);
  assert.equal(fake.events[0].kind, 'READ');
  assert.equal(fake.events[0].text.includes(RUN.id), false);
  assert.deepEqual(fake.events[0].parameters.id, { type: 'Uuid', value: RUN.id });
  assert.equal(RUN.state, 'VALIDATED');
});

test('VALIDATED read-back stays unresolved and is never guessed as rollback', async () => {
  const fake = createReadTransport([row({ state: 'VALIDATED' })]);
  const result = await resolveUnknownPromotionOutcome(new YdbAdapter(fake.transport), RUN);

  assert.deepEqual(result, {
    status: 'UNRESOLVED',
    reason: 'RUN_NOT_COMMITTED',
    observedState: 'VALIDATED',
  });
});

test('FAILED and unknown states stay unresolved', async () => {
  for (const state of ['FAILED', 'STAGING', 'FUTURE_STATE']) {
    const fake = createReadTransport([row({ state })]);
    const result = await resolveUnknownPromotionOutcome(new YdbAdapter(fake.transport), RUN);
    assert.deepEqual(result, {
      status: 'UNRESOLVED',
      reason: 'RUN_NOT_COMMITTED',
      observedState: state,
    });
  }
});

test('missing or duplicate read-back rows stay unresolved', async () => {
  const missing = createReadTransport([]);
  assert.deepEqual(
    await resolveUnknownPromotionOutcome(new YdbAdapter(missing.transport), RUN),
    { status: 'UNRESOLVED', reason: 'RUN_NOT_FOUND', observedState: null },
  );

  const duplicate = createReadTransport([row(), row()]);
  assert.deepEqual(
    await resolveUnknownPromotionOutcome(new YdbAdapter(duplicate.transport), RUN),
    { status: 'UNRESOLVED', reason: 'RUN_RESULT_AMBIGUOUS', observedState: null },
  );
});

test('COMMITTED state with mismatched immutable evidence stays unresolved', async () => {
  const mismatches = [
    { source_snapshot_digest: 'different' },
    { rows_seen: 18n },
    { rows_new: 4n },
    { rows_changed: 3n },
    { rows_missing: 2n },
    { rows_ambiguous: 5n },
  ];

  for (const mismatch of mismatches) {
    const fake = createReadTransport([row(mismatch)]);
    const result = await resolveUnknownPromotionOutcome(new YdbAdapter(fake.transport), RUN);
    assert.deepEqual(result, {
      status: 'UNRESOLVED',
      reason: 'RUN_EVIDENCE_MISMATCH',
      observedState: 'COMMITTED',
    });
  }
});

test('safe-number counters are accepted but lossy or malformed counters fail closed', async () => {
  const numeric = createReadTransport([row({
    rows_seen: 17,
    rows_new: 3,
    rows_changed: 2,
    rows_missing: 1,
    rows_ambiguous: 4,
  })]);
  assert.equal(
    (await resolveUnknownPromotionOutcome(new YdbAdapter(numeric.transport), RUN)).status,
    'COMMITTED_CONFIRMED',
  );

  const malformed = createReadTransport([row({ rows_seen: 17.5 })]);
  assert.equal(
    (await resolveUnknownPromotionOutcome(new YdbAdapter(malformed.transport), RUN)).reason,
    'RUN_EVIDENCE_MISMATCH',
  );
});

test('read transport errors propagate instead of becoming guessed lifecycle states', async () => {
  const readError = new Error('synthetic read failed');
  const fake = createReadTransport([], { readError });

  await assert.rejects(
    () => resolveUnknownPromotionOutcome(new YdbAdapter(fake.transport), RUN),
    (error) => error === readError,
  );
});
