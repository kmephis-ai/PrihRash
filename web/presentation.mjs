const TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER']);
const GRANULARITIES = new Set(['TRANSACTION', 'PERIOD_AGGREGATE', 'UNKNOWN']);
const DATE_PRECISIONS = new Set(['DAY', 'MONTH', 'UNKNOWN']);
const PERIOD_QUALITIES = new Set(['EXPLICIT', 'DERIVED', 'LEGACY_AMBIGUOUS', 'UNASSIGNED']);
const STATUSES = new Set(['POSTED', 'VOIDED']);
const ANALYTICS_STATES = new Set(['INCLUDED', 'EXCLUDED']);
const FLOW_KINDS = new Set(['OWN_FUNDS_TRANSFER', 'CREDIT_DRAW', 'CREDIT_REPAYMENT']);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;

function invalidReaderResponse() {
  throw new Error('INVALID_READER_RESPONSE');
}

function requireString(value) {
  if (typeof value !== 'string') invalidReaderResponse();
  return value;
}

function nullableString(value) {
  if (!(value === null || typeof value === 'string')) invalidReaderResponse();
  return value;
}

function sanitizeEntityRef(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidReaderResponse();
  return Object.freeze({ id: requireString(value.id), label: requireString(value.label) });
}

function sanitizeReaderOperation(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) invalidReaderResponse();
  if (!TYPES.has(item.type) || !STATUSES.has(item.status)) invalidReaderResponse();
  if (!GRANULARITIES.has(item.recordGranularity) || !DATE_PRECISIONS.has(item.datePrecision)) invalidReaderResponse();
  if (!PERIOD_QUALITIES.has(item.periodAssignmentQuality) || !ANALYTICS_STATES.has(item.analyticsState)) invalidReaderResponse();
  if (!(item.flowKind === null || FLOW_KINDS.has(item.flowKind))) invalidReaderResponse();
  if (item.currency !== 'RUB') invalidReaderResponse();
  if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0) invalidReaderResponse();
  if (!Number.isSafeInteger(item.version) || item.version < 1) invalidReaderResponse();

  return Object.freeze({
    id: requireString(item.id),
    type: item.type,
    occurredOn: requireString(item.occurredOn),
    capturedAt: requireString(item.capturedAt),
    recordGranularity: item.recordGranularity,
    datePrecision: item.datePrecision,
    aggregatePeriodMonth: nullableString(item.aggregatePeriodMonth),
    financialPeriodId: nullableString(item.financialPeriodId),
    periodAssignmentQuality: item.periodAssignmentQuality,
    amountMinor: item.amountMinor,
    currency: 'RUB',
    fromAccount: sanitizeEntityRef(item.fromAccount),
    toAccount: sanitizeEntityRef(item.toAccount),
    category: sanitizeEntityRef(item.category),
    paidByMember: sanitizeEntityRef(item.paidByMember),
    description: nullableString(item.description),
    note: nullableString(item.note),
    status: item.status,
    analyticsState: item.analyticsState,
    flowKind: item.flowKind,
    version: item.version,
  });
}

export function sanitizeReaderResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.apiVersion !== 1 || !Array.isArray(value.items)) {
    invalidReaderResponse();
  }
  if (!Number.isSafeInteger(value.pageSize) || value.pageSize < 0) invalidReaderResponse();
  if (!(
    value.nextCursor === null
    || (
      typeof value.nextCursor === 'string'
      && value.nextCursor.length > 0
      && value.nextCursor.length <= 4096
      && value.nextCursor === value.nextCursor.trim()
      && CURSOR_PATTERN.test(value.nextCursor)
    )
  )) invalidReaderResponse();

  return Object.freeze({
    apiVersion: 1,
    items: Object.freeze(value.items.map(sanitizeReaderOperation)),
    pageSize: value.pageSize,
    nextCursor: value.nextCursor,
  });
}

export function formatRubMinor(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('INVALID_AMOUNT');
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amountMinor / 100);
}

function accountContextLabel(item) {
  if (item.type === 'EXPENSE') return item.fromAccount?.label ?? '';
  if (item.type === 'INCOME') return item.toAccount?.label ?? '';

  const from = item.fromAccount?.label;
  const to = item.toAccount?.label;
  return from && to ? `${from} → ${to}` : '';
}

export function toOperationPresentation(item) {
  const safe = sanitizeReaderOperation(item);
  const quality = [];
  if (safe.status === 'VOIDED') quality.push('Аннулировано');
  if (safe.analyticsState === 'EXCLUDED') quality.push('Не учитывать в аналитике');
  if (safe.recordGranularity === 'PERIOD_AGGREGATE') quality.push('Исторический агрегат');
  if (safe.recordGranularity === 'UNKNOWN') quality.push('Неизвестная детализация');
  if (safe.datePrecision === 'MONTH') quality.push('Точность даты: месяц');
  if (safe.datePrecision === 'UNKNOWN') quality.push('Точность даты неизвестна');
  if (safe.periodAssignmentQuality === 'LEGACY_AMBIGUOUS') quality.push('Расчётный период неоднозначен');

  const account = accountContextLabel(safe);
  const note = safe.note === '' ? null : safe.note;
  return Object.freeze({
    id: safe.id,
    typeLabel: safe.type === 'EXPENSE' ? 'Расход' : safe.type === 'INCOME' ? 'Доход' : 'Перевод',
    amountLabel: formatRubMinor(safe.amountMinor),
    dateLabel: safe.datePrecision === 'DAY'
      ? safe.occurredOn
      : safe.datePrecision === 'MONTH'
        ? safe.aggregatePeriodMonth?.slice(0, 7) ?? safe.occurredOn
        : safe.aggregatePeriodMonth ?? safe.occurredOn,
    description: safe.description ?? safe.category?.label ?? 'Без описания',
    meta: [account, safe.category?.label, safe.paidByMember?.label].filter(Boolean).join(' · '),
    note,
    quality,
  });
}

export function parseReaderResponse(value) {
  const safe = sanitizeReaderResponse(value);
  return Object.freeze(safe.items.map(toOperationPresentation));
}
