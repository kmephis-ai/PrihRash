import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INITIAL_BOOTSTRAP_JOB_ENV,
  InitialBootstrapJobError,
  executeInitialBootstrapJob,
  readInitialBootstrapJobConfig,
} from '../../dist/runtime/initialBootstrapJob.js';

const MULTILINE_SECRET = ['synthetic-line-a', 'synthetic-line-b', ''].join('\n');
const PRIVATE_EVIDENCE = JSON.stringify({
  schema_version: 1,
  coarse_expense_ordinal_range: { start_inclusive: 0, end_exclusive: 1 },
  aggregate_period_month_ranges: [
    { start_inclusive: 0, end_exclusive: 1, aggregate_period_month: '2024-01-01' },
  ],
});
const CONFIG = Object.freeze({
  spreadsheetId: 'synthetic-sheet-id',
  googleServiceAccountEmail: 'synthetic-reader@example.invalid',
  googleServiceAccountPrivateKey: MULTILINE_SECRET,
  ydbConnectionString: 'grpcs://synthetic.invalid:2135/?database=/synthetic',
  privateHistoricalEvidence: PRIVATE_EVIDENCE,
});
const CAPTURED_AT = '2026-09-12T10:30:00.000Z';
const UUID = '00000000-0000-0000-0000-000000000001';

const SOURCE_LEASE = Object.freeze({
  snapshotDigest: 'synthetic-snapshot-digest',
  snapshot: Object.freeze({
    spreadsheetId: CONFIG.spreadsheetId,
    spreadsheetTitle: 'Synthetic',
    sheetName: 'Synthetic',
    locale: 'ru_RU',
    timeZone: 'Europe/Moscow',
    rows: Object.freeze([
      Object.freeze({ rowHint: 2, values: Object.freeze(Array.from({ length: 11 }, () => null)) }),
    ]),
  }),
});

const MATCHED_EVIDENCE = Object.freeze({
  checks: Object.freeze({
    SOURCE_RECORD_COUNT: 'MATCHED',
    TRANSACTION_COUNTS: 'MATCHED',
    TOTALS_BY_TYPE: 'MATCHED',
    CATEGORY_AGGREGATES: 'MATCHED',
    ACCOUNT_AGGREGATES: 'MATCHED',
    CLASSIFICATION_COUNTS: 'MATCHED',
    LEGACY_PERIOD_CLOSE_COUNT: 'MATCHED',
    INVALID_AMBIGUOUS_MISSING_COUNTS: 'MATCHED',
  }),
  unexplainedHighImpactMismatchCount: 0,
});

const COMMITTED_RESULT = Object.freeze({
  status: 'COMMITTED',
  run: Object.freeze({
    id: UUID,
    startedAt: CAPTURED_AT,
    finishedAt: CAPTURED_AT,
    sourceSnapshotDigest: SOURCE_LEASE.snapshotDigest,
    state: 'COMMITTED',
    rowsSeen: 1,
    rowsNew: 1,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
  }),
});

function fakeTransport() {
  return Object.freeze({
    async executeRead() {
      throw new Error('UNEXPECTED_YDB_READ');
    },
    async serializableReadWrite() {
      throw new Error('UNEXPECTED_YDB_TRANSACTION');
    },
  });
}

