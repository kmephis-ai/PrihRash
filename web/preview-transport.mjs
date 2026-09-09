const PAGE_SIZE = 6;
const SECOND_PAGE_CURSOR = 'demoPage_2';

const ACCOUNTS = Object.freeze([
  Object.freeze({ id: '10000000-0000-0000-0000-000000000001', label: 'Основная карта · демо' }),
  Object.freeze({ id: '10000000-0000-0000-0000-000000000002', label: 'Наличные · демо' }),
  Object.freeze({ id: '10000000-0000-0000-0000-000000000003', label: 'Накопления · демо' }),
]);

const CATEGORIES = Object.freeze([
  Object.freeze({ id: '20000000-0000-0000-0000-000000000001', label: 'Продукты · демо', kind: 'EXPENSE' }),
  Object.freeze({ id: '20000000-0000-0000-0000-000000000002', label: 'Транспорт · демо', kind: 'EXPENSE' }),
  Object.freeze({ id: '20000000-0000-0000-0000-000000000003', label: 'Дом · демо', kind: 'EXPENSE' }),
  Object.freeze({ id: '20000000-0000-0000-0000-000000000004', label: 'Зарплата · демо', kind: 'INCOME' }),
]);

const MEMBER = Object.freeze({ id: '30000000-0000-0000-0000-000000000001', label: 'Владелец · демо' });

function account(index) {
  return ACCOUNTS[index];
}

function category(index) {
  return CATEGORIES[index];
}

function operation(overrides) {
  return Object.freeze({
    id: '40000000-0000-0000-0000-000000000000',
    type: 'EXPENSE',
    occurredOn: '2026-09-08',
    capturedAt: '2026-09-08T12:00:00.000Z',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 0,
    currency: 'RUB',
    fromAccount: account(0),
    toAccount: null,
    category: category(0),
    paidByMember: MEMBER,
    description: 'Демо-операция',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
    version: 1,
    ...overrides,
  });
}

const OPERATIONS = Object.freeze([
  operation({
    id: '40000000-0000-0000-0000-000000000001',
    occurredOn: '2026-09-08',
    capturedAt: '2026-09-08T17:35:00.000Z',
    amountMinor: 428750,
    description: 'Супермаркет · демо',
    category: category(0),
    note: 'Заказ · демо: https://example.invalid/orders/42?source=preview&kind=synthetic',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000002',
    type: 'INCOME',
    occurredOn: '2026-09-07',
    capturedAt: '2026-09-07T10:00:00.000Z',
    amountMinor: 18500000,
    fromAccount: null,
    toAccount: account(0),
    category: category(3),
    description: 'Зарплата · демо',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000003',
    type: 'TRANSFER',
    occurredOn: '2026-09-06',
    capturedAt: '2026-09-06T16:25:00.000Z',
    amountMinor: 2500000,
    fromAccount: account(0),
    toAccount: account(2),
    category: null,
    description: 'В накопления · демо',
    flowKind: 'OWN_FUNDS_TRANSFER',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000004',
    occurredOn: '2026-09-05',
    capturedAt: '2026-09-05T07:45:00.000Z',
    amountMinor: 96000,
    fromAccount: account(1),
    category: category(1),
    description: 'Такси · демо',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000005',
    occurredOn: '2026-09-04',
    capturedAt: '2026-09-04T19:10:00.000Z',
    amountMinor: 329900,
    category: category(2),
    description: 'Товары для дома · демо',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000006',
    occurredOn: '2026-09-03',
    capturedAt: '2026-09-03T13:15:00.000Z',
    amountMinor: 149900,
    category: category(0),
    description: 'Кафе · демо',
    status: 'VOIDED',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000007',
    occurredOn: '2026-09-02',
    capturedAt: '2026-09-02T17:00:00.000Z',
    amountMinor: 219000,
    category: category(0),
    description: 'Продукты у дома · демо',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000008',
    occurredOn: '2026-09-01',
    capturedAt: '2026-09-01T09:20:00.000Z',
    amountMinor: 74000,
    fromAccount: account(1),
    category: category(1),
    description: 'Автобус · демо',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000009',
    type: 'INCOME',
    occurredOn: '2026-08-31',
    capturedAt: '2026-08-31T18:05:00.000Z',
    amountMinor: 350000,
    fromAccount: null,
    toAccount: account(1),
    category: category(3),
    description: 'Возврат · демо',
  }),
  operation({
    id: '40000000-0000-0000-0000-000000000010',
    occurredOn: '2024-11-01',
    capturedAt: null,
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'MONTH',
    aggregatePeriodMonth: '2024-11',
    periodAssignmentQuality: 'LEGACY_AMBIGUOUS',
    amountMinor: 4825000,
    fromAccount: account(0),
    category: category(0),
    paidByMember: null,
    description: 'Исторические расходы за месяц · демо',
  }),
]);

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function matchesFilters(item, params) {
  const type = params.get('type');
  const status = params.get('status');
  const accountId = params.get('accountId');
  const categoryId = params.get('categoryId');
  if (type !== null && item.type !== type) return false;
  if (status !== null && item.status !== status) return false;
  if (accountId !== null && item.fromAccount?.id !== accountId && item.toAccount?.id !== accountId) return false;
  if (categoryId !== null && item.category?.id !== categoryId) return false;
  return true;
}

