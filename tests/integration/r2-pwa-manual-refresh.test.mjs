import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createReaderFilterOptionsView } from '../../web/reader-filter-options-view.mjs';
import { createReaderRefreshController } from '../../web/reader-refresh.mjs';
import { createRecentOperationsView } from '../../web/reader-view.mjs';

const OPERATION = Object.freeze({
  id: '00000000-0000-0000-0000-000000000001',
  type: 'EXPENSE',
  occurredOn: '2026-09-08',
  capturedAt: '2026-09-08T08:00:00.000Z',
  recordGranularity: 'TRANSACTION',
  datePrecision: 'DAY',
  aggregatePeriodMonth: null,
  financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED',
  amountMinor: 12345,
  currency: 'RUB',
  fromAccount: { id: 'a', label: 'Карта Visa' },
  toAccount: null,
  category: { id: 'c', label: 'Продукты' },
  paidByMember: null,
  description: 'Покупка',
  note: null,
  status: 'POSTED',
  analyticsState: 'INCLUDED',
  flowKind: null,
  version: 1,
});

const SECOND = Object.freeze({ ...OPERATION, id: '00000000-0000-0000-0000-000000000002', description: 'Вторая' });
const CURSOR = 'opaqueCursor_1';
const ACCOUNT = '00000000-0000-0000-0000-000000000201';
const CATEGORY = '00000000-0000-0000-0000-000000000301';

function response(items = [OPERATION], nextCursor = null) {
  return { apiVersion: 1, items, pageSize: items.length, nextCursor };
}

