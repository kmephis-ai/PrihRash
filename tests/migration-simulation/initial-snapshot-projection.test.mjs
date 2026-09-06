import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InitialSnapshotProjectionStructuralError,
  projectInitialSnapshot,
} from '../../dist/migration/initialSnapshotProjection.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const refs = {
  vikaMemberId: id(900),
  resolveAccountId(label) {
    return new Map([
      ['Карта Visa', id(901)],
      ['Приход', id(902)],
    ]).get(label) ?? null;
  },
  resolveCategoryId(kind, label) {
    return new Map([
      ['EXPENSE\u0000Synthetic Expense', id(903)],
      ['INCOME\u0000Synthetic Income', id(904)],
    ]).get(`${kind}\u0000${label}`) ?? null;
  },
};

const context = {
  refs,
  granularityEvidence: {
    coarseExpenseOrdinalRange: { startInclusive: 100, endExclusive: 110 },
  },
};

function expense(amount = '12.34', overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Expense'),
    description: S('Synthetic expense'),
    expense_amount: N(amount),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  };
}

function income() {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Доход'),
    expense_account: null,
    expense_category: null,
    description: S('Synthetic income'),
    expense_amount: null,
    income_account: S('Приход'),
    income_category: S('Synthetic Income'),
    income_amount: N('42'),
    vika_flag: null,
    note: null,
  };
}

function closeMarker(description) {
  return expense('0', {
    expense_category: null,
    description: S(description),
  });
}

function noteOnly() {
  return {
    adapter_schema_version: 2,
    date: null,
    operation_type: null,
    expense_account: null,
    expense_category: null,
    description: null,
    expense_amount: null,
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: S('Synthetic note only'),
  };
}

function row(sourceRecordId, sourceOrdinal, rawPayload, aggregatePeriodMonth = null) {
  return { sourceRecordId, sourceOrdinal, rawPayload, aggregatePeriodMonth };
}

test('complete mixed snapshot emits exactly one outcome per row with no silent drop', () => {
  const rows = [
    row(id(1), 10, closeMarker('Плюсовые позиции')),
    row(id(2), 11, closeMarker('Минусовые позиции')),
    row(id(3), 12, closeMarker('Вика Красное')),
    row(id(4), 13, closeMarker('Текущий баланс')),
    row(id(5), 20, expense()),
    row(id(6), 21, income()),
    row(id(7), 30, noteOnly()),
    row(id(8), 31, expense('0', { description: S('Synthetic ordinary zero') })),
    row(id(9), 32, expense('12.34', { expense_amount: S('12.34') })),
    row(id(10), 33, expense('12.34', { date: S('2024-01-01') })),
    row(id(11), 34, expense('12.34', { expense_account: S('Synthetic unknown account') })),
  ];

  const projection = projectInitialSnapshot(rows, context);

  assert.equal(projection.outcomes.length, rows.length);
  assert.deepEqual(projection.outcomes.map((outcome) => outcome.sourceRecordId), rows.map((item) => item.sourceRecordId));
  assert.deepEqual(projection.counters, {
    rowsSeen: 11,
    financialRecords: 3,
    legacyPeriodClose: 4,
    nonFinancial: 1,
    invalid: 2,
    ambiguous: 1,
    transactionCandidates: 2,
    projectionFailures: 2,
  });

  assert.deepEqual(projection.outcomes.slice(0, 4).map((outcome) => outcome.classification), [
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
  ]);
  assert.equal(projection.outcomes[4].transaction.type, 'EXPENSE');
  assert.equal(projection.outcomes[5].transaction.type, 'INCOME');
  assert.equal(projection.outcomes[6].classification, 'NON_FINANCIAL');
  assert.equal(projection.outcomes[7].classification, 'AMBIGUOUS');
  assert.equal(projection.outcomes[8].classification, 'INVALID');
  assert.equal(projection.outcomes[8].projectionError, null);
  assert.deepEqual(projection.outcomes[9].projectionError, {
    stage: 'DECODE',
    errorCode: 'INVALID_DATE_CELL',
  });
  assert.equal(projection.outcomes[10].classification, 'FINANCIAL_RECORD');
  assert.deepEqual(projection.outcomes[10].projectionError, {
    stage: 'NORMALIZATION',
    errorCode: 'UNKNOWN_ACCOUNT',
  });
  assert.equal(projection.outcomes[10].transaction, null);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.outcomes), true);
  assert.equal(Object.isFrozen(projection.counters), true);
});

test('exact duplicate financial payloads remain independent outcomes', () => {
  const duplicate = expense();
  const projection = projectInitialSnapshot([
    row(id(20), 40, duplicate),
    row(id(21), 41, duplicate),
  ], context);

  assert.equal(projection.counters.financialRecords, 2);
  assert.equal(projection.counters.transactionCandidates, 2);
  assert.deepEqual(projection.outcomes.map((outcome) => outcome.sourceRecordId), [id(20), id(21)]);
});

test('coarse financial outcome remains explicit failure without aggregate month evidence', () => {
  const projection = projectInitialSnapshot([
    row(id(30), 105, expense()),
  ], context);

  assert.equal(projection.outcomes[0].classification, 'FINANCIAL_RECORD');
  assert.equal(projection.outcomes[0].transaction, null);
  assert.deepEqual(projection.outcomes[0].projectionError, {
    stage: 'GRANULARITY',
    errorCode: 'AGGREGATE_PERIOD_MONTH_REQUIRED',
  });
});

for (const [name, rows, code] of [
  ['duplicate source id', [row(id(40), 1, expense()), row(id(40).toUpperCase(), 2, expense())], 'DUPLICATE_SOURCE_RECORD_ID'],
  ['duplicate ordinal', [row(id(41), 1, expense()), row(id(42), 1, expense())], 'DUPLICATE_SOURCE_ORDINAL'],
  ['invalid ordinal', [row(id(43), -1, expense())], 'INVALID_SOURCE_ORDINAL'],
]) {
  test(`snapshot projection fails closed for ${name}`, () => {
    assert.throws(
      () => projectInitialSnapshot(rows, context),
      (error) => error instanceof InitialSnapshotProjectionStructuralError && error.code === code,
    );
  });
}
