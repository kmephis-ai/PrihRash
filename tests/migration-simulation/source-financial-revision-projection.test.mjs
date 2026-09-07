import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SourceFinancialRevisionProjectionError,
  projectSourceFinancialRevision,
} from '../../dist/migration/sourceFinancialRevisionProjection.js';

function payload(overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: { kind: 'NUMBER', value: '45500' },
    operation_type: { kind: 'STRING', value: 'Расход' },
    expense_account: { kind: 'STRING', value: 'Synthetic Expense Account' },
    expense_category: { kind: 'STRING', value: 'Synthetic Expense Category' },
    description: { kind: 'STRING', value: 'synthetic description' },
    expense_amount: { kind: 'NUMBER', value: '123.45' },
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: { kind: 'STRING', value: 'Да' },
    note: null,
    ...overrides,
  };
}

test('projects exact expense-side financial revision and keeps inactive income side null', () => {
  const revision = projectSourceFinancialRevision(payload());

  assert.deepEqual(revision, {
    operationType: 'Расход',
    sourceDate: '2024-07-27',
    expenseAccount: 'Synthetic Expense Account',
    expenseCategory: 'Synthetic Expense Category',
    expenseAmountMinor: 12345,
    incomeAccount: null,
    incomeCategory: null,
    incomeAmountMinor: null,
    description: 'synthetic description',
    vikaFlag: 'Да',
    note: null,
  });
  assert.equal(Object.isFrozen(revision), true);
});

test('projects exact income-side financial revision independently of expense side', () => {
  const revision = projectSourceFinancialRevision(payload({
    operation_type: { kind: 'STRING', value: 'Доход' },
    expense_account: null,
    expense_category: null,
    expense_amount: null,
    income_account: { kind: 'STRING', value: 'Synthetic Income Account' },
    income_category: { kind: 'STRING', value: 'Synthetic Income Category' },
    income_amount: { kind: 'NUMBER', value: '200' },
    vika_flag: null,
    note: { kind: 'STRING', value: 'synthetic note' },
  }));

  assert.equal(revision.operationType, 'Доход');
  assert.equal(revision.expenseAmountMinor, null);
  assert.equal(revision.incomeAccount, 'Synthetic Income Account');
  assert.equal(revision.incomeCategory, 'Synthetic Income Category');
  assert.equal(revision.incomeAmountMinor, 20000);
  assert.equal(revision.note, 'synthetic note');
});

test('non-financial nullable fields remain representable without inventing values', () => {
  const revision = projectSourceFinancialRevision(payload({
    date: null,
    operation_type: null,
    expense_account: null,
    expense_category: null,
    expense_amount: null,
    income_account: null,
    income_category: null,
    income_amount: null,
    description: null,
    vika_flag: null,
    note: null,
  }));

  assert.deepEqual(revision, {
    operationType: null,
    sourceDate: null,
    expenseAccount: null,
    expenseCategory: null,
    expenseAmountMinor: null,
    incomeAccount: null,
    incomeCategory: null,
    incomeAmountMinor: null,
    description: null,
    vikaFlag: null,
    note: null,
  });
});

test('malformed canonical cells fail closed with the original decoder error and field', () => {
  const malformed = [
    [payload({ adapter_schema_version: 1 }), 'INVALID_PAYLOAD_SCHEMA', 'adapter_schema_version'],
    [payload({ date: { kind: 'STRING', value: '2026-09-01' } }), 'INVALID_DATE_CELL', 'date'],
    [payload({ date: { kind: 'NUMBER', value: '-1' } }), 'INVALID_DATE_SERIAL', 'date'],
    [payload({ expense_amount: { kind: 'STRING', value: '123.45' } }), 'INVALID_AMOUNT_CELL', 'expense_amount'],
    [payload({ expense_amount: { kind: 'NUMBER', value: '1.234' } }), 'INVALID_AMOUNT_SCALE', 'expense_amount'],
    [payload({ income_amount: { kind: 'NUMBER', value: '01' } }), 'INVALID_AMOUNT_DECIMAL', 'income_amount'],
    [payload({ description: { kind: 'NUMBER', value: '1' } }), 'INVALID_TEXT_CELL', 'description'],
  ];

  for (const [candidate, code, field] of malformed) {
    assert.throws(
      () => projectSourceFinancialRevision(candidate),
      (error) => error instanceof SourceFinancialRevisionProjectionError
        && error.code === code
        && error.field === field,
      `${code}:${field}`,
    );
  }
});

test('projection is deterministic for the same canonical payload', () => {
  const candidate = payload({
    description: { kind: 'STRING', value: '' },
    note: { kind: 'STRING', value: '' },
  });
  assert.deepEqual(projectSourceFinancialRevision(candidate), projectSourceFinancialRevision(candidate));
});
