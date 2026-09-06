import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLegacyPeriodCloseRows,
  recognizeLegacyPeriodCloseMarker,
} from '../../dist/classification/legacyPeriodClose.js';

function marker(snapshotOrdinal, description, overrides = {}) {
  return {
    snapshotOrdinal,
    sourceDay: '2026-09-06',
    operationType: 'Расход',
    expenseAccount: 'Карта Visa',
    expenseAmountMinor: 0,
    description,
    ...overrides,
  };
}

function classifications(rows) {
  return classifyLegacyPeriodCloseRows(rows).map((item) => item.classification);
}

test('explicit physical spelling variants are recognized without fuzzy matching', () => {
  assert.equal(recognizeLegacyPeriodCloseMarker('Кредитки'), 'CREDIT');
  assert.equal(recognizeLegacyPeriodCloseMarker('Кредитка'), 'CREDIT');
  assert.equal(recognizeLegacyPeriodCloseMarker('Кредитки 2'), 'CREDIT');
  assert.equal(recognizeLegacyPeriodCloseMarker('Вика Красное'), 'VIKA');
  assert.equal(recognizeLegacyPeriodCloseMarker('Вика красное'), 'VIKA');
  assert.equal(recognizeLegacyPeriodCloseMarker('Текущий баланс счета'), 'BALANCE');
  assert.equal(recognizeLegacyPeriodCloseMarker('кредитки'), null);
});

test('complete marker cluster is LEGACY_PERIOD_CLOSE', () => {
  const rows = [
    marker(100, 'Плюсовые позиции'),
    marker(101, 'Кредитки'),
    marker(102, 'Вика Красное'),
    marker(103, 'Минусовые позиции'),
    marker(104, 'Возврат займа'),
    marker(105, 'Текущий баланс'),
  ];
  assert.deepEqual(classifications(rows), Array(6).fill('LEGACY_PERIOD_CLOSE'));
});

test('historical cluster without loan marker still qualifies', () => {
  const rows = [
    marker(10, 'Плюсовые позиции'),
    marker(11, 'Кредитки'),
    marker(12, 'Вика Красное'),
    marker(13, 'Минусовые позиции'),
    marker(14, 'Текущий баланс'),
  ];
  assert.deepEqual(classifications(rows), Array(5).fill('LEGACY_PERIOD_CLOSE'));
});

test('observed partial cluster may omit CREDIT when POSITIVE is present', () => {
  const rows = [
    marker(10, 'Плюсовые позиции'),
    marker(11, 'Вика Красное'),
    marker(12, 'Минусовые позиции'),
    marker(13, 'Текущий баланс'),
  ];
  assert.deepEqual(classifications(rows), Array(4).fill('LEGACY_PERIOD_CLOSE'));
});

test('observed partial cluster may omit POSITIVE when CREDIT is present', () => {
  const rows = [
    marker(10, 'Кредитка'),
    marker(11, 'Вика Красное'),
    marker(12, 'Минусовые позиции'),
    marker(13, 'Текущий баланс счета'),
  ];
  assert.deepEqual(classifications(rows), Array(4).fill('LEGACY_PERIOD_CLOSE'));
});

test('isolated known marker fails closed as AMBIGUOUS', () => {
  assert.deepEqual(classifications([marker(10, 'Кредитки')]), ['AMBIGUOUS']);
});

test('description alone never promotes a positive financial row', () => {
  assert.deepEqual(classifications([
    marker(10, 'Кредитки', { expenseAmountMinor: 10000 }),
  ]), ['NOT_APPLICABLE']);
});

test('wrong operation/account shape fails closed as AMBIGUOUS', () => {
  const rows = [
    marker(10, 'Плюсовые позиции', { operationType: 'Доход' }),
    marker(11, 'Минусовые позиции', { expenseAccount: 'Наличка' }),
  ];
  assert.deepEqual(classifications(rows), ['AMBIGUOUS', 'AMBIGUOUS']);
});

test('one unrelated source row may be between exact marker rows but is never promoted', () => {
  const rows = [
    marker(10, 'Плюсовые позиции'),
    {
      snapshotOrdinal: 11,
      sourceDay: '2026-09-06',
      operationType: 'Расход',
      expenseAccount: 'Карта Visa',
      expenseAmountMinor: 0,
      description: 'Synthetic unrelated service row',
    },
    marker(12, 'Вика Красное'),
    marker(13, 'Минусовые позиции'),
    marker(14, 'Текущий баланс'),
  ];
  assert.deepEqual(classifications(rows), [
    'LEGACY_PERIOD_CLOSE',
    'NOT_APPLICABLE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
  ]);
});

test('large sequence gap splits same-day markers and prevents guessed cluster', () => {
  const rows = [
    marker(10, 'Плюсовые позиции'),
    marker(11, 'Вика Красное'),
    marker(20, 'Минусовые позиции'),
    marker(21, 'Текущий баланс'),
  ];
  assert.deepEqual(classifications(rows), Array(4).fill('AMBIGUOUS'));
});

test('markers on different source days never form one close cluster', () => {
  const rows = [
    marker(10, 'Плюсовые позиции'),
    marker(11, 'Вика Красное'),
    marker(12, 'Минусовые позиции', { sourceDay: '2026-09-07' }),
    marker(13, 'Текущий баланс', { sourceDay: '2026-09-07' }),
  ];
  assert.deepEqual(classifications(rows), Array(4).fill('AMBIGUOUS'));
});
