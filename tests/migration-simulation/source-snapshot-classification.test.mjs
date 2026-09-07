import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SourceSnapshotClassificationStructuralError,
  classifySourceSnapshot,
} from '../../dist/migration/sourceSnapshotClassification.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

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

function closeMarker(description) {
  return expense('0', { expense_category: null, description: S(description) });
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

test('classifies full snapshot context without refs, granularity or SourceRecord identity', () => {
  const rows = [
    { sourceOrdinal: 10, rawPayload: closeMarker('Плюсовые позиции') },
    { sourceOrdinal: 11, rawPayload: closeMarker('Минусовые позиции') },
    { sourceOrdinal: 12, rawPayload: closeMarker('Вика Красное') },
    { sourceOrdinal: 13, rawPayload: closeMarker('Текущий баланс') },
    { sourceOrdinal: 20, rawPayload: expense() },
    { sourceOrdinal: 21, rawPayload: noteOnly() },
    { sourceOrdinal: 22, rawPayload: expense('0', { description: S('Synthetic ordinary zero') }) },
  ];

  const result = classifySourceSnapshot(rows);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.classification), [
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'FINANCIAL_RECORD',
    'NON_FINANCIAL',
    'AMBIGUOUS',
  ]);
  assert.deepEqual(result.counters, {
    rowsSeen: 7,
    financialRecords: 1,
    legacyPeriodClose: 4,
    nonFinancial: 1,
    invalid: 0,
    ambiguous: 1,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.outcomes), true);
  assert.equal(Object.isFrozen(result.counters), true);
});

test('typed decode failure remains explicit INVALID observation evidence', () => {
  const result = classifySourceSnapshot([
    { sourceOrdinal: 1, rawPayload: expense('12.34', { date: S('2024-01-01') }) },
  ]);
  assert.deepEqual(result.outcomes[0], {
    sourceOrdinal: 1,
    classification: 'INVALID',
    legacyPeriodCloseClassification: null,
    decodeErrorCode: 'INVALID_DATE_CELL',
  });
});

for (const [name, rows, code] of [
  ['duplicate ordinal', [
    { sourceOrdinal: 1, rawPayload: expense() },
    { sourceOrdinal: 1, rawPayload: expense() },
  ], 'DUPLICATE_SOURCE_ORDINAL'],
  ['invalid ordinal', [
    { sourceOrdinal: -1, rawPayload: expense() },
  ], 'INVALID_SOURCE_ORDINAL'],
]) {
  test(`classification fails closed for ${name}`, () => {
    assert.throws(
      () => classifySourceSnapshot(rows),
      (error) => error instanceof SourceSnapshotClassificationStructuralError && error.code === code,
    );
  });
}
