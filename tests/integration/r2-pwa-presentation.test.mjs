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

test('accepts canonical null capturedAt without inventing capture time', () => {
  const view = toOperationPresentation({ ...base, capturedAt: null });
  assert.equal(view.dateLabel, '2026-09-08');
  assert.equal(view.description, 'Покупка');
});

test('surfaces unknown source quality explicitly', () => {
  const view = toOperationPresentation({ ...base, recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' });
  assert.deepEqual(view.quality, ['Неизвестная детализация', 'Точность даты неизвестна']);
});

test('surfaces only proven legacy period ambiguity as Reader quality', () => {
  const ambiguous = toOperationPresentation({
    ...base,
    status: 'VOIDED',
    analyticsState: 'EXCLUDED',
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'MONTH',
    aggregatePeriodMonth: '2024-02-01',
    periodAssignmentQuality: 'LEGACY_AMBIGUOUS',
  });
  assert.deepEqual(ambiguous.quality, [
    'Аннулировано',
    'Не учитывать в аналитике',
    'Исторический агрегат',
    'Точность даты: месяц',
    'Расчётный период неоднозначен',
  ]);
  for (const markup of [operationCardsMarkup([ambiguous]), operationTableRowsMarkup([ambiguous])]) {
    assert.match(markup, /Расчётный период неоднозначен/u);
  }

  for (const periodAssignmentQuality of ['UNASSIGNED', 'EXPLICIT', 'DERIVED']) {
    const ordinary = toOperationPresentation({ ...base, periodAssignmentQuality });
    assert.doesNotMatch(ordinary.quality.join(' · '), /Расчётный период/u);
  }
});

test('surfaces canonical analytics exclusion without reinterpreting note', () => {
  const included = toOperationPresentation({ ...base, note: 'Не учитывать' });
  assert.deepEqual(included.quality, []);
  assert.equal(included.note, 'Не учитывать');

  const excluded = toOperationPresentation({ ...base, analyticsState: 'EXCLUDED', note: 'Любой исходный текст' });
  assert.deepEqual(excluded.quality, ['Не учитывать в аналитике']);

  for (const markup of [operationCardsMarkup([excluded]), operationTableRowsMarkup([excluded])]) {
    assert.match(markup, /Не учитывать в аналитике/u);
  }
});

test('surfaces canonical note literally and escapes it in both Reader surfaces', () => {
  const note = 'Заказ <42> & https://example.invalid/orders/42?x=1&y=2';
  const view = toOperationPresentation({ ...base, note });
  assert.equal(view.note, note);

  for (const markup of [operationCardsMarkup([view]), operationTableRowsMarkup([view])]) {
    assert.match(markup, /Примечание:/u);
    assert.match(markup, /Заказ &lt;42&gt; &amp; https:\/\/example\.invalid\/orders\/42\?x=1&amp;y=2/u);
    assert.equal(markup.includes(note), false);
  }

  for (const missing of [null, '']) {
    const withoutNote = toOperationPresentation({ ...base, note: missing });
    assert.equal(withoutNote.note, null);
    for (const markup of [operationCardsMarkup([withoutNote]), operationTableRowsMarkup([withoutNote])]) {
      assert.doesNotMatch(markup, /Примечание:/u);
    }
  }
});

test('labels only proven canonical payer and escapes it in both Reader surfaces', () => {
  const payerLabel = 'Вика <семья> & карта';
  const withPayer = toOperationPresentation({
    ...base,
    paidByMember: { id: 'payer-member', label: payerLabel },
  });
  assert.equal(withPayer.meta, `Карта Visa · Продукты · Плательщик: ${payerLabel}`);

  for (const markup of [operationCardsMarkup([withPayer]), operationTableRowsMarkup([withPayer])]) {
    assert.match(markup, /Плательщик: Вика &lt;семья&gt; &amp; карта/u);
    assert.equal(markup.includes(`Плательщик: ${payerLabel}`), false);
  }

  const withoutPayer = toOperationPresentation({ ...base, paidByMember: null });
  assert.equal(withoutPayer.meta, 'Карта Visa · Продукты');
  for (const markup of [operationCardsMarkup([withoutPayer]), operationTableRowsMarkup([withoutPayer])]) {
    assert.doesNotMatch(markup, /Плательщик:/u);
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

test('surfaces proven transfer flow kind without guessing a subtype', () => {
  const cases = [
    ['OWN_FUNDS_TRANSFER', 'Перевод · Между своими счетами'],
    ['CREDIT_DRAW', 'Перевод · Получение заёмных средств'],
    ['CREDIT_REPAYMENT', 'Перевод · Погашение кредитных средств'],
    [null, 'Перевод'],
  ];

  for (const [flowKind, expected] of cases) {
    const transfer = toOperationPresentation({
      ...base,
      type: 'TRANSFER',
      fromAccount: { id: 'from-account', label: 'Карта Visa' },
      toAccount: { id: 'to-account', label: 'Накопления' },
      category: null,
      flowKind,
    });
    assert.equal(transfer.typeLabel, expected);
    for (const markup of [operationCardsMarkup([transfer]), operationTableRowsMarkup([transfer])]) {
      assert.match(markup, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }
  }
});

test('browser Reader boundary rejects flow kind outside TRANSFER', () => {
  for (const type of ['EXPENSE', 'INCOME']) {
    assert.throws(
      () => toOperationPresentation({ ...base, type, flowKind: 'CREDIT_DRAW' }),
      /INVALID_READER_RESPONSE/u,
    );
  }
});

test('browser Reader boundary rejects non-positive amounts', () => {
  for (const amountMinor of [0, -1]) {
    assert.throws(() => toOperationPresentation({ ...base, amountMinor }), /INVALID_READER_RESPONSE/u);
  }
});

test('browser Reader boundary enforces canonical account and category topology', () => {
  for (const invalidExpense of [
    { fromAccount: null },
    { toAccount: { id: 'unexpected-to', label: 'Неожиданный счёт' } },
    { category: null },
  ]) {
    assert.throws(() => toOperationPresentation({ ...base, ...invalidExpense }), /INVALID_READER_RESPONSE/u);
  }

  const income = {
    ...base,
    type: 'INCOME',
    fromAccount: null,
    toAccount: { id: 'income-account', label: 'Основной счёт' },
    category: { id: 'income-category', label: 'Зарплата' },
  };
  assert.doesNotThrow(() => toOperationPresentation(income));
  for (const invalidIncome of [
    { fromAccount: { id: 'unexpected-from', label: 'Неожиданный счёт' } },
    { toAccount: null },
    { category: null },
  ]) {
    assert.throws(() => toOperationPresentation({ ...income, ...invalidIncome }), /INVALID_READER_RESPONSE/u);
  }

  const transfer = {
    ...base,
    type: 'TRANSFER',
    fromAccount: { id: 'from-account', label: 'Карта Visa' },
    toAccount: { id: 'to-account', label: 'Накопления' },
    category: null,
  };
  assert.doesNotThrow(() => toOperationPresentation(transfer));
  for (const invalidTransfer of [
    { fromAccount: null },
    { toAccount: null },
    { toAccount: { id: 'from-account', label: 'Тот же счёт' } },
    { category: { id: 'unexpected-category', label: 'Неожиданная категория' } },
  ]) {
    assert.throws(() => toOperationPresentation({ ...transfer, ...invalidTransfer }), /INVALID_READER_RESPONSE/u);
  }
});

test('browser Reader boundary enforces canonical aggregate granularity shape', () => {
  assert.throws(
    () => toOperationPresentation({ ...base, recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: null }),
    /INVALID_READER_RESPONSE/u,
  );
  assert.throws(
    () => toOperationPresentation({ ...base, recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'DAY', aggregatePeriodMonth: '2024-02-01' }),
    /INVALID_READER_RESPONSE/u,
  );
  for (const recordGranularity of ['TRANSACTION', 'UNKNOWN']) {
    assert.throws(
      () => toOperationPresentation({ ...base, recordGranularity, aggregatePeriodMonth: '2024-02-01' }),
      /INVALID_READER_RESPONSE/u,
    );
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
