const TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER']);
const STATUSES = new Set(['POSTED', 'VOIDED']);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_CURSOR_LENGTH = 4096;

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

export function normalizeReaderCursor(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_CURSOR_LENGTH
    || value !== value.trim()
    || !CURSOR_PATTERN.test(value)
  ) {
    throw new Error('INVALID_READER_CURSOR');
  }
  return value;
}

export function hasActiveReaderFilters(value = {}) {
  const filters = normalizeReaderFilters(value);
  return filters.type !== null || filters.status !== null;
}

export function buildRecentOperationsUrl(value = {}, cursor = null) {
  const filters = normalizeReaderFilters(value);
  const safeCursor = normalizeReaderCursor(cursor);
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (filters.type !== null) params.set('type', filters.type);
  if (filters.status !== null) params.set('status', filters.status);
  if (safeCursor !== null) params.set('cursor', safeCursor);
  return `/api/v1/operations/recent?${params.toString()}`;
}
