const TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER']);
const STATUSES = new Set(['POSTED', 'VOIDED']);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_CURSOR_LENGTH = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function optionalUuid(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error('INVALID_READER_FILTERS');
  return value.toLowerCase();
}

function optionalEnum(value, allowed) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error('INVALID_READER_FILTERS');
  return value;
}

export function normalizeReaderFilters(value = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_READER_FILTERS');
  const keys = Object.keys(value);
  if (keys.some((key) => !['type', 'status', 'accountId', 'categoryId'].includes(key))) throw new Error('INVALID_READER_FILTERS');
  const filters = {
    type: optionalEnum(value.type, TYPES),
    status: optionalEnum(value.status, STATUSES),
  };
  const accountId = optionalUuid(value.accountId);
  const categoryId = optionalUuid(value.categoryId);
  if (accountId !== null) filters.accountId = accountId;
  if (categoryId !== null) filters.categoryId = categoryId;
  return filters;
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
  return filters.type !== null || filters.status !== null || filters.accountId !== undefined || filters.categoryId !== undefined;
}

export function buildRecentOperationsUrl(value = {}, cursor = null) {
  const filters = normalizeReaderFilters(value);
  const safeCursor = normalizeReaderCursor(cursor);
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (filters.type !== null) params.set('type', filters.type);
  if (filters.status !== null) params.set('status', filters.status);
  if (filters.accountId !== undefined) params.set('accountId', filters.accountId);
  if (filters.categoryId !== undefined) params.set('categoryId', filters.categoryId);
  if (safeCursor !== null) params.set('cursor', safeCursor);
  return `/api/v1/operations/recent?${params.toString()}`;
}


const FILTER_OPTION_CATEGORY_KINDS = new Set(['EXPENSE', 'INCOME']);

function invalidFilterOptions() {
  throw new Error('INVALID_READER_FILTER_OPTIONS');
}

function safeFilterOptionLabel(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) invalidFilterOptions();
  return value;
}

function safeFilterOptionUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalidFilterOptions();
  return value.toLowerCase();
}

function safeAccountOption(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidFilterOptions();
  if (Object.keys(value).sort().join(',') !== 'id,label') invalidFilterOptions();
  return Object.freeze({ id: safeFilterOptionUuid(value.id), label: safeFilterOptionLabel(value.label) });
}

function safeCategoryOption(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidFilterOptions();
  if (Object.keys(value).sort().join(',') !== 'id,kind,label' || !FILTER_OPTION_CATEGORY_KINDS.has(value.kind)) invalidFilterOptions();
  return Object.freeze({ id: safeFilterOptionUuid(value.id), label: safeFilterOptionLabel(value.label), kind: value.kind });
}

export function sanitizeReaderFilterOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidFilterOptions();
  if (Object.keys(value).sort().join(',') !== 'accounts,apiVersion,categories' || value.apiVersion !== 1) invalidFilterOptions();
  if (!Array.isArray(value.accounts) || !Array.isArray(value.categories)) invalidFilterOptions();
  const accounts = value.accounts.map(safeAccountOption);
  const categories = value.categories.map(safeCategoryOption);
  const accountIds = new Set();
  const accountLabels = new Set();
  for (const option of accounts) {
    if (accountIds.has(option.id) || accountLabels.has(option.label)) invalidFilterOptions();
    accountIds.add(option.id);
    accountLabels.add(option.label);
  }
  const categoryIds = new Set();
  const categoryKeys = new Set();
  for (const option of categories) {
    const key = `${option.kind}\u0000${option.label}`;
    if (categoryIds.has(option.id) || categoryKeys.has(key)) invalidFilterOptions();
    categoryIds.add(option.id);
    categoryKeys.add(key);
  }
  return Object.freeze({ apiVersion: 1, accounts: Object.freeze(accounts), categories: Object.freeze(categories) });
}

export function categoryOptionLabel(option) {
  const safe = safeCategoryOption(option);
  return `${safe.kind === 'EXPENSE' ? 'Расход' : 'Доход'} · ${safe.label}`;
}
