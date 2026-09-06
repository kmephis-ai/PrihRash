import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InitialVerifiedCurrentPersistenceError,
  prepareInitialVerifiedCurrentWrites,
} from '../../dist/migration/initialVerifiedCurrentPersistence.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';
import { YdbParameterError } from '../../dist/integration/ydb/parameters.js';

const SOURCE_1 = '00000000-0000-0000-0000-000000001101';
const SOURCE_2 = '00000000-0000-0000-0000-000000001102';
const TX_1 = '00000000-0000-0000-0000-000000002101';

function sourceRecord(id, classification, transactionId, rowHint) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T21:20:00Z',
    lastSeenAt: '2026-09-06T21:20:00Z',
    lastRowHint: rowHint,
    currentDigest: `synthetic-digest-${rowHint}`,
    state: null,
    classification,
    normalizationStatus: null,
    transactionId,
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

const transaction = Object.freeze({
  type: 'EXPENSE',
  occurredOn: '2026-08-01',
  recordGranularity: 'PERIOD_AGGREGATE',
  datePrecision: 'MONTH',
  aggregatePeriodMonth: '2026-08-01',
  financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED',
  amountMinor: 12345,
  currency: 'RUB',
  fromAccountId: '00000000-0000-0000-0000-000000004101',
  toAccountId: null,
  categoryId: '00000000-0000-0000-0000-000000005101',
  paidByMemberId: '00000000-0000-0000-0000-000000006101',
  description: 'Synthetic expense',
  note: 'Synthetic note',
  status: 'POSTED',
  analyticsState: 'INCLUDED',
  flowKind: null,
});

function validatedRun(rowsSeen = 2) {
  return markMigrationRunValidated(createMigrationRun({
    id: '00000000-0000-0000-0000-000000003101',
    startedAt: '2026-09-06T21:20:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen, rowsNew: rowsSeen, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  }));
}

function plan() {
  return Object.freeze({
    sourceRecords: Object.freeze([
      sourceRecord(SOURCE_1, 'FINANCIAL_RECORD', TX_1, 2),
      sourceRecord(SOURCE_2, 'AMBIGUOUS', null, 3),
    ]),
    transactions: Object.freeze([
      Object.freeze({ sourceRecordId: SOURCE_1, transactionId: TX_1, transaction }),
    ]),
  });
}

test('compiles financial Transaction before linked SourceRecord and keeps non-financial source only', () => {
  const writes = prepareInitialVerifiedCurrentWrites(validatedRun(), plan(), '2026-09-06T21:21:00Z');

  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map((write) => write.role), ['TRANSACTION', 'SOURCE_RECORD', 'SOURCE_RECORD']);
  assert.deepEqual(writes.map((write) => write.sourceRecordId), [SOURCE_1, SOURCE_1, SOURCE_2]);
  assert.equal(Object.isFrozen(writes), true);
  assert.equal(writes.every((write) => Object.isFrozen(write)), true);
  assert.equal(writes.every((write) => write.estimatedParameterBytes > 0), true);
});

test('Transaction write uses exact schema-aligned typed parameters and legacy metadata rules', () => {
  const [write] = prepareInitialVerifiedCurrentWrites(validatedRun(), plan(), '2026-09-06T21:21:00Z');
  const params = write.statement.parameters;

  assert.equal(write.statement.text.startsWith('UPSERT INTO transactions '), true);
  assert.deepEqual(params.id, { type: 'Uuid', value: TX_1 });
  assert.deepEqual(params.occurred_on, { type: 'Date', value: '2026-08-01' });
  assert.deepEqual(params.captured_at, { type: 'Timestamp', value: null });
  assert.deepEqual(params.aggregate_period_month, { type: 'Date', value: '2026-08-01' });
  assert.deepEqual(params.financial_period_id, { type: 'Uuid', value: null });
  assert.deepEqual(params.period_assignment_quality, { type: 'Utf8', value: 'UNASSIGNED' });
  assert.deepEqual(params.amount_minor, { type: 'Int64', value: 12345n });
  assert.deepEqual(params.created_at, { type: 'Timestamp', value: '2026-09-06T21:21:00Z' });
  assert.deepEqual(params.updated_at, { type: 'Timestamp', value: '2026-09-06T21:21:00Z' });
  assert.deepEqual(params.version, { type: 'Uint64', value: 1n });
});

test('SourceRecord write preserves classification links without inventing state or normalization status', () => {
  const writes = prepareInitialVerifiedCurrentWrites(validatedRun(), plan(), '2026-09-06T21:21:00Z');
  const financialSource = writes[1].statement.parameters;
  const ambiguousSource = writes[2].statement.parameters;

  assert.deepEqual(financialSource.classification, { type: 'Utf8', value: 'FINANCIAL_RECORD' });
  assert.deepEqual(financialSource.transaction_id, { type: 'Uuid', value: TX_1 });
  assert.deepEqual(financialSource.state, { type: 'Utf8', value: null });
  assert.deepEqual(financialSource.normalization_status, { type: 'Utf8', value: null });
  assert.deepEqual(ambiguousSource.classification, { type: 'Utf8', value: 'AMBIGUOUS' });
  assert.deepEqual(ambiguousSource.transaction_id, { type: 'Uuid', value: null });
});

test('fails closed for non-validated run or source count mismatch', () => {
  const staging = createMigrationRun({
    id: '00000000-0000-0000-0000-000000003101',
    startedAt: '2026-09-06T21:20:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 2, rowsNew: 2, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  });

  assert.throws(
    () => prepareInitialVerifiedCurrentWrites(staging, plan(), '2026-09-06T21:21:00Z'),
    (error) => error instanceof InitialVerifiedCurrentPersistenceError && error.code === 'RUN_NOT_VALIDATED',
  );
  assert.throws(
    () => prepareInitialVerifiedCurrentWrites(validatedRun(3), plan(), '2026-09-06T21:21:00Z'),
    (error) => error instanceof InitialVerifiedCurrentPersistenceError && error.code === 'PLAN_SOURCE_COUNT_MISMATCH',
  );
});

test('fails closed for broken source/transaction link and invalid promotedAt', () => {
  const brokenPlan = Object.freeze({
    ...plan(),
    sourceRecords: Object.freeze([
      sourceRecord(SOURCE_1, 'FINANCIAL_RECORD', '00000000-0000-0000-0000-000000002199', 2),
      sourceRecord(SOURCE_2, 'AMBIGUOUS', null, 3),
    ]),
  });

  assert.throws(
    () => prepareInitialVerifiedCurrentWrites(validatedRun(), brokenPlan, '2026-09-06T21:21:00Z'),
    (error) => error instanceof InitialVerifiedCurrentPersistenceError && error.code === 'TRANSACTION_LINK_MISMATCH',
  );
  assert.throws(
    () => prepareInitialVerifiedCurrentWrites(validatedRun(), plan(), 'not-a-timestamp'),
    (error) => error instanceof YdbParameterError && error.code === 'INVALID_TIMESTAMP',
  );
});
