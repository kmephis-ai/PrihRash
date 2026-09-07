import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFinancialTransaction } from '../../dist/migration/financialProjection.js';
import { projectInitialFinancialTransaction } from '../../dist/migration/initialFinancialProjection.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

const refs = {
  vikaMemberId: '00000000-0000-0000-0000-000000000901',
  resolveAccountId(label) {
    return label === 'Карта Visa' ? '00000000-0000-0000-0000-000000000902' : null;
  },
  resolveCategoryId(kind, label) {
    return kind === 'EXPENSE' && label === 'Synthetic Expense'
      ? '00000000-0000-0000-0000-000000000904'
      : null;
  },
};

function expense() {
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
  };
}

test('reusable projector accepts explicit UNKNOWN granularity without deriving from row position', () => {
  const result = projectFinancialTransaction({
    rawPayload: expense(),
    recordGranularity: 'UNKNOWN',
    datePrecision: 'UNKNOWN',
    aggregatePeriodMonth: null,
  }, { refs });

  assert.equal(result.ok, true);
  assert.equal(result.transaction.recordGranularity, 'UNKNOWN');
  assert.equal(result.transaction.datePrecision, 'UNKNOWN');
  assert.equal(result.transaction.aggregatePeriodMonth, null);
});

test('reusable projector preserves explicit verified aggregate semantics', () => {
  const result = projectFinancialTransaction({
    rawPayload: expense(),
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'MONTH',
    aggregatePeriodMonth: '2024-01-01',
  }, { refs });

  assert.equal(result.ok, true);
  assert.equal(result.transaction.recordGranularity, 'PERIOD_AGGREGATE');
  assert.equal(result.transaction.datePrecision, 'MONTH');
  assert.equal(result.transaction.aggregatePeriodMonth, '2024-01-01');
});

test('aggregate month validation remains fail-closed in reusable layer', () => {
  assert.deepEqual(projectFinancialTransaction({
    rawPayload: expense(),
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'MONTH',
    aggregatePeriodMonth: null,
  }, { refs }), {
    ok: false,
    stage: 'GRANULARITY',
    errorCode: 'AGGREGATE_PERIOD_MONTH_REQUIRED',
  });

  assert.deepEqual(projectFinancialTransaction({
    rawPayload: expense(),
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: '2024-01-01',
  }, { refs }), {
    ok: false,
    stage: 'GRANULARITY',
    errorCode: 'AGGREGATE_PERIOD_MONTH_UNEXPECTED',
  });
});

test('initial wrapper remains semantically identical for bootstrap coarse and item-level rows', () => {
  const context = {
    refs,
    granularityEvidence: {
      coarseExpenseOrdinalRange: { startInclusive: 5, endExclusive: 10 },
    },
  };

  const initialItem = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 20,
    aggregatePeriodMonth: null,
  }, context);
  const explicitItem = projectFinancialTransaction({
    rawPayload: expense(),
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
  }, { refs });
  assert.deepEqual(initialItem, explicitItem);

  const initialAggregate = projectInitialFinancialTransaction({
    rawPayload: expense(),
    initialSourceOrdinal: 7,
    aggregatePeriodMonth: '2024-01-01',
  }, context);
  const explicitAggregate = projectFinancialTransaction({
    rawPayload: expense(),
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'MONTH',
    aggregatePeriodMonth: '2024-01-01',
  }, { refs });
  assert.deepEqual(initialAggregate, explicitAggregate);
});
