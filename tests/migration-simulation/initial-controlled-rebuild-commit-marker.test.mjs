import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter, YdbCommitOutcomeUnknownError, YdbTransportCommitOutcomeUnknownError } from '../../dist/integration/ydb/adapter.js';
import { YdbSchemeAdapter } from '../../dist/integration/ydb/scheme.js';
import {
  ControlledInitialCommitMarkerError,
  commitControlledInitialRun,
  recoverControlledInitialCommitMarker,
} from '../../dist/migration/initialControlledRebuildCommitMarker.js';
import { createMigrationRun, markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';

const RUN_ID = '00000000-0000-0000-0000-000000009701';
const DIRECTORY = 'rebuild/r_00000000000000000000000000009701';
const FINISHED_AT = '2026-09-06T22:05:00Z';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T22:00:00Z',
    sourceSnapshotDigest: 'synthetic-commit-marker-digest',
    counters: { rowsSeen: 4, rowsNew: 4, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  }));
}

function swapPlan(runId = RUN_ID) {
  const directory = `rebuild/r_${runId.replaceAll('-', '')}`;
  return Object.freeze({
    runId,
    replacements: Object.freeze([
      Object.freeze({ source: `${directory}/transactions`, destination: 'transactions', replace: true }),
      Object.freeze({ source: `${directory}/source_records`, destination: 'source_records', replace: true }),
    ]),
  });
}

function source(id, classification, transactionId = null) {
  return Object.freeze({
    id, sourceType: 'GOOGLE_SHEETS', sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T21:55:00Z', lastSeenAt: '2026-09-06T21:55:00Z', lastRowHint: 2,
    currentDigest: `synthetic-${id}`, state: null, classification, normalizationStatus: null,
    transactionId, currentRevision: 1, resolutionCode: null, resolvedAt: null, resolvedBy: null,
  });
}

function candidatePlan() {
  const expenseSource = '00000000-0000-0000-0000-000000009501';
  const incomeSource = '00000000-0000-0000-0000-000000009502';
  const expenseTx = '00000000-0000-0000-0000-000000009511';
  const incomeTx = '00000000-0000-0000-0000-000000009512';
  return Object.freeze({
    sourceRecords: Object.freeze([
      source(expenseSource, 'FINANCIAL_RECORD', expenseTx),
      source(incomeSource, 'FINANCIAL_RECORD', incomeTx),
      source('00000000-0000-0000-0000-000000009503', 'AMBIGUOUS'),
      source('00000000-0000-0000-0000-000000009504', 'LEGACY_PERIOD_CLOSE'),
    ]),
    transactions: Object.freeze([
      Object.freeze({ sourceRecordId: expenseSource, transactionId: expenseTx, transaction: Object.freeze({
        type: 'EXPENSE', occurredOn: '2026-08-01', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
        aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
        amountMinor: 10050, currency: 'RUB', fromAccountId: '00000000-0000-0000-0000-000000009201',
        toAccountId: null, categoryId: '00000000-0000-0000-0000-000000009301', paidByMemberId: null,
        description: 'Synthetic expense', note: null, status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
      }) }),
      Object.freeze({ sourceRecordId: incomeSource, transactionId: incomeTx, transaction: Object.freeze({
        type: 'INCOME', occurredOn: '2026-08-02', recordGranularity: 'TRANSACTION', datePrecision: 'DAY',
        aggregatePeriodMonth: null, financialPeriodId: null, periodAssignmentQuality: 'UNASSIGNED',
        amountMinor: 20000, currency: 'RUB', fromAccountId: null,
        toAccountId: '00000000-0000-0000-0000-000000009202',
        categoryId: '00000000-0000-0000-0000-000000009302', paidByMemberId: null,
        description: 'Synthetic income', note: null, status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null,
      }) }),
    ]),
  });
}

function candidateRows(expenseTotal = 10050n) {
  return [
    [
      { classification: 'FINANCIAL_RECORD', state: null, row_count: 2n },
      { classification: 'AMBIGUOUS', state: null, row_count: 1n },
      { classification: 'LEGACY_PERIOD_CLOSE', state: null, row_count: 1n },
    ],
    [
      { type: 'EXPENSE', row_count: 1n, total_amount_minor: expenseTotal },
      { type: 'INCOME', row_count: 1n, total_amount_minor: 20000n },
    ],
    [
      { type: 'EXPENSE', dimension_id: '00000000-0000-0000-0000-000000009301', row_count: 1n, total_amount_minor: 10050n },
      { type: 'INCOME', dimension_id: '00000000-0000-0000-0000-000000009302', row_count: 1n, total_amount_minor: 20000n },
    ],
    [{ type: 'EXPENSE', dimension_id: '00000000-0000-0000-0000-000000009201', row_count: 1n, total_amount_minor: 10050n }],
    [{ type: 'INCOME', dimension_id: '00000000-0000-0000-0000-000000009202', row_count: 1n, total_amount_minor: 20000n }],
  ];
}

