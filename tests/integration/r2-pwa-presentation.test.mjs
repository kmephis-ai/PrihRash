import assert from 'node:assert/strict';
import test from 'node:test';
import { operationCardsMarkup, operationTableRowsMarkup } from '../../web/operation-markup.mjs';
import { formatRubMinor, parseReaderResponse, toOperationPresentation } from '../../web/presentation.mjs';

const base = {
  id: '00000000-0000-0000-0000-000000000001', type: 'EXPENSE', occurredOn: '2026-09-08', capturedAt: '2026-09-08T08:00:00.000Z',
  recordGranularity: 'TRANSACTION', datePrecision: 'DAY', aggregatePeriodMonth: null, financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED', amountMinor: 12345, currency: 'RUB', fromAccount: { id: 'a', label: 'Карта Visa' },
  toAccount: null, category: { id: 'c', label: 'Продукты' }, paidByMember: null, description: 'Покупка', note: null,
  status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null, version: 1,
};

test('formats integer minor units as RUB in UI', () => {
  assert.match(formatRubMinor(12345), /123,45[\s\u00a0]*₽/u);
});

test('surfaces month precision without inventing an exact first day', () => {
  const view = toOperationPresentation({ ...base, status: 'VOIDED', recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: '2020-04-01' });
  assert.deepEqual(view.quality, ['Аннулировано', 'Исторический агрегат', 'Точность даты: месяц']);
  assert.equal(view.dateLabel, '2020-04');

  for (const markup of [operationCardsMarkup([view]), operationTableRowsMarkup([view])]) {
    assert.match(markup, /2020-04/u);
    assert.doesNotMatch(markup, /2020-04-01/u);
  }
});

test('keeps proven day precision unchanged', () => {
  const view = toOperationPresentation(base);
  assert.equal(view.dateLabel, '2026-09-08');
});

test('surfaces unknown source quality explicitly', () => {
  const view = toOperationPresentation({ ...base, recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' });
  assert.deepEqual(view.quality, ['Неизвестная детализация', 'Точность даты неизвестна']);
});

test('surfaces canonical analytics exclusion without reinterpreting note', () => {
  const included = toOperationPresentation({ ...base, note: 'Не учитывать' });
  assert.deepEqual(included.quality, []);

  const excluded = toOperationPresentation({ ...base, analyticsState: 'EXCLUDED', note: 'Любой исходный текст' });
  assert.deepEqual(excluded.quality, ['Не учитывать в аналитике']);

  for (const markup of [operationCardsMarkup([excluded]), operationTableRowsMarkup([excluded])]) {
    assert.match(markup, /Не учитывать в аналитике/u);
  }
});

test('maps directional account context without hiding transfer destination', () => {
  const expense = toOperationPresentation(base);
  assert.equal(expense.meta, 'Карта Visa · Продукты');

  const income = toOperationPresentation({
    ...base,
    type: 'INCOME',
    fromAccount: null,
    toAccount: { id: 'income-account', label: 'Основной счёт' },
    category: { id: 'income-category', label: 'Зарплата' },
  });
  assert.equal(income.meta, 'Основной счёт · Зарплата');

  const transfer = toOperationPresentation({
    ...base,
    type: 'TRANSFER',
    fromAccount: { id: 'from-account', label: 'Карта <Visa>' },
    toAccount: { id: 'to-account', label: 'Накопления & цели' },
    category: null,
    flowKind: 'OWN_FUNDS_TRANSFER',
  });
  assert.equal(transfer.meta, 'Карта <Visa> → Накопления & цели');

  for (const markup of [operationCardsMarkup([transfer]), operationTableRowsMarkup([transfer])]) {
    assert.match(markup, /Карта &lt;Visa&gt; → Накопления &amp; цели/u);
    assert.doesNotMatch(markup, /Карта <Visa> → Накопления & цели/u);
  }
});

test('reader response parser fails closed on malformed contract', () => {
  assert.throws(() => parseReaderResponse({ apiVersion: 2, items: [] }), /INVALID_READER_RESPONSE/);
  assert.throws(() => parseReaderResponse({ apiVersion: 1, items: [{ ...base, amountMinor: 1.5 }], pageSize: 1, nextCursor: null }), /INVALID_READER_RESPONSE/);
  assert.throws(() => parseReaderResponse({ apiVersion: 1, items: [base], pageSize: 1, nextCursor: '' }), /INVALID_READER_RESPONSE/);
  assert.throws(() => parseReaderResponse({ apiVersion: 1, items: [base], pageSize: 1, nextCursor: '***' }), /INVALID_READER_RESPONSE/);
});

test('reader response maps only valid API v1 items', () => {
  const result = parseReaderResponse({ apiVersion: 1, items: [base], pageSize: 1, nextCursor: null });
  assert.equal(result.length, 1);
  assert.equal(result[0].description, 'Покупка');
});
