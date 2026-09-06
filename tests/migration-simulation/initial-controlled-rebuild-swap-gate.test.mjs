import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gateControlledInitialSwap,
  ControlledInitialSwapGateError,
} from '../../dist/migration/initialControlledRebuildSwapGate.js';
import { buildExpectedControlledRebuildReconciliation } from '../../dist/migration/initialControlledRebuildReconciliation.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const RUN_ID = '00000000-0000-0000-0000-000000008701';
const STAGING_TRANSACTIONS = 'rebuild/r_00000000000000000000000000008701/transactions';
const STAGING_SOURCE_RECORDS = 'rebuild/r_00000000000000000000000000008701/source_records';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T21:45:00Z',
    sourceSnapshotDigest: 'synthetic-swap-gate-digest',
    counters: { rowsSeen: 2, rowsNew: 2, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  }));
}

function source(id, classification, transactionId = null) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T21:45:00Z',
    lastSeenAt: '2026-09-06T21:45:00Z',
    lastRowHint: 2,
    currentDigest: `synthetic-${id}`,
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

function verifiedPlan() {
  const sourceRecordId = '00000000-0000-0000-0000-000000008711';
  const transactionId = '00000000-0000-0000-0000-000000008721';
  return Object.freeze({
    sourceRecords: Object.freeze([
      source(sourceRecordId, 'FINANCIAL_RECORD', transactionId),
      source('00000000-0000-0000-0000-000000008712', 'NON_FINANCIAL'),
    ]),
    transactions: Object.freeze([
      Object.freeze({
        sourceRecordId,
        transactionId,
        transaction: Object.freeze({
          type: 'EXPENSE',
          occurredOn: '2026-08-01',
          recordGranularity: 'TRANSACTION',
          datePrecision: 'DAY',
          aggregatePeriodMonth: null,
          financialPeriodId: null,
          periodAssignmentQuality: 'UNASSIGNED',
          amountMinor: 12345,
          currency: 'RUB',
          fromAccountId: '00000000-0000-0000-0000-000000008731',
          toAccountId: null,
          categoryId: '00000000-0000-0000-0000-000000008741',
          paidByMemberId: null,
          description: 'Synthetic expense',
          note: null,
          status: 'POSTED',
          analyticsState: 'INCLUDED',
          flowKind: null,
        }),
      }),
    ]),
  });
}

function controlledPlan(overrides = {}) {
  return Object.freeze({
    runId: RUN_ID,
    stagingTables: Object.freeze({
      transactions: STAGING_TRANSACTIONS,
      sourceRecords: STAGING_SOURCE_RECORDS,
    }),
    batches: Object.freeze([]),
    replacements: Object.freeze([
      Object.freeze({ source: STAGING_TRANSACTIONS, destination: 'transactions', replace: true }),
      Object.freeze({ source: STAGING_SOURCE_RECORDS, destination: 'source_records', replace: true }),
    ]),
    expectedTransactionCount: 1,
    expectedSourceRecordCount: 2,
    ...overrides,
  });
}

function exactObserved(plan = verifiedPlan()) {
  return buildExpectedControlledRebuildReconciliation(plan);
}

function expectGateError(code, work) {
  assert.throws(
    work,
    (error) => error instanceof ControlledInitialSwapGateError && error.code === code,
  );
}

test('returns an immutable exact two-table swap plan only after matched reconciliation', () => {
  const result = gateControlledInitialSwap(
    validatedRun(),
    controlledPlan(),
    verifiedPlan(),
    exactObserved(),
    null,
  );

  assert.equal(result.runId, RUN_ID);
  assert.deepEqual(result.replacements, [
    { source: STAGING_TRANSACTIONS, destination: 'transactions', replace: true },
    { source: STAGING_SOURCE_RECORDS, destination: 'source_records', replace: true },
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.replacements), true);
  assert.equal(Object.isFrozen(result.replacements[0]), true);
});

test('blocks swap when a previous verified shadow exists', () => {
  expectGateError('PREVIOUS_VERIFIED_SHADOW_PRESENT', () => gateControlledInitialSwap(
    validatedRun(), controlledPlan(), verifiedPlan(), exactObserved(),
    '00000000-0000-0000-0000-000000009999',
  ));
});

test('blocks swap when controlled expected counts drift from the validated candidate', () => {
  expectGateError('CONTROLLED_EXPECTED_COUNT_MISMATCH', () => gateControlledInitialSwap(
    validatedRun(), controlledPlan({ expectedSourceRecordCount: 3 }), verifiedPlan(), exactObserved(), null,
  ));
});

test('blocks swap on any exact staging reconciliation mismatch', () => {
  const observed = exactObserved();
  const mismatched = Object.freeze({ ...observed, transactionCount: observed.transactionCount + 1 });
  expectGateError('STAGING_RECONCILIATION_MISMATCH', () => gateControlledInitialSwap(
    validatedRun(), controlledPlan(), verifiedPlan(), mismatched, null,
  ));
});

test('blocks malformed or reordered replacement plans instead of emitting a partial swap set', () => {
  const reversed = Object.freeze([
    Object.freeze({ source: STAGING_SOURCE_RECORDS, destination: 'source_records', replace: true }),
    Object.freeze({ source: STAGING_TRANSACTIONS, destination: 'transactions', replace: true }),
  ]);
  expectGateError('INVALID_REPLACEMENT_PLAN', () => gateControlledInitialSwap(
    validatedRun(), controlledPlan({ replacements: reversed }), verifiedPlan(), exactObserved(), null,
  ));

  const wrongDestination = Object.freeze([
    Object.freeze({ source: STAGING_TRANSACTIONS, destination: 'transactions_backup', replace: true }),
    Object.freeze({ source: STAGING_SOURCE_RECORDS, destination: 'source_records', replace: true }),
  ]);
  expectGateError('INVALID_REPLACEMENT_PLAN', () => gateControlledInitialSwap(
    validatedRun(), controlledPlan({ replacements: wrongDestination }), verifiedPlan(), exactObserved(), null,
  ));
});

test('requires the same validated MigrationRun identity and an unfinished validated state', () => {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T21:45:00Z',
    sourceSnapshotDigest: 'synthetic-swap-gate-digest',
    counters: { rowsSeen: 2, rowsNew: 2, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  });
  expectGateError('RUN_NOT_VALIDATED', () => gateControlledInitialSwap(
    staging, controlledPlan(), verifiedPlan(), exactObserved(), null,
  ));

  expectGateError('INVALID_REPLACEMENT_PLAN', () => gateControlledInitialSwap(
    validatedRun(), controlledPlan({ runId: '00000000-0000-0000-0000-000000008799' }), verifiedPlan(), exactObserved(), null,
  ));
});
