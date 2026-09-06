import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InitialVerifiedCurrentPlanError,
  buildInitialVerifiedCurrentPlan,
} from '../../dist/migration/initialVerifiedCurrentPlan.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const SOURCE_1 = '00000000-0000-0000-0000-000000001001';
const SOURCE_2 = '00000000-0000-0000-0000-000000001002';
const SOURCE_3 = '00000000-0000-0000-0000-000000001003';
const TX_1 = '00000000-0000-0000-0000-000000002001';

function record(id, rowHint) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T21:15:00Z',
    lastSeenAt: '2026-09-06T21:15:00Z',
    lastRowHint: rowHint,
    currentDigest: `synthetic-digest-${rowHint}`,
    state: null,
    classification: null,
    normalizationStatus: null,
    transactionId: null,
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

function revision(id, rowHint) {
  return Object.freeze({
    sourceRecordId: id,
    revision: 1,
    migrationRunId: '00000000-0000-0000-0000-000000003001',
    observedAt: '2026-09-06T21:15:00Z',
    rowHint,
    rowDigest: `synthetic-digest-${rowHint}`,
    changeClass: null,
    rawPayload: '{"adapter_schema_version":2}',
  });
}

const transaction = Object.freeze({
  type: 'EXPENSE',
  occurredOn: '2026-08-01',
  recordGranularity: 'TRANSACTION',
  datePrecision: 'DAY',
  aggregatePeriodMonth: null,
  financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED',
  amountMinor: 12345,
  currency: 'RUB',
  fromAccountId: '00000000-0000-0000-0000-000000004001',
  toAccountId: null,
  categoryId: '00000000-0000-0000-0000-000000005001',
  paidByMemberId: null,
  description: 'Synthetic expense',
  note: null,
  status: 'POSTED',
  analyticsState: 'INCLUDED',
  flowKind: null,
});

function fixtures() {
  const lineage = Object.freeze({
    records: Object.freeze([record(SOURCE_1, 2), record(SOURCE_2, 3), record(SOURCE_3, 4)]),
    revisions: Object.freeze([revision(SOURCE_1, 2), revision(SOURCE_2, 3), revision(SOURCE_3, 4)]),
  });
  const projection = Object.freeze({
    outcomes: Object.freeze([
      Object.freeze({
        sourceRecordId: SOURCE_1,
        sourceOrdinal: 0,
        classification: 'FINANCIAL_RECORD',
        legacyPeriodCloseClassification: 'NOT_APPLICABLE',
        transaction,
        projectionError: null,
      }),
      Object.freeze({
        sourceRecordId: SOURCE_2,
        sourceOrdinal: 1,
        classification: 'AMBIGUOUS',
        legacyPeriodCloseClassification: 'AMBIGUOUS',
        transaction: null,
        projectionError: null,
      }),
      Object.freeze({
        sourceRecordId: SOURCE_3,
        sourceOrdinal: 2,
        classification: 'LEGACY_PERIOD_CLOSE',
        legacyPeriodCloseClassification: 'LEGACY_PERIOD_CLOSE',
        transaction: null,
        projectionError: null,
      }),
    ]),
    counters: Object.freeze({
      rowsSeen: 3,
      financialRecords: 1,
      legacyPeriodClose: 1,
      nonFinancial: 0,
      invalid: 0,
      ambiguous: 1,
      transactionCandidates: 1,
      projectionFailures: 0,
    }),
  });
  const staging = createMigrationRun({
    id: '00000000-0000-0000-0000-000000003001',
    startedAt: '2026-09-06T21:15:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 3, rowsNew: 3, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  });
  return { lineage, projection, run: markMigrationRunValidated(staging) };
}

function build(overrides = {}) {
  const base = fixtures();
  return buildInitialVerifiedCurrentPlan(
    overrides.run ?? base.run,
    overrides.lineage ?? base.lineage,
    overrides.projection ?? base.projection,
    overrides.assignments ?? [{ sourceRecordId: SOURCE_1, transactionId: TX_1 }],
  );
}

test('binds proven classifications and explicit financial identity without inventing normalization status', () => {
  const plan = build();

  assert.equal(plan.sourceRecords.length, 3);
  assert.equal(plan.transactions.length, 1);
  assert.equal(plan.sourceRecords[0].classification, 'FINANCIAL_RECORD');
  assert.equal(plan.sourceRecords[0].transactionId, TX_1);
  assert.equal(plan.sourceRecords[0].normalizationStatus, null);
  assert.equal(plan.sourceRecords[0].state, null);
  assert.equal(plan.sourceRecords[1].classification, 'AMBIGUOUS');
  assert.equal(plan.sourceRecords[1].transactionId, null);
  assert.equal(plan.sourceRecords[2].classification, 'LEGACY_PERIOD_CLOSE');
  assert.equal(plan.transactions[0].transaction, transaction);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.sourceRecords), true);
  assert.equal(Object.isFrozen(plan.transactions), true);
});

