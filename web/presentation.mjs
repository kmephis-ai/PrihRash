const TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER']);
const GRANULARITIES = new Set(['TRANSACTION', 'PERIOD_AGGREGATE', 'UNKNOWN']);
const DATE_PRECISIONS = new Set(['DAY', 'MONTH', 'UNKNOWN']);
const PERIOD_QUALITIES = new Set(['EXPLICIT', 'DERIVED', 'LEGACY_AMBIGUOUS', 'UNASSIGNED']);
const STATUSES = new Set(['POSTED', 'VOIDED']);
const ANALYTICS_STATES = new Set(['INCLUDED', 'EXCLUDED']);
const FLOW_KINDS = new Set(['OWN_FUNDS_TRANSFER', 'CREDIT_DRAW', 'CREDIT_REPAYMENT']);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function invalidReaderResponse() {
  throw new Error('INVALID_READER_RESPONSE');
}

function requireCanonicalString(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) invalidReaderResponse();
  return value;
}

function nullableCanonicalString(value) {
  return value === null ? null : requireCanonicalString(value);
}

function requireCanonicalUuid(value) {
  const parsed = requireCanonicalString(value);
  if (!UUID_PATTERN.test(parsed)) invalidReaderResponse();
  return parsed;
}

function nullableCanonicalUuid(value) {
  return value === null ? null : requireCanonicalUuid(value);
}

function requireCanonicalDate(value) {
  const parsed = requireCanonicalString(value);
  if (!DATE_PATTERN.test(parsed) || !Number.isFinite(Date.parse(`${parsed}T00:00:00.000Z`))) invalidReaderResponse();
  return parsed;
}

function nullableCanonicalDate(value) {
  return value === null ? null : requireCanonicalDate(value);
}

function nullableCanonicalTimestamp(value) {
  if (value === null) return null;
  const parsed = requireCanonicalString(value);
  if (!Number.isFinite(Date.parse(parsed))) invalidReaderResponse();
  return parsed;
}

function sanitizeEntityRef(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidReaderResponse();
  return Object.freeze({ id: requireCanonicalUuid(value.id), label: requireCanonicalString(value.label) });
}


function validateReaderOperationInvariants(item) {
  if (item.recordGranularity === 'PERIOD_AGGREGATE') {
    if (item.aggregatePeriodMonth === null || item.datePrecision !== 'MONTH') invalidReaderResponse();
  } else if (item.aggregatePeriodMonth !== null) {
    invalidReaderResponse();
  }

  if (item.type === 'EXPENSE') {
    if (item.fromAccount === null || item.toAccount !== null || item.category === null) invalidReaderResponse();
    return;
  }
  if (item.type === 'INCOME') {
    if (item.fromAccount !== null || item.toAccount === null || item.category === null) invalidReaderResponse();
    return;
  }
  if (
    item.fromAccount === null
    || item.toAccount === null
    || item.fromAccount.id === item.toAccount.id
    || item.category !== null
  ) invalidReaderResponse();
}

function sanitizeReaderOperation(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) invalidReaderResponse();
  if (!TYPES.has(item.type) || !STATUSES.has(item.status)) invalidReaderResponse();
  if (!GRANULARITIES.has(item.recordGranularity) || !DATE_PRECISIONS.has(item.datePrecision)) invalidReaderResponse();
  if (!PERIOD_QUALITIES.has(item.periodAssignmentQuality) || !ANALYTICS_STATES.has(item.analyticsState)) invalidReaderResponse();
  if (!(item.flowKind === null || FLOW_KINDS.has(item.flowKind))) invalidReaderResponse();
  if (item.type !== 'TRANSFER' && item.flowKind !== null) invalidReaderResponse();
  if (item.currency !== 'RUB') invalidReaderResponse();
  if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0) invalidReaderResponse();
  if (!Number.isSafeInteger(item.version) || item.version < 1) invalidReaderResponse();

  const safe = {
    id: requireCanonicalUuid(item.id),
    type: item.type,
    occurredOn: requireCanonicalDate(item.occurredOn),
    capturedAt: nullableCanonicalTimestamp(item.capturedAt),
    recordGranularity: item.recordGranularity,
    datePrecision: item.datePrecision,
    aggregatePeriodMonth: nullableCanonicalDate(item.aggregatePeriodMonth),
    financialPeriodId: nullableCanonicalUuid(item.financialPeriodId),
    periodAssignmentQuality: item.periodAssignmentQuality,
    amountMinor: item.amountMinor,
    currency: 'RUB',
    fromAccount: sanitizeEntityRef(item.fromAccount),
    toAccount: sanitizeEntityRef(item.toAccount),
    category: sanitizeEntityRef(item.category),
    paidByMember: sanitizeEntityRef(item.paidByMember),
    description: nullableCanonicalString(item.description),
    note: nullableCanonicalString(item.note),
    status: item.status,
    analyticsState: item.analyticsState,
    flowKind: item.flowKind,
    version: item.version,
  };
  validateReaderOperationInvariants(safe);
  return Object.freeze(safe);
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

function transferTypeLabel(flowKind) {
  if (flowKind === 'OWN_FUNDS_TRANSFER') return 'Перевод · Между своими счетами';
  if (flowKind === 'CREDIT_DRAW') return 'Перевод · Получение заёмных средств';
  if (flowKind === 'CREDIT_REPAYMENT') return 'Перевод · Погашение кредитных средств';
  return 'Перевод';
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
  const payer = safe.paidByMember === null ? '' : `Плательщик: ${safe.paidByMember.label}`;
  const note = safe.note;
  return Object.freeze({
    id: safe.id,
    typeLabel: safe.type === 'EXPENSE' ? 'Расход' : safe.type === 'INCOME' ? 'Доход' : transferTypeLabel(safe.flowKind),
    amountLabel: formatRubMinor(safe.amountMinor),
    dateLabel: safe.datePrecision === 'DAY'
      ? safe.occurredOn
      : safe.datePrecision === 'MONTH'
        ? safe.aggregatePeriodMonth?.slice(0, 7) ?? safe.occurredOn
        : safe.aggregatePeriodMonth ?? safe.occurredOn,
    description: safe.description ?? safe.category?.label ?? 'Без описания',
    meta: [account, safe.category?.label, payer].filter(Boolean).join(' · '),
    note,
    quality,
  });
}

export function parseReaderResponse(value) {
  const safe = sanitizeReaderResponse(value);
  return Object.freeze(safe.items.map(toOperationPresentation));
}
