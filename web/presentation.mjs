const TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER']);
const GRANULARITIES = new Set(['TRANSACTION', 'PERIOD_AGGREGATE', 'UNKNOWN']);
const DATE_PRECISIONS = new Set(['DAY', 'MONTH', 'UNKNOWN']);
const STATUSES = new Set(['POSTED', 'VOIDED']);

export function formatRubMinor(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('INVALID_AMOUNT');
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amountMinor / 100);
}

export function toOperationPresentation(item) {
  if (!item || typeof item !== 'object') throw new Error('INVALID_OPERATION');
  if (!TYPES.has(item.type) || !STATUSES.has(item.status)) throw new Error('INVALID_OPERATION');
  if (!GRANULARITIES.has(item.recordGranularity) || !DATE_PRECISIONS.has(item.datePrecision)) {
    throw new Error('INVALID_OPERATION');
  }
  if (item.currency !== 'RUB' || typeof item.occurredOn !== 'string') throw new Error('INVALID_OPERATION');

  const quality = [];
  if (item.status === 'VOIDED') quality.push('Аннулировано');
  if (item.recordGranularity === 'PERIOD_AGGREGATE') quality.push('Исторический агрегат');
  if (item.recordGranularity === 'UNKNOWN') quality.push('Неизвестная детализация');
  if (item.datePrecision === 'MONTH') quality.push('Точность даты: месяц');
  if (item.datePrecision === 'UNKNOWN') quality.push('Точность даты неизвестна');

  const account = item.type === 'INCOME' ? item.toAccount?.label : item.fromAccount?.label;
  return Object.freeze({
    id: item.id,
    typeLabel: item.type === 'EXPENSE' ? 'Расход' : item.type === 'INCOME' ? 'Доход' : 'Перевод',
    amountLabel: formatRubMinor(item.amountMinor),
    dateLabel: item.datePrecision === 'DAY' ? item.occurredOn : item.aggregatePeriodMonth ?? item.occurredOn,
    description: item.description ?? item.category?.label ?? 'Без описания',
    meta: [account, item.category?.label, item.paidByMember?.label].filter(Boolean).join(' · '),
    quality,
  });
}

export function parseReaderResponse(value) {
  if (!value || typeof value !== 'object' || value.apiVersion !== 1 || !Array.isArray(value.items)) {
    throw new Error('INVALID_READER_RESPONSE');
  }
  if (!Number.isSafeInteger(value.pageSize) || value.pageSize < 0) throw new Error('INVALID_READER_RESPONSE');
  if (!(value.nextCursor === null || typeof value.nextCursor === 'string')) throw new Error('INVALID_READER_RESPONSE');
  return Object.freeze(value.items.map(toOperationPresentation));
}
