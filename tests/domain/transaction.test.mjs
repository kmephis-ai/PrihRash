import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTransaction } from '../../dist/domain/transaction.js';

const base = {
  occurredOn: '2026-09-06',
  recordGranularity: 'TRANSACTION',
  datePrecision: 'DAY',
  aggregatePeriodMonth: null,
  financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED',
  amountMinor: 12345,
  currency: 'RUB',
  paidByMemberId: null,
  description: null,
  note: null,
  status: 'POSTED',
  analyticsState: 'INCLUDED',
  flowKind: null,
};

test('valid EXPENSE obeys canonical v1 shape', () => {
  const errors = validateTransaction({
    ...base,
    type: 'EXPENSE',
    fromAccountId: 'account-expense',
    toAccountId: null,
    categoryId: 'category-expense',
  }, { categoryKind: 'EXPENSE' });
  assert.deepEqual(errors, []);
});

test('valid INCOME obeys canonical v1 shape', () => {
  const errors = validateTransaction({
    ...base,
    type: 'INCOME',
    fromAccountId: null,
    toAccountId: 'account-income',
    categoryId: 'category-income',
  }, { categoryKind: 'INCOME' });
  assert.deepEqual(errors, []);
});

test('TRANSFER rejects category and same account', () => {
  const errors = validateTransaction({
    ...base,
    type: 'TRANSFER',
    fromAccountId: 'same',
    toAccountId: 'same',
    categoryId: 'forbidden',
    flowKind: 'OWN_FUNDS_TRANSFER',
  }, { categoryKind: 'EXPENSE' });
  assert.deepEqual(errors, [
    'TRANSFER_ACCOUNTS_MUST_DIFFER',
    'TRANSFER_CATEGORY_FORBIDDEN',
    'TRANSFER_CATEGORY_KIND_FORBIDDEN',
  ]);
});

test('flow_kind is forbidden outside TRANSFER', () => {
  const errors = validateTransaction({
    ...base,
    type: 'EXPENSE',
    fromAccountId: 'account-expense',
    toAccountId: null,
    categoryId: 'category-expense',
    flowKind: 'CREDIT_DRAW',
  }, { categoryKind: 'EXPENSE' });
  assert.ok(errors.includes('FLOW_KIND_REQUIRES_TRANSFER'));
});

test('RUB-only v1 rejects other currency at runtime', () => {
  const errors = validateTransaction({
    ...base,
    type: 'EXPENSE',
    fromAccountId: 'account-expense',
    toAccountId: null,
    categoryId: 'category-expense',
    currency: 'USD',
  }, { categoryKind: 'EXPENSE' });
  assert.ok(errors.includes('UNSUPPORTED_CURRENCY'));
});

test('PERIOD_AGGREGATE requires month precision and aggregate month', () => {
  const errors = validateTransaction({
    ...base,
    type: 'EXPENSE',
    fromAccountId: 'account-expense',
    toAccountId: null,
    categoryId: 'category-expense',
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'DAY',
  }, { categoryKind: 'EXPENSE' });
  assert.ok(errors.includes('PERIOD_AGGREGATE_MONTH_REQUIRED'));
  assert.ok(errors.includes('PERIOD_AGGREGATE_DATE_PRECISION_INVALID'));
});