function recentOperationsResponse(url) {
  const cursor = url.searchParams.get('cursor');
  let offset = 0;
  if (cursor === SECOND_PAGE_CURSOR) offset = PAGE_SIZE;
  else if (cursor !== null) return jsonResponse({ code: 'PREVIEW_INVALID_CURSOR' }, 400);

  const filtered = OPERATIONS.filter((item) => matchesFilters(item, url.searchParams));
  const items = filtered.slice(offset, offset + PAGE_SIZE);
  const nextCursor = offset === 0 && filtered.length > PAGE_SIZE ? SECOND_PAGE_CURSOR : null;
  return jsonResponse({ apiVersion: 1, items, pageSize: items.length, nextCursor });
}

function requestUrl(input, baseUrl) {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input, baseUrl);
  if (input && typeof input.url === 'string') return new URL(input.url, baseUrl);
  throw new Error('PREVIEW_INVALID_REQUEST');
}

export function createSyntheticPreviewFetch({ nativeFetch, baseUrl = 'https://preview.local/' }) {
  if (typeof nativeFetch !== 'function') throw new Error('PREVIEW_NATIVE_FETCH_REQUIRED');

  return async function syntheticPreviewFetch(input, init = undefined) {
    const url = requestUrl(input, baseUrl);
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);

    const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') return jsonResponse({ code: 'PREVIEW_METHOD_NOT_ALLOWED' }, 405);

    if (url.pathname === '/api/v1/operations/recent') return recentOperationsResponse(url);
    if (url.pathname === '/api/v1/reader/filter-options') {
      return jsonResponse({ apiVersion: 1, accounts: ACCOUNTS, categories: CATEGORIES });
    }
    if (url.pathname === '/api/v1/reader/sync-status') {
      return jsonResponse({
        apiVersion: 1,
        state: 'READY',
        lastCommittedAt: '2026-09-08T18:40:00.000Z',
        hasIncompleteRun: false,
      });
    }

    return jsonResponse({ code: 'PREVIEW_ENDPOINT_NOT_AVAILABLE' }, 404);
  };
}

export function installSyntheticPreviewTransport(target = globalThis) {
  if (target.__PRIHRASH_SYNTHETIC_PREVIEW__ === true) return;
  if (typeof target.fetch !== 'function') throw new Error('PREVIEW_FETCH_UNAVAILABLE');
  const nativeFetch = target.fetch.bind(target);
  const baseUrl = target.location?.href ?? 'https://preview.local/';
  target.fetch = createSyntheticPreviewFetch({ nativeFetch, baseUrl });
  target.__PRIHRASH_SYNTHETIC_PREVIEW__ = true;
}

export const syntheticPreviewEvidence = Object.freeze({
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  operations: OPERATIONS,
  pageSize: PAGE_SIZE,
});
