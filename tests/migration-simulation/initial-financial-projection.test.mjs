import test from 'node:test';
import assert from 'node:assert/strict';
import { projectInitialFinancialTransaction } from '../../dist/migration/initialFinancialProjection.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

const refs = {
  vikaMemberId: '00000000-0000-0000-0000-000000000901',
  resolveAccountId(label) {
    return new Map([
      ['Карта Visa', '00000000-0000-0000-0000-000000000902'],
      ['Приход', '00000000-0000-0000-0000-000000000903'],
    ]).get(label) ?? null;
  },
  resolveCategoryId(kind, label) {
    return new Map([
      ['EXPENSE\u0000Synthetic Expense', '00000000-0000-0000-0000-000000000904'],
      ['INCOME\u0000Synthetic Income', '00000000-0000-0000-0000-000000000905'],
    ]).get(`${kind}\u0000${label}`) ?? null;
  },
};

const context = {
  refs,
  granularityEvidence: {
    coarseExpenseOrdinalRange: { startInclusive: 5, endExclusive: 10 },
  },
};

function expense(overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Expense'),
    description: S('Synthetic description'),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  };
}

function income(overrides = {}) {
  return {
    ...expense(),
    operation_type: S('Доход'),
    expense_account: null,
    expense_category: null,
    expense_amount: null,
    income_account: S('Приход'),
    income_category: S('Synthetic Income'),
    income_amount: N('42.5'),
    ...overrides,
  };
}

test('projects item-level expense through existing normalizer with legacy period unassigned', () => {
  const result = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: null,
  }, context);

  assert.equal(result.ok, true);
  assert.deepEqual(result.transaction, {
    type: 'EXPENSE',
    occurredOn: '2024-01-01',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 12345,
    currency: 'RUB',
    fromAccountId: '00000000-0000-0000-0000-000000000902',
    toAccountId: null,
    categoryId: '00000000-0000-0000-0000-000000000904',
    paidByMemberId: null,
    description: 'Synthetic description',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
  });
  assert.equal(Object.isFrozen(result.transaction), true);
});

test('projects income without borrowing expense granularity evidence', () => {
  const result = projectInitialFinancialTransaction({
    rawPayload: income(),
    initialSourceOrdinal: 7,
    aggregatePeriodMonth: null,
  }, context);

  assert.equal(result.ok, true);
  assert.equal(result.transaction.type, 'INCOME');
  assert.equal(result.transaction.recordGranularity, 'UNKNOWN');
  assert.equal(result.transaction.datePrecision, 'UNKNOWN');
  assert.equal(result.transaction.amountMinor, 4250);
  assert.equal(result.transaction.toAccountId, '00000000-0000-0000-0000-000000000903');
});

test('preserves Vika positive evidence and excluded analytics note', () => {
  const result = projectInitialFinancialTransaction({
    rawPayload: expense({ vika_flag: S('Да'), note: S('Не учитывать') }),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: null,
  }, context);

  assert.equal(result.ok, true);
  assert.equal(result.transaction.paidByMemberId, refs.vikaMemberId);
  assert.equal(result.transaction.analyticsState, 'EXCLUDED');
});

test('coarse expense requires explicit aggregate month evidence', () => {
  const missing = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 7,
    aggregatePeriodMonth: null,
  }, context);
  assert.deepEqual(missing, {
    ok: false,
    stage: 'GRANULARITY',
    errorCode: 'AGGREGATE_PERIOD_MONTH_REQUIRED',
  });

  const invalid = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 7,
    aggregatePeriodMonth: '2024-01-15',
  }, context);
  assert.deepEqual(invalid, {
    ok: false,
    stage: 'GRANULARITY',
    errorCode: 'INVALID_AGGREGATE_PERIOD_MONTH',
  });

  const valid = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 7,
    aggregatePeriodMonth: '2024-01-01',
  }, context);
  assert.equal(valid.ok, true);
  assert.equal(valid.transaction.recordGranularity, 'PERIOD_AGGREGATE');
  assert.equal(valid.transaction.datePrecision, 'MONTH');
  assert.equal(valid.transaction.aggregatePeriodMonth, '2024-01-01');
});

test('aggregate month evidence is rejected for non-aggregate rows', () => {
  const result = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: '2024-01-01',
  }, context);
  assert.deepEqual(result, {
    ok: false,
    stage: 'GRANULARITY',
    errorCode: 'AGGREGATE_PERIOD_MONTH_UNEXPECTED',
  });
});

test('zero financial rows are not promoted by this positive-only projector', () => {
  const result = projectInitialFinancialTransaction({
    rawPayload: expense({ expense_amount: N('0') }),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: null,
  }, context);
  assert.deepEqual(result, {
    ok: false,
    stage: 'NORMALIZATION',
    errorCode: 'NOT_POSITIVE_FINANCIAL_RECORD',
  });
});

test('decoder and normalizer failures remain fail-closed', () => {
  const decodeFailure = projectInitialFinancialTransaction({
    rawPayload: expense({ expense_amount: S('123.45') }),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: null,
  }, context);
  assert.deepEqual(decodeFailure, {
    ok: false,
    stage: 'DECODE',
    errorCode: 'INVALID_AMOUNT_CELL',
  });

  const normalizationFailure = projectInitialFinancialTransaction({
    rawPayload: expense({ expense_account: S('Unknown synthetic account') }),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: null,
  }, context);
  assert.deepEqual(normalizationFailure, {
    ok: false,
    stage: 'NORMALIZATION',
    errorCode: 'UNKNOWN_ACCOUNT',
  });
});