function optionsResponse() {
  return {
    apiVersion: 1,
    accounts: [{ id: ACCOUNT, label: 'Карта Visa' }],
    categories: [{ id: CATEGORY, label: 'Продукты', kind: 'EXPENSE' }],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('manual refresh controller coalesces repeated clicks into one three-path batch', async () => {
  const operations = deferred();
  const references = deferred();
  const sync = deferred();
  const calls = [];
  const busy = [];
  const controller = createReaderRefreshController({
    refreshOperations: () => { calls.push('operations'); return operations.promise; },
    refreshFilterOptions: () => { calls.push('references'); return references.promise; },
    refreshSyncStatus: () => { calls.push('sync'); return sync.promise; },
    setRefreshing: (value) => busy.push(value),
  });

  const first = controller.refresh();
  const second = controller.refresh();
  assert.equal(first, second);
  await tick();
  assert.deepEqual(calls, ['operations', 'references', 'sync']);
  assert.deepEqual(busy, [true]);

  operations.resolve(true);
  references.resolve(true);
  sync.resolve(true);
  await first;
  assert.deepEqual(busy, [true, false]);
});

test('filtered manual refresh preserves visible rows while network retry fails', async () => {
  const retry = deferred();
  const renders = [];
  const statuses = [];
  let initial = true;
  const view = createRecentOperationsView({
    cache: {
      read: async () => assert.fail('filtered path must not read cache'),
      write: async () => assert.fail('filtered path must not write cache'),
    },
    fetchRecent: async () => {
      if (initial) {
        initial = false;
        return response([OPERATION]);
      }
      return retry.promise;
    },
    render: (items) => renders.push(items),
    setStatus: (value) => statuses.push(value),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  await view.load({ type: 'EXPENSE' });
  const rendersBeforeRetry = renders.length;
  const pending = view.refresh({ type: 'EXPENSE' });
  await tick();
  assert.equal(renders.length, rendersBeforeRetry, 'retry must not clear existing filtered rows');
  assert.deepEqual(statuses.at(-1), { kind: 'refreshing', hasVisibleItems: true });

  retry.reject(new Error('offline'));
  assert.equal(await pending, false);
  assert.equal(renders.length, rendersBeforeRetry, 'failed retry keeps previous rows visible');
  assert.deepEqual(statuses.at(-1), { kind: 'refresh-error', hasVisibleItems: true });
});

test('filtered manual refresh keeps contextual empty-result render state on valid zero response', async () => {
  const renders = [];
  const statuses = [];
  const view = createRecentOperationsView({
    cache: {
      read: async () => assert.fail('filtered refresh must not read cache'),
      write: async () => assert.fail('filtered refresh must not write cache'),
    },
    fetchRecent: async () => response([]),
    render: (items, context) => renders.push({ items, context }),
    setStatus: (value) => statuses.push(value),
  });

  assert.equal(await view.refresh({ type: 'EXPENSE' }), true);
  assert.deepEqual(renders.at(-1), { items: [], context: { filtered: true } });
  assert.deepEqual(statuses.at(-1), { kind: 'filtered-fresh' });
});

test('unfiltered manual refresh is network-only, validates response and replaces bounded cache', async () => {
  const writes = [];
  const renders = [];
  const statuses = [];
  const view = createRecentOperationsView({
    cache: {
      read: async () => assert.fail('manual refresh must not regress UI by re-reading old cache'),
      write: async (value, savedAt) => writes.push([value, savedAt]),
    },
    fetchRecent: async (filters, cursor) => {
      assert.deepEqual(filters, { type: null, status: null });
      assert.equal(cursor, null);
      return response([SECOND], CURSOR);
    },
    render: (items) => renders.push(items),
    setStatus: (value) => statuses.push(value),
    setPagination: () => {},
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  assert.equal(await view.refresh({}), true);
  assert.equal(renders.at(-1)[0].id, SECOND.id);
  assert.deepEqual(writes, [[response([SECOND], CURSOR), '2026-09-08T10:00:00.000Z']]);
  assert.deepEqual(statuses.at(-1), { kind: 'fresh', savedAt: '2026-09-08T10:00:00.000Z' });
});

test('manual first-page refresh invalidates stale in-flight load-more append', async () => {
  const page = deferred();
  const appends = [];
  let firstPageCalls = 0;
  const view = createRecentOperationsView({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async (_filters, cursor) => {
      if (cursor === CURSOR) return page.promise;
      firstPageCalls += 1;
      return firstPageCalls === 1 ? response([OPERATION], CURSOR) : response([SECOND], null);
    },
    render: () => {},
    append: (items) => appends.push(items),
    setStatus: () => {},
    setPagination: () => {},
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  await view.load({});
  const staleLoadMore = view.loadMore();
  await tick();
  assert.equal(await view.refresh({}), true);
  page.resolve(response([{ ...SECOND, id: '00000000-0000-0000-0000-000000000003' }], null));
  assert.equal(await staleLoadMore, false);
  assert.deepEqual(appends, []);
});

test('reference manual refresh is network-only and failure keeps existing controls/data untouched', async () => {
  let mode = 'success';
  const renders = [];
  const statuses = [];
  const writes = [];
  const view = createReaderFilterOptionsView({
    cache: {
      read: async () => assert.fail('manual reference refresh must not read older cache'),
      write: async (value, savedAt) => writes.push([value, savedAt]),
    },
    fetchOptions: async () => {
      if (mode === 'failure') throw new Error('offline');
      return optionsResponse();
    },
    render: (value) => renders.push(value),
    setStatus: (value) => statuses.push(value),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  assert.equal(await view.refresh(), true);
  assert.deepEqual(renders, [optionsResponse()]);
  assert.deepEqual(writes, [[optionsResponse(), '2026-09-08T10:00:00.000Z']]);

  mode = 'failure';
  assert.equal(await view.refresh(), false);
  assert.deepEqual(renders, [optionsResponse()]);
  assert.deepEqual(statuses.at(-1), { kind: 'refresh-error', hasVisibleOptions: true });
});

test('reference retry without previous valid options stays honestly unavailable', async () => {
  const statuses = [];
  const view = createReaderFilterOptionsView({
    cache: {
      read: async () => assert.fail('manual reference refresh must not read cache'),
      write: async () => assert.fail('failed refresh must not write cache'),
    },
    fetchOptions: async () => { throw new Error('offline'); },
    render: () => assert.fail('failed refresh must not invent reference options'),
    setStatus: (value) => statuses.push(value),
  });

  assert.equal(await view.refresh(), false);
  assert.deepEqual(statuses, [{ kind: 'refresh-error', hasVisibleOptions: false }]);
});

test('PWA wires one accessible refresh action to existing operations/reference/sync paths', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');

  assert.match(html, /data-refresh-reader>Обновить</u);
  assert.match(app, /createReaderRefreshController/u);
  assert.match(app, /refreshOperations: \(\) => view\.refresh\(selectedFilters\(\)\)/u);
  assert.match(app, /refreshFilterOptions: \(\) => filterOptionsView\.refresh\(\)/u);
  assert.match(app, /refreshSyncStatus: loadSyncStatus/u);
  assert.match(app, /refreshReader\.disabled = refreshing/u);
  assert.match(app, /refreshReader\.addEventListener\('click'/u);
  assert.match(app, /Не удалось загрузить операции\. Нажмите «Обновить»\./u);
  assert.match(app, /Не удалось загрузить выбранный фильтр\. Нажмите «Обновить»\./u);
  assert.match(app, /Не удалось обновить операции\. Можно повторить\./u);
  assert.match(app, /Не удалось обновить · показаны прежние данные/u);
  assert.doesNotMatch(app, /обновить экран/iu);
  assert.match(sw, /prihrash-shell-v13/u);
  assert.match(sw, /'\/reader-refresh\.mjs'/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});
