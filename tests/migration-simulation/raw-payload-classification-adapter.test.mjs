import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMeaningfulSourceRow } from '../../dist/classification/sourceRow.js';
import {
  decodeRawPayloadForSourceClassification,
  toLegacyPeriodCloseSourceRow,
  toSourceRowClassificationInput,
} from '../../dist/migration/rawPayloadClassificationAdapter.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function payload(overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Category'),
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

test('decodes classification fields without locale coercion', () => {
  const result = decodeRawPayloadForSourceClassification(payload());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    operationType: 'Расход',
    sourceDate: '2024-01-01',
    sourceDatePresent: true,
    expenseAccount: 'Карта Visa',
    expenseCategory: 'Synthetic Category',
    expenseAmountMinor: 12345,
    expenseAmountPresent: true,
    incomeAccount: null,
    incomeCategory: null,
    incomeAmountMinor: null,
    incomeAmountPresent: false,
    vikaFlag: null,
    description: 'Synthetic description',
    note: null,
  });
});

test('inactive string amount preserves physical presence but is never parsed as money', () => {
  const decoded = decodeRawPayloadForSourceClassification(payload({ income_amount: S('legacy inactive text') }));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.incomeAmountMinor, null);
  assert.equal(decoded.value.incomeAmountPresent, true);

  const classification = classifyMeaningfulSourceRow(
    toSourceRowClassificationInput(decoded.value, 'NOT_APPLICABLE'),
  );
  assert.equal(classification, 'FINANCIAL_RECORD');
});

test('active string amount remains INVALID through existing source classifier', () => {
  const decoded = decodeRawPayloadForSourceClassification(payload({ expense_amount: S('123.45') }));
  assert.equal(decoded.ok, true);
  const classification = classifyMeaningfulSourceRow(
    toSourceRowClassificationInput(decoded.value, 'NOT_APPLICABLE'),
  );
  assert.equal(classification, 'INVALID');
});

test('zero expense maps exactly to legacy close classifier input', () => {
  const decoded = decodeRawPayloadForSourceClassification(payload({
    expense_amount: N('0'),
    description: S('Текущий баланс'),
  }));
  assert.equal(decoded.ok, true);
  assert.deepEqual(toLegacyPeriodCloseSourceRow(17, decoded.value), {
    snapshotOrdinal: 17,
    sourceDay: '2024-01-01',
    operationType: 'Расход',
    expenseAccount: 'Карта Visa',
    expenseAmountMinor: 0,
    description: 'Текущий баланс',
  });
});

test('presence hints prevent physically nonblank amount from becoming a note-only row', () => {
  const classification = classifyMeaningfulSourceRow({
    operationType: null,
    sourceDate: null,
    sourceDatePresent: false,
    expenseAccount: null,
    expenseCategory: null,
    expenseAmountMinor: null,
    expenseAmountPresent: true,
    incomeAccount: null,
    incomeCategory: null,
    incomeAmountMinor: null,
    incomeAmountPresent: false,
    vikaFlag: null,
    description: null,
    note: 'Synthetic note',
    legacyPeriodCloseClassification: 'NOT_APPLICABLE',
  });
  assert.equal(classification, 'AMBIGUOUS');
});

test('typed text/date mismatches fail closed before source classification', () => {
  for (const [overrides, errorCode, field] of [
    [{ operation_type: N('1') }, 'INVALID_TEXT_CELL', 'operation_type'],
    [{ date: S('2024-01-01') }, 'INVALID_DATE_CELL', 'date'],
    [{ expense_amount: N('1.001') }, 'INVALID_AMOUNT_SCALE', 'expense_amount'],
  ]) {
    const result = decodeRawPayloadForSourceClassification(payload(overrides));
    assert.deepEqual(result, { ok: false, errorCode, field });
  }
});
