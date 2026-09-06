import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMeaningfulSourceRow } from '../../dist/classification/sourceRow.js';

function row(overrides = {}) {
  return {
    operationType: 'Расход',
    sourceDate: '2026-01-02',
    expenseAccount: 'Карта Visa',
    expenseCategory: 'Synthetic category',
    expenseAmountMinor: 12345,
    incomeAccount: null,
    incomeCategory: null,
    incomeAmountMinor: null,
    vikaFlag: null,
    description: 'Synthetic description',
    note: null,
    legacyPeriodCloseClassification: 'NOT_APPLICABLE',
    ...overrides,
  };
}

test('positive expense is a financial record candidate', () => {
  assert.equal(classifyMeaningfulSourceRow(row()), 'FINANCIAL_RECORD');
});

test('positive income is a financial record candidate', () => {
  assert.equal(classifyMeaningfulSourceRow(row({
    operationType: 'Доход',
    expenseAccount: null,
    expenseCategory: null,
    expenseAmountMinor: null,
    incomeAccount: 'Карта Visa',
    incomeCategory: 'Synthetic income',
    incomeAmountMinor: 50000,
  })), 'FINANCIAL_RECORD');
});

test('proven zero expense close marker is LEGACY_PERIOD_CLOSE', () => {
  assert.equal(classifyMeaningfulSourceRow(row({
    expenseAmountMinor: 0,
    legacyPeriodCloseClassification: 'LEGACY_PERIOD_CLOSE',
  })), 'LEGACY_PERIOD_CLOSE');
});

test('isolated or ordinary zero expense remains ambiguous', () => {
  assert.equal(classifyMeaningfulSourceRow(row({ expenseAmountMinor: 0 })), 'AMBIGUOUS');
  assert.equal(classifyMeaningfulSourceRow(row({
    expenseAmountMinor: 0,
    legacyPeriodCloseClassification: 'AMBIGUOUS',
  })), 'AMBIGUOUS');
});

test('zero income remains ambiguous instead of becoming a Transaction', () => {
  assert.equal(classifyMeaningfulSourceRow(row({
    operationType: 'Доход',
    expenseAccount: null,
    expenseCategory: null,
    expenseAmountMinor: null,
    incomeAccount: 'Карта Visa',
    incomeCategory: 'Synthetic income',
    incomeAmountMinor: 0,
  })), 'AMBIGUOUS');
});

test('negative or missing financial amount is invalid', () => {
  assert.equal(classifyMeaningfulSourceRow(row({ expenseAmountMinor: -1 })), 'INVALID');
  assert.equal(classifyMeaningfulSourceRow(row({ expenseAmountMinor: null })), 'INVALID');
});

test('unknown operation type fails closed', () => {
  assert.equal(classifyMeaningfulSourceRow(row({ operationType: 'Synthetic unknown' })), 'AMBIGUOUS');
});

test('blank operation with financial-looking fields is ambiguous', () => {
  assert.equal(classifyMeaningfulSourceRow(row({
    operationType: null,
    expenseAccount: null,
    expenseCategory: null,
    expenseAmountMinor: null,
    incomeAccount: 'Карта Visa',
    incomeCategory: 'Synthetic income',
    incomeAmountMinor: 100,
  })), 'AMBIGUOUS');
});

test('strict note-only row can be classified non-financial', () => {
  assert.equal(classifyMeaningfulSourceRow(row({
    operationType: null,
    sourceDate: null,
    expenseAccount: null,
    expenseCategory: null,
    expenseAmountMinor: null,
    incomeAccount: null,
    incomeCategory: null,
    incomeAmountMinor: null,
    description: null,
    note: 'Synthetic note-only service row',
  })), 'NON_FINANCIAL');
});
