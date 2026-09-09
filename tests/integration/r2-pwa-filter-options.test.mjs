import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  createIndexedDbReaderFilterOptionsCache,
  createReaderFilterOptionsCacheRecord,
  parseReaderFilterOptionsCacheRecord,
} from '../../web/reader-cache.mjs';
import {
  createReaderFilterOptionsView,
  reconcileReaderFilterSelection,
} from '../../web/reader-filter-options-view.mjs';
import {
  buildRecentOperationsUrl,
  categoryOptionLabel,
  hasActiveReaderFilters,
  normalizeReaderFilters,
  sanitizeReaderFilterOptions,
} from '../../web/reader-filters.mjs';

const ACCOUNT = '00000000-0000-0000-0000-000000000201';
const CATEGORY = '00000000-0000-0000-0000-000000000301';

function response(overrides = {}) {
  return {
    apiVersion: 1,
    accounts: [{ id: ACCOUNT, label: 'Карта Visa' }],
    categories: [{ id: CATEGORY, label: 'Продукты', kind: 'EXPENSE' }],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createFakeIndexedDb(initialEntries = []) {
  const stored = new Map(initialEntries);
  const objectStoreNames = { contains: () => true };

  function makeRequest(run, transaction) {
    const request = {};
    queueMicrotask(() => {
      try {
        request.result = run();
        request.onsuccess?.();
        queueMicrotask(() => transaction.oncomplete?.());
      } catch {
        request.onerror?.();
        queueMicrotask(() => transaction.onerror?.());
      }
    });
    return request;
  }

  const db = {
    objectStoreNames,
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = {};
      transaction.objectStore = () => ({
        get: (key) => makeRequest(() => stored.get(key), transaction),
        put: (value, key) => makeRequest(() => { stored.set(key, value); return undefined; }, transaction),
        delete: (key) => makeRequest(() => { stored.delete(key); return undefined; }, transaction),
      });
      return transaction;
    },
  };

  return {
    indexedDb: {
      open() {
        const request = { result: db };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
    stored,
  };
}

test('browser validates filter options and preserves stable ids without mapping guesses', () => {
  const safe = sanitizeReaderFilterOptions(response());
  assert.deepEqual(safe, response());
  assert.equal(Object.isFrozen(safe.accounts), true);
  assert.equal(categoryOptionLabel(safe.categories[0]), 'Расход · Продукты');
});

test('browser filter-options validation fails closed on unknown shape, ids, kinds and duplicate choices', () => {
  const cases = [
    response({ extra: 'hidden' }),
    response({ accounts: [{ id: 'bad', label: 'Карта Visa' }] }),
    response({ categories: [{ id: CATEGORY, label: 'Продукты', kind: 'TRANSFER' }] }),
    response({ accounts: [
      { id: ACCOUNT, label: 'Одинаково' },
      { id: '00000000-0000-0000-0000-000000000202', label: 'Одинаково' },
    ] }),
    response({ categories: [
      { id: CATEGORY, label: 'Одинаково', kind: 'EXPENSE' },
      { id: '00000000-0000-0000-0000-000000000302', label: 'Одинаково', kind: 'EXPENSE' },
    ] }),
  ];
  for (const value of cases) assert.throws(() => sanitizeReaderFilterOptions(value), /INVALID_READER_FILTER_OPTIONS/u);
});

test('account/category filters accept only canonical UUID and keep stable query order', () => {
  const upperAccount = ACCOUNT.toUpperCase();
  const filters = normalizeReaderFilters({
    type: 'EXPENSE',
    status: 'POSTED',
    accountId: upperAccount,
    categoryId: CATEGORY,
  });
  assert.deepEqual(filters, {
    type: 'EXPENSE',
    status: 'POSTED',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
  });
  assert.equal(hasActiveReaderFilters({ accountId: ACCOUNT }), true);
  assert.equal(
    buildRecentOperationsUrl(filters, 'opaqueCursor_1'),
    `/api/v1/operations/recent?limit=50&type=EXPENSE&status=POSTED&accountId=${ACCOUNT}&categoryId=${CATEGORY}&cursor=opaqueCursor_1`,
  );
  assert.throws(() => normalizeReaderFilters({ accountId: 'not-a-uuid' }), /INVALID_READER_FILTERS/u);
  assert.throws(() => normalizeReaderFilters({ categoryId: 'not-a-uuid' }), /INVALID_READER_FILTERS/u);
});

test('PWA exposes disabled account/category controls while API remains outside Service Worker cache', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');

  assert.match(html, /data-filter-account disabled/u);
  assert.match(html, /data-filter-category disabled/u);
  assert.match(html, /data-filter-options-state/u);
  assert.match(app, /fetch\('\/api\/v1\/reader\/filter-options'/u);
  assert.match(app, /accountFilter\.disabled = false/u);
  assert.match(app, /categoryFilter\.disabled = false/u);
  assert.match(app, /createIndexedDbReaderFilterOptionsCache/u);
  assert.match(app, /Локальные справочники от/u);
  assert.match(app, /Офлайн · справочники от/u);
  assert.match(app, /Счёт и категория недоступны/u);
  assert.match(sw, /prihrash-shell-v14/u);
  assert.match(sw, /'\/reader-filter-options-view\.mjs'/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});


test('reference-options cache record is bounded, versioned and validates through the existing browser contract', () => {
  const record = createReaderFilterOptionsCacheRecord(response(), '2026-09-08T09:00:00.000Z');
  assert.deepEqual(Object.keys(record).sort(), ['apiVersion', 'response', 'savedAt', 'schemaVersion']);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.apiVersion, 1);
  assert.deepEqual(record.response, response());
  assert.throws(
    () => parseReaderFilterOptionsCacheRecord({ ...record, schemaVersion: 2 }),
    /INVALID_READER_FILTER_OPTIONS_CACHE/u,
  );
  assert.throws(
    () => parseReaderFilterOptionsCacheRecord({ ...record, savedAt: 'not-a-date' }),
    /INVALID_READER_FILTER_OPTIONS_CACHE/u,
  );
  assert.throws(
    () => createReaderFilterOptionsCacheRecord({ ...response(), providerId: 'hidden' }, '2026-09-08T09:00:00.000Z'),
    /INVALID_READER_FILTER_OPTIONS/u,
  );
});

test('warm reference path renders validated cache before background network refresh completes', async () => {
  const network = deferred();
  const renders = [];
  const statuses = [];
  const writes = [];
  const cached = createReaderFilterOptionsCacheRecord(response(), '2026-09-08T09:00:00.000Z');
  const view = createReaderFilterOptionsView({
    cache: {
      read: async () => cached,
      write: async (value, savedAt) => writes.push([value, savedAt]),
    },
    fetchOptions: async () => network.promise,
    render: (value) => renders.push(value),
    setStatus: (value) => statuses.push(value),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  const pending = view.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(renders, [response()]);
  assert.deepEqual(statuses, [{ kind: 'cached', savedAt: '2026-09-08T09:00:00.000Z' }]);

  const fresh = response({ accounts: [{ id: ACCOUNT, label: 'Основная карта' }] });
  network.resolve(fresh);
  await pending;
  assert.deepEqual(writes, [[fresh, '2026-09-08T10:00:00.000Z']]);
  assert.deepEqual(renders.at(-1), fresh);
  assert.deepEqual(statuses.at(-1), { kind: 'fresh', savedAt: '2026-09-08T10:00:00.000Z' });
});

test('reference network failure preserves valid cached options and marks them offline', async () => {
  const renders = [];
  const statuses = [];
  const cached = createReaderFilterOptionsCacheRecord(response(), '2026-09-08T09:00:00.000Z');
  await createReaderFilterOptionsView({
    cache: {
      read: async () => cached,
      write: async () => assert.fail('offline refresh must not write'),
    },
    fetchOptions: async () => { throw new Error('offline'); },
    render: (value) => renders.push(value),
    setStatus: (value) => statuses.push(value),
  }).load();

  assert.deepEqual(renders, [response()]);
  assert.deepEqual(statuses.at(-1), { kind: 'offline', savedAt: '2026-09-08T09:00:00.000Z' });
});

test('malformed reference network response never overwrites the previous valid cache', async () => {
  let writes = 0;
  const renders = [];
  const statuses = [];
  const cached = createReaderFilterOptionsCacheRecord(response(), '2026-09-08T09:00:00.000Z');
  await createReaderFilterOptionsView({
    cache: {
      read: async () => cached,
      write: async () => { writes += 1; },
    },
    fetchOptions: async () => ({ apiVersion: 2, accounts: [], categories: [] }),
    render: (value) => renders.push(value),
    setStatus: (value) => statuses.push(value),
  }).load();

  assert.equal(writes, 0);
  assert.deepEqual(renders, [response()]);
  assert.equal(statuses.at(-1).kind, 'offline');
});

test('reference refresh without valid cache degrades safely, while persistence failure still allows fresh options', async () => {
  const noCacheStatuses = [];
  await createReaderFilterOptionsView({
    cache: { read: async () => null, write: async () => assert.fail('must not write') },
    fetchOptions: async () => { throw new Error('offline'); },
    render: () => assert.fail('must not render'),
    setStatus: (value) => noCacheStatuses.push(value),
  }).load();
  assert.deepEqual(noCacheStatuses, [{ kind: 'error', savedAt: null }]);

  const renders = [];
  const statuses = [];
  await createReaderFilterOptionsView({
    cache: { read: async () => null, write: async () => { throw new Error('idb'); } },
    fetchOptions: async () => response(),
    render: (value) => renders.push(value),
    setStatus: (value) => statuses.push(value),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  }).load();
  assert.deepEqual(renders, [response()]);
  assert.deepEqual(statuses, [{ kind: 'fresh-uncached', savedAt: '2026-09-08T10:00:00.000Z' }]);
});

test('fresh canonical reference options fail-closed reset a cached UUID that no longer exists', () => {
  const retained = reconcileReaderFilterSelection(response(), { accountId: ACCOUNT, categoryId: CATEGORY });
  assert.deepEqual(retained, {
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    accountReset: false,
    categoryReset: false,
  });

  const fresh = response({
    accounts: [{ id: '00000000-0000-0000-0000-000000000202', label: 'Новый счёт' }],
  });
  const reset = reconcileReaderFilterSelection(fresh, { accountId: ACCOUNT, categoryId: CATEGORY });
  assert.deepEqual(reset, {
    accountId: null,
    categoryId: CATEGORY,
    accountReset: true,
    categoryReset: false,
  });
});

test('IndexedDB reference adapter stores exactly one dedicated bounded record and clears malformed evidence', async () => {
  const fake = createFakeIndexedDb();
  const cache = createIndexedDbReaderFilterOptionsCache(fake.indexedDb);
  await cache.write(response(), '2026-09-08T09:00:00.000Z');
  await cache.write(response({ accounts: [{ id: ACCOUNT, label: 'Обновлённая карта' }] }), '2026-09-08T10:00:00.000Z');

  assert.equal(fake.stored.size, 1);
  assert.equal(fake.stored.has('reader-filter-options-v1'), true);
  assert.equal(fake.stored.get('reader-filter-options-v1').response.accounts[0].label, 'Обновлённая карта');
  assert.equal((await cache.read()).savedAt, '2026-09-08T10:00:00.000Z');

  fake.stored.set('reader-filter-options-v1', { schemaVersion: 9, apiVersion: 1, savedAt: 'bad', response: {} });
  assert.equal(await cache.read(), null);
  assert.equal(fake.stored.has('reader-filter-options-v1'), false);
});
