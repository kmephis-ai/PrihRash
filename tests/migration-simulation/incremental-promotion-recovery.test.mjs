import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { verifyUnknownIncrementalPromotionOutcome } from '../../dist/migration/incrementalPromotionRecovery.js';

const RUN = Object.freeze({
  id: '123e4567-e89b-42d3-a456-426614174100',
  startedAt: '2026-09-07T09:00:00Z',
  finishedAt: null,
  sourceSnapshotDigest: 'synthetic-digest',
  state: 'VALIDATED',
  rowsSeen: 0,
  rowsNew: 0,
  rowsChanged: 0,
  rowsMissing: 0,
  rowsAmbiguous: 0,
  errorCode: null,
});

const EMPTY_SNAPSHOT = Object.freeze({
  sourceRecordCount: 0,
  transactionCount: 0,
  typeAggregates: Object.freeze([]),
  categoryAggregates: Object.freeze([]),
  accountAggregates: Object.freeze([]),
  classificationCounts: Object.freeze({
    FINANCIAL_RECORD: 0,
    LEGACY_PERIOD_CLOSE: 0,
    NON_FINANCIAL: 0,
    INVALID: 0,
    AMBIGUOUS: 0,
  }),
  missingSourceRecordCount: 0,
});

const PLAN = Object.freeze({ expected: EMPTY_SNAPSHOT, promotionBlocker: null });

function durableRow(state = 'COMMITTED') {
  return {
    state,
    source_snapshot_digest: RUN.sourceSnapshotDigest,
    rows_seen: 0n,
    rows_new: 0n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
  };
}

function createTransport({ durableRows = [durableRow()], currentRowsByQuery = {}, durableError = null, currentError = null } = {}) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead(statement) {
        events.push(statement);
        if (statement.kind !== 'READ') throw new Error('write statement observed');
        if (durableError) throw durableError;
        return { rows: durableRows };
      },
      async serializableReadWrite(work) {
        const tx = {
          async execute(statement) {
            events.push(statement);
            if (statement.kind !== 'READ') throw new Error('write statement observed');
            if (currentError) throw currentError;
            for (const [needle, rows] of Object.entries(currentRowsByQuery)) {
              if (statement.text.includes(needle)) return { rows };
            }
            return { rows: [] };
          },
        };
        return work(tx);
      },
    },
  };
}

test('exact durable COMMITTED plus exact current state is verified without writes', async () => {
  const fake = createTransport();
  const result = await verifyUnknownIncrementalPromotionOutcome(new YdbAdapter(fake.transport), RUN, PLAN);

  assert.deepEqual(result, { status: 'COMMITTED_CURRENT_VERIFIED', reason: null });
  assert.equal(fake.events.length, 6);
  assert.equal(fake.events.every((statement) => statement.kind === 'READ'), true);
});

test('VALIDATED durable state stays recovery-required and does not read current tables', async () => {
  const fake = createTransport({ durableRows: [durableRow('VALIDATED')] });
  const result = await verifyUnknownIncrementalPromotionOutcome(new YdbAdapter(fake.transport), RUN, PLAN);

  assert.deepEqual(result, { status: 'RECOVERY_REQUIRED', reason: 'RUN_NOT_COMMITTED' });
  assert.equal(fake.events.length, 1);
});

test('current mismatch stays recovery-required with no retry or write', async () => {
  const fake = createTransport({
    currentRowsByQuery: {
      'FROM `source_records`': [{ classification: 'FINANCIAL_RECORD', state: null, row_count: 1n }],
    },
  });
  const result = await verifyUnknownIncrementalPromotionOutcome(new YdbAdapter(fake.transport), RUN, PLAN);

  assert.deepEqual(result, { status: 'RECOVERY_REQUIRED', reason: 'CURRENT_EVIDENCE_MISMATCH' });
  assert.equal(fake.events.every((statement) => statement.kind === 'READ'), true);
});

test('promotion blocker fails closed before any provider call', async () => {
  const fake = createTransport();
  const result = await verifyUnknownIncrementalPromotionOutcome(
    new YdbAdapter(fake.transport),
    RUN,
    Object.freeze({ expected: EMPTY_SNAPSHOT, promotionBlocker: 'UNRESOLVED_LINEAGE' }),
  );

  assert.deepEqual(result, { status: 'RECOVERY_REQUIRED', reason: 'PROMOTION_BLOCKED' });
  assert.equal(fake.events.length, 0);
});

test('malformed or unavailable current evidence becomes recovery-required', async () => {
  const malformed = createTransport({
    currentRowsByQuery: {
      'FROM `source_records`': [{ classification: 'FINANCIAL_RECORD', state: null, row_count: -1n }],
    },
  });
  assert.deepEqual(
    await verifyUnknownIncrementalPromotionOutcome(new YdbAdapter(malformed.transport), RUN, PLAN),
    { status: 'RECOVERY_REQUIRED', reason: 'CURRENT_EVIDENCE_READ_FAILED' },
  );

  const unavailable = createTransport({ currentError: new Error('synthetic current read failure') });
  assert.deepEqual(
    await verifyUnknownIncrementalPromotionOutcome(new YdbAdapter(unavailable.transport), RUN, PLAN),
    { status: 'RECOVERY_REQUIRED', reason: 'CURRENT_EVIDENCE_READ_FAILED' },
  );
});

test('durable evidence read failure becomes recovery-required without guessing commit state', async () => {
  const fake = createTransport({ durableError: new Error('synthetic durable read failure') });
  const result = await verifyUnknownIncrementalPromotionOutcome(new YdbAdapter(fake.transport), RUN, PLAN);

  assert.deepEqual(result, { status: 'RECOVERY_REQUIRED', reason: 'RUN_EVIDENCE_READ_FAILED' });
  assert.equal(fake.events.length, 1);
});