test('requires validated run with projection-refined counters', () => {
  const { lineage, projection } = fixtures();
  const staging = createMigrationRun({
    id: '00000000-0000-0000-0000-000000003001',
    startedAt: '2026-09-06T21:15:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 3, rowsNew: 3, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  });

  assert.throws(
    () => buildInitialVerifiedCurrentPlan(staging, lineage, projection, [{ sourceRecordId: SOURCE_1, transactionId: TX_1 }]),
    (error) => error instanceof InitialVerifiedCurrentPlanError && error.code === 'RUN_NOT_VALIDATED',
  );
  assert.throws(
    () => build({ run: Object.freeze({ ...fixtures().run, rowsAmbiguous: 0 }) }),
    (error) => error instanceof InitialVerifiedCurrentPlanError && error.code === 'RUN_ROW_COUNT_MISMATCH',
  );
});

test('fails closed for missing, foreign, duplicate or invalid transaction identity assignments', () => {
  for (const [assignments, code] of [
    [[], 'MISSING_TRANSACTION_ASSIGNMENT'],
    [[{ sourceRecordId: SOURCE_2, transactionId: TX_1 }, { sourceRecordId: SOURCE_1, transactionId: '00000000-0000-0000-0000-000000002002' }], 'UNEXPECTED_TRANSACTION_ASSIGNMENT'],
    [[{ sourceRecordId: SOURCE_1, transactionId: 'not-a-uuid' }], 'INVALID_TRANSACTION_ASSIGNMENT_UUID'],
    [[{ sourceRecordId: SOURCE_1, transactionId: TX_1 }, { sourceRecordId: SOURCE_1, transactionId: '00000000-0000-0000-0000-000000002002' }], 'DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID'],
  ]) {
    assert.throws(
      () => build({ assignments }),
      (error) => error instanceof InitialVerifiedCurrentPlanError && error.code === code,
    );
  }
});

test('does not allow invalid/projection-failed outcomes into verified-current plan', () => {
  const base = fixtures();
  const failedOutcome = Object.freeze({
    ...base.projection.outcomes[0],
    transaction: null,
    projectionError: Object.freeze({ stage: 'NORMALIZATION', errorCode: 'NORMALIZATION_FAILED' }),
  });
  const projection = Object.freeze({
    ...base.projection,
    outcomes: Object.freeze([failedOutcome, ...base.projection.outcomes.slice(1)]),
  });

  assert.throws(
    () => build({ projection }),
    (error) => error instanceof InitialVerifiedCurrentPlanError && error.code === 'INVALID_OR_FAILED_OUTCOME',
  );
});

test('requires exact one-to-one lineage and projection identities', () => {
  const base = fixtures();
  const projection = Object.freeze({
    ...base.projection,
    outcomes: Object.freeze([
      Object.freeze({ ...base.projection.outcomes[0], sourceRecordId: '00000000-0000-0000-0000-000000001099' }),
      ...base.projection.outcomes.slice(1),
    ]),
  });

  assert.throws(
    () => build({ projection }),
    (error) => error instanceof InitialVerifiedCurrentPlanError
      && error.code === 'LINEAGE_PROJECTION_IDENTITY_MISMATCH',
  );
});