function makeRuntime(options = {}) {
  const calls = options.calls ?? [];
  const digest = Object.freeze({
    digestCanonicalSnapshot() { return SOURCE_LEASE.snapshotDigest; },
    digestCanonicalRow() { return 'synthetic-row-digest'; },
  });
  const historicalEvidence = Object.freeze({
    granularityEvidence: Object.freeze({
      coarseExpenseOrdinalRange: Object.freeze({ startInclusive: 0, endExclusive: 1 }),
    }),
    aggregateMonthRanges: Object.freeze([
      Object.freeze({ startInclusive: 0, endExclusive: 1, aggregatePeriodMonth: '2024-01-01' }),
    ]),
    aggregatePeriodMonthForSourceOrdinal(sourceOrdinal) {
      calls.push('evidence-month');
      assert.equal(sourceOrdinal, 0);
      return '2024-01-01';
    },
    assertCompatibleRowCount(rowCount) {
      calls.push('evidence-row-count');
      assert.equal(rowCount, 1);
    },
  });
  const refs = Object.freeze({
    vikaMemberId: UUID,
    resolveAccountId() { return null; },
    resolveCategoryId() { return null; },
  });
  const identityAllocator = Object.freeze({
    allocateSnapshotId() { return UUID; },
    allocateMigrationRunId() { return UUID; },
    allocateSourceRecordId() { return UUID; },
    allocateTransactionId() { return UUID; },
  });
  const clock = Object.freeze({ now: () => CAPTURED_AT });
  const reconciliation = Object.freeze({
    port: Object.freeze({
      async reconcile() {
        throw new Error('UNEXPECTED_RECONCILIATION_PORT_CALL');
      },
    }),
    async verifyCommittedCurrent() {
      calls.push('verify');
      return options.verifyEvidence ?? MATCHED_EVIDENCE;
    },
  });
  const source = Object.freeze({
    async readFullSnapshotObservation() {
      calls.push('read-source');
      if (options.sourceError) throw options.sourceError;
      return SOURCE_LEASE;
    },
  });
  const applicationResult = options.applicationResult ?? COMMITTED_RESULT;

  return Object.freeze({
    parseHistoricalEvidence(serialized) {
      calls.push('evidence');
      assert.equal(serialized, PRIVATE_EVIDENCE);
      return historicalEvidence;
    },
    createDigest() {
      calls.push('digest');
      return digest;
    },
    createSource(config, receivedDigest) {
      calls.push('source');
      assert.deepEqual(config, CONFIG);
      assert.equal(receivedDigest, digest);
      return source;
    },
    createRuntimePrimitives() {
      calls.push('primitives');
      return Object.freeze({ identityAllocator, clock });
    },
    async createYdbClient(config) {
      calls.push('ydb');
      assert.deepEqual(config, CONFIG);
      return Object.freeze({
        transport: fakeTransport(),
        async close() {
          calls.push('close');
          if (options.closeError) throw options.closeError;
        },
      });
    },
    async readReferenceResolver() {
      calls.push('refs');
      return refs;
    },
    createReconciliation(_adapter, projectionContext, receivedEvidence) {
      calls.push('reconciliation');
      assert.equal(projectionContext.refs, refs);
      assert.equal(projectionContext.granularityEvidence, historicalEvidence.granularityEvidence);
      assert.equal(receivedEvidence, historicalEvidence);
      return reconciliation;
    },
    async runApplication(observation, dependencies) {
      calls.push('application');
      assert.equal(observation.capturedAt, CAPTURED_AT);
      assert.equal(observation.snapshotDigest, SOURCE_LEASE.snapshotDigest);
      assert.equal(observation.rows.length, 1);
      assert.equal(observation.rows[0].rowHint, 2);
      assert.equal(observation.rows[0].digest, 'synthetic-row-digest');
      assert.equal(observation.rows[0].aggregatePeriodMonth, '2024-01-01');
      assert.equal(dependencies.identityAllocator, identityAllocator);
      assert.equal(dependencies.clock, clock);
      assert.equal(dependencies.projectionContext.refs, refs);
      assert.equal(dependencies.reconciliation, reconciliation.port);
      if (options.applicationError) throw options.applicationError;
      return applicationResult;
    },
  });
}

test('environment parser requires exact runtime values while preserving private evidence and multiline key bytes', () => {
  const env = {
    [INITIAL_BOOTSTRAP_JOB_ENV.spreadsheetId]: CONFIG.spreadsheetId,
    [INITIAL_BOOTSTRAP_JOB_ENV.googleServiceAccountEmail]: CONFIG.googleServiceAccountEmail,
    [INITIAL_BOOTSTRAP_JOB_ENV.googleServiceAccountPrivateKey]: CONFIG.googleServiceAccountPrivateKey,
    [INITIAL_BOOTSTRAP_JOB_ENV.ydbConnectionString]: CONFIG.ydbConnectionString,
    [INITIAL_BOOTSTRAP_JOB_ENV.privateHistoricalEvidence]: CONFIG.privateHistoricalEvidence,
  };

  const parsed = readInitialBootstrapJobConfig(env);
  assert.deepEqual(parsed, CONFIG);
  assert.equal(parsed.googleServiceAccountPrivateKey.endsWith('\n'), true);
  assert.equal(parsed.privateHistoricalEvidence, PRIVATE_EVIDENCE);
  assert.equal(Object.isFrozen(parsed), true);
});