function fakeScheme({ stagingChildren = [], rootChildren } = {}) {
  const events = [];
  const canonical = rootChildren ?? [
    { name: 'transactions', kind: 'TABLE' },
    { name: 'source_records', kind: 'TABLE' },
    { name: 'categories', kind: 'TABLE' },
  ];
  return {
    events,
    adapter: new YdbSchemeAdapter({
      async ensureDirectory(path) { events.push(['MUTATE', 'mkdir', path]); },
      async copyTables(items) { events.push(['MUTATE', 'copy', items]); },
      async renameTables(items) { events.push(['MUTATE', 'rename', items]); },
      async listDirectory(path) {
        events.push(['READ', path]);
        return Object.freeze({
          selfKind: path === '' ? 'DATABASE' : 'DIRECTORY',
          children: Object.freeze((path === '' ? canonical : stagingChildren).map((entry) => Object.freeze({ ...entry }))),
        });
      },
    }),
  };
}

function markerData({ markerState = 'COMMITTED', markerReadbackState = 'COMMITTED', unknownCommit = false, rows = candidateRows() } = {}) {
  const events = [];
  let transactionIndex = 0;
  return {
    events,
    adapter: new YdbAdapter({
      async executeRead(statement) {
        events.push(['read', statement]);
        return { rows: [{
          state: markerState,
          finished_at: markerState === 'COMMITTED' ? FINISHED_AT : null,
          error_code: markerState === 'FAILED' ? 'synthetic-failure' : null,
        }] };
      },
      async serializableReadWrite(work) {
        transactionIndex += 1;
        const currentTransaction = transactionIndex;
        events.push(['begin', currentTransaction]);
        let queryIndex = 0;
        let sawMarkerWrite = false;
        const result = await work({
          async execute(statement) {
            events.push(['execute', currentTransaction, statement]);
            if (statement.kind === 'WRITE') {
              sawMarkerWrite = true;
              return { rows: [] };
            }
            if (statement.text.includes('FROM migration_runs')) {
              return { rows: [{
                state: markerReadbackState,
                finished_at: markerReadbackState === 'COMMITTED' ? FINISHED_AT : null,
                error_code: null,
              }] };
            }
            const resultRows = rows[queryIndex] ?? [];
            queryIndex += 1;
            return { rows: resultRows };
          },
        });
        if (sawMarkerWrite && unknownCommit) {
          throw new YdbTransportCommitOutcomeUnknownError(new Error('synthetic marker ambiguity'));
        }
        events.push(['commit', currentTransaction]);
        return result;
      },
    }),
  };
}

function expectMarkerCode(code, work) {
  return assert.rejects(
    work,
    (error) => error instanceof ControlledInitialCommitMarkerError && error.code === code,
  );
}

function markerWrites(data) {
  return data.events.filter((event) => event[0] === 'execute' && event[2]?.kind === 'WRITE');
}

function assertNoSchemeMutation(scheme) {
  assert.equal(scheme.events.some(([kind]) => kind === 'MUTATE'), false);
}

test('marker is written only after exact read-only post-swap proof for the same run and candidate', async () => {
  const scheme = fakeScheme();
  const data = markerData();
  const run = await commitControlledInitialRun(
    data.adapter, scheme.adapter, validatedRun(), swapPlan(), candidatePlan(), FINISHED_AT,
  );

  assert.equal(run.state, 'COMMITTED');
  assert.equal(run.finishedAt, FINISHED_AT);
  assertNoSchemeMutation(scheme);
  assert.deepEqual(scheme.events.map(([kind, path]) => [kind, path]), [
    ['READ', ''], ['READ', DIRECTORY],
  ]);
  assert.equal(markerWrites(data).length, 1);
  const firstWriteIndex = data.events.findIndex((event) => event[0] === 'execute' && event[2]?.kind === 'WRITE');
  const verificationCommitIndex = data.events.findIndex((event) => event[0] === 'commit' && event[1] === 1);
  assert.equal(firstWriteIndex > verificationCommitIndex, true);
});

test('candidate mismatch, mixed pair, or foreign run blocks marker before mutation', async () => {
  const cases = [
    { scheme: fakeScheme(), data: markerData({ rows: candidateRows(10051n) }), plan: swapPlan() },
    { scheme: fakeScheme({ stagingChildren: [{ name: 'transactions', kind: 'TABLE' }] }), data: markerData(), plan: swapPlan() },
    { scheme: fakeScheme(), data: markerData(), plan: swapPlan('00000000-0000-0000-0000-000000009702') },
  ];
  for (const item of cases) {
    await expectMarkerCode('POST_SWAP_VERIFICATION_NOT_MATCHED', () => commitControlledInitialRun(
      item.data.adapter, item.scheme.adapter, validatedRun(), item.plan, candidatePlan(), FINISHED_AT,
    ));
    assert.equal(markerWrites(item.data).length, 0);
    assertNoSchemeMutation(item.scheme);
  }
});

