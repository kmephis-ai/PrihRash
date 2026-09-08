import assert from 'node:assert/strict';
import test from 'node:test';
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

test('surfaces coarse and void quality explicitly', () => {
  const view = toOperationPresentation({ ...base, status: 'VOIDED', recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: '2020-04-01' });
  assert.deepEqual(view.quality, ['Аннулировано', 'Исторический агрегат', 'Точность даты: месяц']);
  assert.equal(view.dateLabel, '2020-04-01');
});

test('surfaces unknown source quality explicitly', () => {
  const view = toOperationPresentation({ ...base, recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' });
  assert.deepEqual(view.quality, ['Неизвестная детализация', 'Точность даты неизвестна']);
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