test('malformed config fails before any provider/runtime creation', async () => {
  const cases = [
    ['spreadsheetId', '', 'INVALID_SPREADSHEET_ID'],
    ['googleServiceAccountEmail', ' padded@example.invalid ', 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'],
    ['googleServiceAccountPrivateKey', '   ', 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'],
    ['ydbConnectionString', ' grpcs://synthetic.invalid ', 'INVALID_YDB_CONNECTION_STRING'],
    ['privateHistoricalEvidence', '   ', 'INVALID_PRIVATE_HISTORICAL_EVIDENCE'],
  ];

  for (const [field, value, code] of cases) {
    const calls = [];
    const invalid = { ...CONFIG, [field]: value };
    await assert.rejects(
      () => executeInitialBootstrapJob(invalid, makeRuntime({ calls })),
      (error) => error instanceof InitialBootstrapJobError
        && error.code === code
        && error.message === code,
    );
    assert.deepEqual(calls, []);
  }
});

test('one-shot composition reads the authoritative lease, builds exact observation and verifies committed current state', async () => {
  const calls = [];
  const result = await executeInitialBootstrapJob(CONFIG, makeRuntime({ calls }));

  assert.equal(result, COMMITTED_RESULT);
  assert.deepEqual(calls, [
    'evidence',
    'digest',
    'source',
    'primitives',
    'ydb',
    'read-source',
    'evidence-row-count',
    'evidence-month',
    'refs',
    'reconciliation',
    'application',
    'verify',
    'close',
  ]);
});

test('non-committed outcome is returned without pretending post-commit verification happened', async () => {
  const calls = [];
  const recovery = Object.freeze({
    status: 'RECOVERY_REQUIRED',
    run: null,
    reason: 'PROMOTION_OUTCOME_UNKNOWN',
  });
  const result = await executeInitialBootstrapJob(CONFIG, makeRuntime({
    calls,
    applicationResult: recovery,
  }));

  assert.equal(result, recovery);
  assert.equal(calls.includes('verify'), false);
  assert.equal(calls.at(-1), 'close');
});

test('committed result fails closed when independent current reconciliation does not fully match', async () => {
  const calls = [];
  const mismatch = Object.freeze({
    checks: Object.freeze({ ...MATCHED_EVIDENCE.checks, TOTALS_BY_TYPE: 'MISMATCH' }),
    unexplainedHighImpactMismatchCount: 0,
  });

  await assert.rejects(
    () => executeInitialBootstrapJob(CONFIG, makeRuntime({ calls, verifyEvidence: mismatch })),
    (error) => error instanceof InitialBootstrapJobError
      && error.code === 'COMMITTED_RECONCILIATION_MISMATCH'
      && error.message === 'COMMITTED_RECONCILIATION_MISMATCH',
  );
  assert.equal(calls.includes('verify'), true);
  assert.equal(calls.at(-1), 'close');
});

test('application failure remains primary even when YDB close also fails', async () => {
  const calls = [];
  const applicationError = new Error('SYNTHETIC_APPLICATION_FAILURE');
  const closeError = new Error('SYNTHETIC_CLOSE_FAILURE');

  await assert.rejects(
    () => executeInitialBootstrapJob(CONFIG, makeRuntime({ calls, applicationError, closeError })),
    (error) => error === applicationError,
  );
  assert.equal(calls.at(-1), 'close');
});

test('close failure after a successful application is reduced to a safe job error', async () => {
  const calls = [];

  await assert.rejects(
    () => executeInitialBootstrapJob(CONFIG, makeRuntime({ calls, closeError: new Error('private close detail') })),
    (error) => error instanceof InitialBootstrapJobError
      && error.code === 'YDB_CLIENT_CLOSE_FAILED'
      && error.message === 'YDB_CLIENT_CLOSE_FAILED',
  );
  assert.equal(calls.at(-1), 'close');
});
