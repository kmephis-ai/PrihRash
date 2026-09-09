import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildRecentOperationsUrl, hasActiveReaderFilters, normalizeReaderFilters } from '../../web/reader-filters.mjs';
import { createRecentOperationsView } from '../../web/reader-view.mjs';
import { createReaderCacheRecord } from '../../web/reader-cache.mjs';

const base = {
  id: '00000000-0000-0000-0000-000000000001', type: 'EXPENSE', occurredOn: '2026-09-08', capturedAt: '2026-09-08T08:00:00.000Z',
  recordGranularity: 'TRANSACTION', datePrecision: 'DAY', aggregatePeriodMonth: null, financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED', amountMinor: 12345, currency: 'RUB', fromAccount: { id: 'a', label: 'Карта Visa' },
  toAccount: null, category: { id: 'c', label: 'Продукты' }, paidByMember: null, description: 'Покупка', note: null,
  status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null, version: 1,
};

function response(description = 'Покупка', overrides = {}) {
  return {
    apiVersion: 1,
    items: [{ ...base, description, ...overrides }],
    pageSize: 1,
    nextCursor: null,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('filter query builder emits only canonical type/status values in stable order', () => {
  assert.equal(buildRecentOperationsUrl(), '/api/v1/operations/recent?limit=50');
  assert.equal(
    buildRecentOperationsUrl({ type: 'EXPENSE', status: 'VOIDED' }),
    '/api/v1/operations/recent?limit=50&type=EXPENSE&status=VOIDED',
  );
  assert.deepEqual(normalizeReaderFilters({ type: '', status: null }), { type: null, status: null });
  assert.equal(hasActiveReaderFilters({ type: 'INCOME' }), true);
  assert.equal(hasActiveReaderFilters({}), false);
});

test('filter query builder fails closed on unknown keys or noncanonical enums', () => {
  assert.throws(() => buildRecentOperationsUrl({ type: 'expense' }), /INVALID_READER_FILTERS/);
  assert.throws(() => buildRecentOperationsUrl({ status: 'DELETED' }), /INVALID_READER_FILTERS/);
  assert.throws(() => buildRecentOperationsUrl({ type: 'EXPENSE', accountId: 'hidden' }), /INVALID_READER_FILTERS/);
});

test('filtered response is network-only and never touches unfiltered IndexedDB cache', async () => {
  const renders = [];
  const statuses = [];
  const view = createRecentOperationsView({
    cache: {
      read: async () => assert.fail('filtered path must not read unfiltered cache'),
      write: async () => assert.fail('filtered path must not write unfiltered cache'),
    },
    fetchRecent: async (filters) => {
      assert.deepEqual(filters, { type: 'INCOME', status: null });
      return response('Зарплата', { type: 'INCOME' });
    },
    render: (items) => renders.push(items),
    setStatus: (status) => statuses.push(status),
  });

  await view.load({ type: 'INCOME' });
  assert.deepEqual(renders[0], []);
  assert.equal(renders.at(-1)[0].description, 'Зарплата');
  assert.deepEqual(statuses, [{ kind: 'filter-loading' }, { kind: 'filtered-fresh' }]);
});

test('offline filtered request never substitutes unfiltered cached data', async () => {
  let cacheReads = 0;
  const renders = [];
  const statuses = [];
  const view = createRecentOperationsView({
    cache: {
      read: async () => { cacheReads += 1; return createReaderCacheRecord(response('Не показывать'), '2026-09-08T09:00:00.000Z'); },
      write: async () => assert.fail('must not write'),
    },
    fetchRecent: async () => { throw new Error('offline'); },
    render: (items) => renders.push(items),
    setStatus: (status) => statuses.push(status),
  });

  await view.load({ status: 'VOIDED' });
  assert.equal(cacheReads, 0);
  assert.deepEqual(renders, [[]]);
  assert.deepEqual(statuses.at(-1), { kind: 'filtered-error' });
});

test('clearing filters restores warm unfiltered cache before network completes', async () => {
  const network = deferred();
  const renders = [];
  const statuses = [];
  const cached = createReaderCacheRecord(response('Локальная операция'), '2026-09-08T09:00:00.000Z');
  const view = createRecentOperationsView({
    cache: { read: async () => cached, write: async () => {} },
    fetchRecent: async (filters) => {
      assert.deepEqual(filters, { type: null, status: null });
      return network.promise;
    },
    render: (items) => renders.push(items),
    setStatus: (status) => statuses.push(status),
  });

  const pending = view.load({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders[0][0].description, 'Локальная операция');
  assert.deepEqual(statuses[0], { kind: 'cached', savedAt: '2026-09-08T09:00:00.000Z' });

  network.resolve(response('Свежая операция'));
  await pending;
  assert.equal(renders.at(-1)[0].description, 'Свежая операция');
});

test('out-of-order filtered responses cannot overwrite the latest selection', async () => {
  const first = deferred();
  const second = deferred();
  const renders = [];
  const statuses = [];
  const view = createRecentOperationsView({
    cache: { read: async () => null, write: async () => assert.fail('filtered path must not write') },
    fetchRecent: async (filters) => filters.type === 'EXPENSE' ? first.promise : second.promise,
    render: (items) => renders.push(items),
    setStatus: (status) => statuses.push(status),
  });

  const expenseLoad = view.load({ type: 'EXPENSE' });
  const incomeLoad = view.load({ type: 'INCOME' });
  second.resolve(response('Новый доход', { type: 'INCOME' }));
  await incomeLoad;
  first.resolve(response('Старый расход', { type: 'EXPENSE' }));
  await expenseLoad;

  const descriptions = renders.flatMap((items) => items.map((item) => item.description));
  assert.deepEqual(descriptions, ['Новый доход']);
  assert.equal(statuses.at(-1).kind, 'filtered-fresh');
});


test('view marks empty result context from normalized Reader filters', async () => {
  const emptyResponse = { apiVersion: 1, items: [], pageSize: 0, nextCursor: null };

  const filteredRenders = [];
  const filtered = createRecentOperationsView({
    cache: {
      read: async () => assert.fail('filtered path must not read cache'),
      write: async () => assert.fail('filtered path must not write cache'),
    },
    fetchRecent: async () => emptyResponse,
    render: (items, context) => filteredRenders.push({ items, context }),
    setStatus: () => {},
  });
  await filtered.load({ type: 'INCOME' });
  assert.deepEqual(filteredRenders.at(-1), { items: [], context: { filtered: true } });

  const unfilteredRenders = [];
  const unfiltered = createRecentOperationsView({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async () => emptyResponse,
    render: (items, context) => unfilteredRenders.push({ items, context }),
    setStatus: () => {},
  });
  await unfiltered.load({});
  assert.deepEqual(unfilteredRenders.at(-1), { items: [], context: { filtered: false } });
});

test('PWA empty-state wording distinguishes proven filtered zero results', async () => {
  const app = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /filtered \? 'По выбранным фильтрам операций нет\.' : 'Операций пока нет\.'/u);
});

test('new filter modules are part of the offline shell while API stays excluded', async () => {
  const source = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  assert.match(source, /'\/reader-filters\.mjs'/u);
  assert.match(source, /'\/reader-view\.mjs'/u);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/u);
});

test('PWA filter controls expose only canonical API enum values', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  for (const value of ['EXPENSE', 'INCOME', 'TRANSFER', 'POSTED', 'VOIDED']) {
    assert.match(html, new RegExp(`value="${value}"`, 'u'));
  }
  assert.doesNotMatch(html, /accountId|categoryId/u);
});
