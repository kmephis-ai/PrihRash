import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLegacyFinancialRawPayload } from '../../dist/migration/rawPayloadDecoder.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function expense(overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Synthetic Account'),
    expense_category: S('Synthetic Expense'),
    description: S('Synthetic Description'),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: S('Synthetic Note'),
    ...overrides,
  };
}

function income(overrides = {}) {
  return {
    ...expense(),
    operation_type: S('Доход'),
    expense_account: null,
    expense_category: null,
    expense_amount: S('inactive legacy text is not decoded as the active amount'),
    income_account: S('Synthetic Income Account'),
    income_category: S('Synthetic Income Category'),
    income_amount: N('42.5'),
    ...overrides,
  };
}

test('decodes Sheets serial day and RUB minor units without float multiplication', () => {
  const result = decodeLegacyFinancialRawPayload(expense());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    operationType: 'Расход',
    occurredOn: '2024-01-01',
    amountMinor: 12345,
    accountLabel: 'Synthetic Account',
    categoryLabel: 'Synthetic Expense',
    description: 'Synthetic Description',
    note: 'Synthetic Note',
    vikaFlag: null,
  });
});

test('decodes current adapter schema v3 with the same typed financial semantics', () => {
  const result = decodeLegacyFinancialRawPayload(expense({ adapter_schema_version: 3 }));
  assert.equal(result.ok, true);
  assert.equal(result.value.occurredOn, '2024-01-01');
  assert.equal(result.value.amountMinor, 12345);
});

test('uses only the operation-active amount column', () => {
  const result = decodeLegacyFinancialRawPayload(income());
  assert.equal(result.ok, true);
  assert.equal(result.value.amountMinor, 4250);
  assert.equal(result.value.accountLabel, 'Synthetic Income Account');
  assert.equal(result.value.categoryLabel, 'Synthetic Income Category');
});

test('string or formula-like active amount is never parsed as money', () => {
  for (const activeCell of [S('123.45'), S('=100+23.45')]) {
    const result = decodeLegacyFinancialRawPayload(expense({ expense_amount: activeCell }));
    assert.deepEqual(result, { ok: false, errorCode: 'INVALID_AMOUNT_CELL', field: 'expense_amount' });
  }
});

test('noncanonical numeric text fails closed instead of being normalized during replay', () => {
  for (const [overrides, code, field] of [
    [{ expense_amount: N('1.0') }, 'INVALID_AMOUNT_DECIMAL', 'expense_amount'],
    [{ date: N('045292.5') }, 'INVALID_DATE_SERIAL', 'date'],
  ]) {
    const result = decodeLegacyFinancialRawPayload(expense(overrides));
    assert.deepEqual(result, { ok: false, errorCode: code, field });
  }
});

test('fractional kopecks fail closed instead of rounding', () => {
  const result = decodeLegacyFinancialRawPayload(expense({ expense_amount: N('1.001') }));
  assert.deepEqual(result, { ok: false, errorCode: 'INVALID_AMOUNT_SCALE', field: 'expense_amount' });
});

test('date must remain a typed canonical Sheets serial', () => {
  for (const date of [S('44501.75'), N('-1'), N('not-a-decimal')]) {
    const result = decodeLegacyFinancialRawPayload(expense({ date }));
    assert.equal(result.ok, false);
    assert.equal(result.field, 'date');
  }
});

test('missing account/category remain explicit null for normalizer resolution', () => {
  const result = decodeLegacyFinancialRawPayload(expense({ expense_account: null, expense_category: null }));
  assert.equal(result.ok, true);
  assert.equal(result.value.accountLabel, null);
  assert.equal(result.value.categoryLabel, null);
});
