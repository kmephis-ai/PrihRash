import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { YdbSchemeAdapter } from '../../dist/integration/ydb/scheme.js';
import {
  recoverUnknownControlledInitialSwapOutcome,
  recoverUnknownControlledRebuildCopyOutcome,
} from '../../dist/migration/initialControlledRebuildSchemeRecovery.js';

const RUN_ID = '00000000-0000-0000-0000-000000009701';
const DIRECTORY = 'rebuild/r_00000000000000000000000000009701';
const TABLES = Object.freeze({
  transactions: `${DIRECTORY}/transactions`,
  sourceRecords: `${DIRECTORY}/source_records`,
});

function setupPlan() {
  return Object.freeze({
    stagingDirectory: DIRECTORY,
    createDirectory: false,
    copyItems: Object.freeze([
      Object.freeze({ source: 'transactions', destination: TABLES.transactions }),
      Object.freeze({ source: 'source_records', destination: TABLES.sourceRecords }),
    ]),
  });
}

function swapPlan() {
  return Object.freeze({
    runId: RUN_ID,
    replacements: Object.freeze([
      Object.freeze({ source: TABLES.transactions, destination: 'transactions', replace: true }),
      Object.freeze({ source: TABLES.sourceRecords, destination: 'source_records', replace: true }),
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

function emptyRows() {
  return [[], [], [], [], []];
}

function candidateRows() {
  return [
    [
      { classification: 'FINANCIAL_RECORD', state: null, row_count: 2n },
      { classification: 'AMBIGUOUS', state: null, row_count: 1n },
      { classification: 'LEGACY_PERIOD_CLOSE', state: null, row_count: 1n },
    ],
    [
      { type: 'EXPENSE', row_count: 1n, total_amount_minor: 10050n },
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

function fakeData(snapshots) {
  const events = [];
  let snapshotIndex = 0;
  return {
    events,
    adapter: new YdbAdapter({
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        const sets = snapshots[snapshotIndex] ?? [];
        snapshotIndex += 1;
        let queryIndex = 0;
        events.push('begin');
        const value = await work({
          async execute(statement) {
            events.push([statement.kind, statement.text]);
            const rows = sets[queryIndex] ?? [];
            queryIndex += 1;
            return { rows };
          },
        });
        events.push('commit');
        return value;
      },
    }),
  };
}

function fakeScheme(stagingChildren, rootChildren = [
  { name: 'transactions', kind: 'TABLE' },
  { name: 'source_records', kind: 'TABLE' },
  { name: 'categories', kind: 'TABLE' },
]) {
  const events = [];
  const transport = {
    async ensureDirectory(path) { events.push(['MUTATE', 'mkdir', path]); },
    async copyTables(items) { events.push(['MUTATE', 'copy', items]); },
    async renameTables(items) { events.push(['MUTATE', 'rename', items]); },
    async listDirectory(path) {
      events.push(['READ', path]);
      return Object.freeze({
        selfKind: 'DIRECTORY',
        children: Object.freeze((path === '' ? rootChildren : stagingChildren).map((entry) => Object.freeze({ ...entry }))),
      });
    },
  };
  return { events, adapter: new YdbSchemeAdapter(transport) };
}

const presentPair = Object.freeze([
  Object.freeze({ name: 'transactions', kind: 'TABLE' }),
  Object.freeze({ name: 'source_records', kind: 'TABLE' }),
]);

function assertReadOnly(scheme, data) {
  assert.equal(scheme.events.some(([kind]) => kind === 'MUTATE'), false);
  assert.equal(data.events.every((event) => event === 'begin' || event === 'commit' || event[0] === 'READ'), true);
}

test('unknown copy + exact expected staging pair is APPLIED using reads only', async () => {
  const scheme = fakeScheme(presentPair);
  const data = fakeData([emptyRows(), emptyRows()]);
  const verdict = await recoverUnknownControlledRebuildCopyOutcome(scheme.adapter, data.adapter, setupPlan());
  assert.deepEqual(verdict, { verdict: 'APPLIED' });
  assertReadOnly(scheme, data);
});

test('unknown copy + proven absent pair is NOT_APPLIED', async () => {
  const scheme = fakeScheme([]);
  const data = fakeData([emptyRows()]);
  const verdict = await recoverUnknownControlledRebuildCopyOutcome(scheme.adapter, data.adapter, setupPlan());
  assert.equal(verdict.verdict, 'NOT_APPLIED');
  assertReadOnly(scheme, data);
});

test('partial or foreign staging state is RECOVERY_REQUIRED before data reads', async () => {
  for (const children of [
    [{ name: 'transactions', kind: 'TABLE' }],
    [...presentPair, { name: 'foreign', kind: 'TABLE' }],
    [{ name: 'transactions', kind: 'DIRECTORY' }, { name: 'source_records', kind: 'TABLE' }],
  ]) {
    const scheme = fakeScheme(children);
    const data = fakeData([]);
    const verdict = await recoverUnknownControlledRebuildCopyOutcome(scheme.adapter, data.adapter, setupPlan());
    assert.equal(verdict.verdict, 'RECOVERY_REQUIRED');
    assert.deepEqual(data.events, []);
    assertReadOnly(scheme, data);
  }
});

test('unknown rename + exact canonical candidate and absent staging pair is APPLIED', async () => {
  const scheme = fakeScheme([]);
  const data = fakeData([candidateRows()]);
  const verdict = await recoverUnknownControlledInitialSwapOutcome(
    scheme.adapter, data.adapter, swapPlan(), candidatePlan(),
  );
  assert.equal(verdict.verdict, 'APPLIED');
  assertReadOnly(scheme, data);
});

test('exact pre-swap current + exact staging candidate is NOT_APPLIED', async () => {
  const scheme = fakeScheme(presentPair);
  const data = fakeData([emptyRows(), candidateRows()]);
  const verdict = await recoverUnknownControlledInitialSwapOutcome(
    scheme.adapter, data.adapter, swapPlan(), candidatePlan(),
  );
  assert.equal(verdict.verdict, 'NOT_APPLIED');
  assertReadOnly(scheme, data);
});

test('mixed rename evidence never guesses an outcome', async () => {
  const scheme = fakeScheme([{ name: 'transactions', kind: 'TABLE' }]);
  const data = fakeData([]);
  const verdict = await recoverUnknownControlledInitialSwapOutcome(
    scheme.adapter, data.adapter, swapPlan(), candidatePlan(),
  );
  assert.equal(verdict.verdict, 'RECOVERY_REQUIRED');
  assertReadOnly(scheme, data);
});

test('content mismatch and read failure remain RECOVERY_REQUIRED', async () => {
  const scheme = fakeScheme([]);
  const data = fakeData([emptyRows()]);
  assert.equal((await recoverUnknownControlledInitialSwapOutcome(
    scheme.adapter, data.adapter, swapPlan(), candidatePlan(),
  )).verdict, 'RECOVERY_REQUIRED');

  const failingScheme = fakeScheme([]);
  failingScheme.adapter = new YdbSchemeAdapter({
    async ensureDirectory() {}, async copyTables() {}, async renameTables() {},
    async listDirectory() { throw new Error('synthetic read failure'); },
  });
  assert.equal((await recoverUnknownControlledRebuildCopyOutcome(
    failingScheme.adapter, fakeData([]).adapter, setupPlan(),
  )).verdict, 'RECOVERY_REQUIRED');
});