test('conditional marker conflict is still detected by exact read-your-write verification', async () => {
  const scheme = fakeScheme();
  const data = markerData({ markerReadbackState: 'VALIDATED' });
  await expectMarkerCode('MARKER_TRANSITION_CONFLICT', () => commitControlledInitialRun(
    data.adapter, scheme.adapter, validatedRun(), swapPlan(), candidatePlan(), FINISHED_AT,
  ));
  assert.equal(markerWrites(data).length, 1);
  assertNoSchemeMutation(scheme);
});

test('unknown marker commit outcome remains unresolved and never repeats the swap', async () => {
  const scheme = fakeScheme();
  const data = markerData({ unknownCommit: true });
  await assert.rejects(
    () => commitControlledInitialRun(
      data.adapter, scheme.adapter, validatedRun(), swapPlan(), candidatePlan(), FINISHED_AT,
    ),
    (error) => error instanceof YdbCommitOutcomeUnknownError && error.code === 'COMMIT_OUTCOME_UNKNOWN',
  );
  assertNoSchemeMutation(scheme);
});

test('exact post-swap plus VALIDATED durable row is marker-pending recovery', async () => {
  const scheme = fakeScheme();
  const data = markerData({ markerState: 'VALIDATED' });
  assert.deepEqual(
    await recoverControlledInitialCommitMarker(
      data.adapter, scheme.adapter, RUN_ID, swapPlan(), candidatePlan(), FINISHED_AT,
    ),
    { status: 'SWAP_APPLIED_MARKER_PENDING' },
  );
  assert.equal(markerWrites(data).length, 0);
  assertNoSchemeMutation(scheme);
});

test('exact post-swap plus exact COMMITTED marker is verified', async () => {
  const scheme = fakeScheme();
  const data = markerData({ markerState: 'COMMITTED' });
  assert.deepEqual(
    await recoverControlledInitialCommitMarker(
      data.adapter, scheme.adapter, RUN_ID, swapPlan(), candidatePlan(), FINISHED_AT,
    ),
    { status: 'COMMITTED' },
  );
  assert.equal(markerWrites(data).length, 0);
  assertNoSchemeMutation(scheme);
});

test('canonical mismatch, mixed pair, conflicting marker, and FAILED state require recovery', async () => {
  const cases = [
    { scheme: fakeScheme(), data: markerData({ rows: candidateRows(10051n) }) },
    { scheme: fakeScheme({ stagingChildren: [{ name: 'source_records', kind: 'TABLE' }] }), data: markerData() },
    { scheme: fakeScheme(), data: markerData({ markerState: 'FAILED' }) },
  ];
  for (const item of cases) {
    assert.deepEqual(
      await recoverControlledInitialCommitMarker(
        item.data.adapter, item.scheme.adapter, RUN_ID, swapPlan(), candidatePlan(), FINISHED_AT,
      ),
      { status: 'RECOVERY_REQUIRED' },
    );
    assert.equal(markerWrites(item.data).length, 0);
    assertNoSchemeMutation(item.scheme);
  }

  const scheme = fakeScheme();
  const data = markerData({ markerState: 'COMMITTED' });
  data.adapter = new YdbAdapter({
    async executeRead() { return { rows: [{ state: 'COMMITTED', finished_at: '2026-09-06T22:06:00Z', error_code: null }] }; },
    async serializableReadWrite(work) {
      let queryIndex = 0;
      return work({ async execute() { return { rows: candidateRows()[queryIndex++] ?? [] }; } });
    },
  });
  assert.deepEqual(
    await recoverControlledInitialCommitMarker(
      data.adapter, scheme.adapter, RUN_ID, swapPlan(), candidatePlan(), FINISHED_AT,
    ),
    { status: 'RECOVERY_REQUIRED' },
  );
});

test('repeat recovery is read-only and never calls renameTables', async () => {
  const scheme = fakeScheme();
  const data = markerData({ markerState: 'VALIDATED' });
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await recoverControlledInitialCommitMarker(
      data.adapter, scheme.adapter, RUN_ID, swapPlan(), candidatePlan(), FINISHED_AT,
    )).status, 'SWAP_APPLIED_MARKER_PENDING');
  }
  assert.equal(scheme.events.filter(([kind]) => kind === 'READ').length, 4);
  assertNoSchemeMutation(scheme);
  assert.equal(markerWrites(data).length, 0);
});

test('requires unfinished VALIDATED run before any post-swap read', async () => {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T22:00:00Z',
    sourceSnapshotDigest: 'synthetic-commit-marker-digest',
    counters: { rowsSeen: 4, rowsNew: 4, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  });
  const scheme = fakeScheme();
  const data = markerData();
  await expectMarkerCode('RUN_NOT_VALIDATED', () => commitControlledInitialRun(
    data.adapter, scheme.adapter, staging, swapPlan(), candidatePlan(), FINISHED_AT,
  ));
  assert.deepEqual(scheme.events, []);
  assert.deepEqual(data.events, []);
});
