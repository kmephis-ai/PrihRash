const TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER']);
const STATUSES = new Set(['POSTED', 'VOIDED']);

function optionalEnum(value, allowed) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error('INVALID_READER_FILTERS');
  return value;
}

export function normalizeReaderFilters(value = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_READER_FILTERS');
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'type' && key !== 'status')) throw new Error('INVALID_READER_FILTERS');
  return {
    type: optionalEnum(value.type, TYPES),
    status: optionalEnum(value.status, STATUSES),
  };
}

export function hasActiveReaderFilters(value = {}) {
  const filters = normalizeReaderFilters(value);
  return filters.type !== null || filters.status !== null;
}

export function buildRecentOperationsUrl(value = {}) {
  const filters = normalizeReaderFilters(value);
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (filters.type !== null) params.set('type', filters.type);
  if (filters.status !== null) params.set('status', filters.status);
  return `/api/v1/operations/recent?${params.toString()}`;
}
