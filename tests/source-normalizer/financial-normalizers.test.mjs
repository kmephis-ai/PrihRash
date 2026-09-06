import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExpense } from '../../dist/normalization/expense.js';
import { normalizeIncome } from '../../dist/normalization/income.js';

const refs = {
  vikaMemberId: 'member-vika',
  resolveAccountId(label) {
    return `account:${label}`;
  },
  resolveCategoryId(kind, label) {
    return `category:${kind}:${label.trim()}`;
  },
};

const base = {
  occurredOn: '2026-09-06',
  amountMinor: 233400,
  description: 'Synthetic description',
  note: null,
  vikaFlag: null,
  recordGranularity: 'TRANSACTION',
  datePrecision: 'DAY',
  aggregatePeriodMonth: null,
};

test('EXPENSE maps account/category and leaves blank Vika unknown', () => {
  const result = normalizeExpense({
    ...base,
    operationType: 'Расход',
    accountLabel: 'Карта Credit',
    categoryLabel: 'Продукты',
  }, refs);
  assert.equal(result.ok, true);
  assert.equal(result.transaction.fromAccountId, 'account:Карта Credit');
  assert.equal(result.transaction.paidByMemberId, null);
  assert.equal(result.transaction.financialPeriodId, null);
  assert.equal(result.transaction.periodAssignmentQuality, 'UNASSIGNED');
});

test('Vika=Да is positive evidence and maps independently of account', () => {
  const result = normalizeExpense({
    ...base,
    operationType: 'Расход',
    accountLabel: 'Карта Visa',
    categoryLabel: 'Продукты',
    vikaFlag: 'Да',
  }, refs);
  assert.equal(result.ok, true);
  assert.equal(result.transaction.paidByMemberId, 'member-vika');
});

test('unknown expense account fails closed without aliasing', () => {
  assert.deepEqual(normalizeExpense({
    ...base,
    operationType: 'Расход',
    accountLabel: 'Visa',
    categoryLabel: 'Продукты',
  }, refs), { ok: false, errorCode: 'UNKNOWN_ACCOUNT' });
});

test('unknown Vika vocabulary fails closed', () => {
  assert.deepEqual(normalizeExpense({
    ...base,
    operationType: 'Расход',
    accountLabel: 'Карта Visa',
    categoryLabel: 'Продукты',
    vikaFlag: 'да',
  }, refs), { ok: false, errorCode: 'UNKNOWN_VIKA_FLAG' });
});

test('Не учитывать keeps fact but marks analytics EXCLUDED', () => {
  const result = normalizeExpense({
    ...base,
    operationType: 'Расход',
    accountLabel: 'Наличка',
    categoryLabel: 'Пример',
    note: '  Не учитывать  ',
  }, refs);
  assert.equal(result.ok, true);
  assert.equal(result.transaction.analyticsState, 'EXCLUDED');
  assert.equal(result.transaction.status, 'POSTED');
});

test('INCOME maps legacy Источник as income category input', () => {
  const result = normalizeIncome({
    ...base,
    operationType: 'Доход',
    accountLabel: 'Приход',
    categoryLabel: 'Synthetic income category',
  }, refs);
  assert.equal(result.ok, true);
  assert.equal(result.transaction.toAccountId, 'account:Приход');
  assert.equal(result.transaction.categoryId, 'category:INCOME:Synthetic income category');
});

test('unknown income account fails closed', () => {
  assert.deepEqual(normalizeIncome({
    ...base,
    operationType: 'Доход',
    accountLabel: 'Unknown income account',
    categoryLabel: 'Synthetic income category',
  }, refs), { ok: false, errorCode: 'UNKNOWN_ACCOUNT' });
});
