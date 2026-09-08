import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createReaderCacheRecord } from '../../web/reader-cache.mjs';
import { buildRecentOperationsUrl } from '../../web/reader-filters.mjs';
import { createRecentOperationsView } from '../../web/reader-view.mjs';
import { sanitizeReaderResponse } from '../../web/presentation.mjs';

const BASE = Object.freeze({
  id: '00000000-0000-0000-0000-000000000001', type: 'EXPENSE', occurredOn: '2026-09-08', capturedAt: '2026-09-08T08:00:00.000Z',
  recordGranularity: 'TRANSACTION', datePrecision: 'DAY', aggregatePeriodMonth: null, financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED', amountMinor: 12345, currency: 'RUB', fromAccount: { id: 'a', label: 'Карта Visa' },
  toAccount: null, category: { id: 'c', label: 'Продукты' }, paidByMember: null, description: 'Покупка', note: null,
  status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null, version: 1,
});

const SECOND_ID = '00000000-0000-0000-0000-000000000002';
const THIRD_ID = '00000000-0000-0000-0000-000000000003';
const CURSOR_1 = 'eyJ2IjoxLCJvIjoiMjAyNi0wOS0wOCJ9';
const CURSOR_2 = 'eyJ2IjoxLCJvIjoiMjAyNi0wOS0wNyJ9';

function operation(id, description, overrides = {}) {
  return { ...BASE, id, description, ...overrides };
}

function response(items, nextCursor = null) {
  return { apiVersion: 1, items, pageSize: items.length, nextCursor };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createHarness({ cache, fetchRecent }) {
  const renders = [];
  const appends = [];
  const statuses = [];
  const pagination = [];
  const view = createRecentOperationsView({
    cache,
    fetchRecent,
    render: (items) => renders.push(items),
    append: (items) => appends.push(items),
    setStatus: (status) => statuses.push(status),
    setPagination: (status) => pagination.push(status),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });
  return { view, renders, appends, statuses, pagination };
}

test('next-page URL preserves filters and carries opaque cursor without decoding it', () => {
  assert.equal(
    buildRecentOperationsUrl({ type: 'EXPENSE', status: 'POSTED' }, CURSOR_1),
    `/api/v1/operations/recent?limit=50&type=EXPENSE&status=POSTED&cursor=${CURSOR_1}`,
  );
  assert.throws(() => buildRecentOperationsUrl({}, ''), /INVALID_READER_CURSOR/);
  assert.throws(() => buildRecentOperationsUrl({}, ' *** '), /INVALID_READER_CURSOR/);
});

test('browser response validation fails closed on malformed opaque cursor surface', () => {
  assert.throws(() => sanitizeReaderResponse(response([BASE], '')), /INVALID_READER_RESPONSE/);
  assert.throws(() => sanitizeReaderResponse(response([BASE], '***')), /INVALID_READER_RESPONSE/);
  assert.equal(sanitizeReaderResponse(response([BASE], CURSOR_1)).nextCursor, CURSOR_1);
});

test('cached first page never exposes stale pagination before fresh network response', async () => {
  const network = deferred();
  const cached = createReaderCacheRecord(response([operation(BASE.id, 'Локальная')], CURSOR_1), '2026-09-08T09:00:00.000Z');
  const harness = createHarness({
    cache: { read: async () => cached, write: async () => {} },
    fetchRecent: async () => network.promise,
  });

  const pending = harness.view.load({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.renders[0][0].description, 'Локальная');
  assert.deepEqual(harness.pagination, [{ kind: 'hidden' }]);

  network.resolve(response([operation(BASE.id, 'Свежая')], CURSOR_1));
  await pending;
  assert.deepEqual(harness.pagination.at(-1), { kind: 'ready' });
});

test('load more appends validated page without extending IndexedDB first-page cache', async () => {
  let writes = 0;
  const calls = [];
  const first = response([operation(BASE.id, 'Первая')], CURSOR_1);
  const second = response([operation(SECOND_ID, 'Вторая')], null);
  const harness = createHarness({
    cache: { read: async () => null, write: async () => { writes += 1; } },
    fetchRecent: async (filters, cursor) => {
      calls.push([filters, cursor]);
      return cursor === null ? first : second;
    },
  });

  await harness.view.load({});
  assert.equal(writes, 1);
  assert.deepEqual(harness.pagination.at(-1), { kind: 'ready' });

  assert.equal(await harness.view.loadMore(), true);
  assert.equal(writes, 1);
  assert.equal(harness.appends.length, 1);
  assert.equal(harness.appends[0][0].description, 'Вторая');
  assert.deepEqual(calls[1], [{ type: null, status: null }, CURSOR_1]);
  assert.deepEqual(harness.pagination.at(-1), { kind: 'done' });
});

test('filtered pagination preserves exact current type/status and never touches cache', async () => {
  const calls = [];
  const harness = createHarness({
    cache: {
      read: async () => assert.fail('filtered flow must not read cache'),
      write: async () => assert.fail('filtered flow must not write cache'),
    },
    fetchRecent: async (filters, cursor) => {
      calls.push([filters, cursor]);
      if (cursor === null) return response([operation(BASE.id, 'Расход')], CURSOR_1);
      return response([operation(SECOND_ID, 'Ещё расход')], null);
    },
  });

  await harness.view.load({ type: 'EXPENSE', status: 'VOIDED' });
  await harness.view.loadMore();
  assert.deepEqual(calls, [
    [{ type: 'EXPENSE', status: 'VOIDED' }, null],
    [{ type: 'EXPENSE', status: 'VOIDED' }, CURSOR_1],
  ]);
});

test('load-more failure preserves visible rows and previous cursor for retry', async () => {
  let pageAttempts = 0;
  const harness = createHarness({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async (_filters, cursor) => {
      if (cursor === null) return response([operation(BASE.id, 'Первая')], CURSOR_1);
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error('offline');
      assert.equal(cursor, CURSOR_1);
      return response([operation(SECOND_ID, 'Повтор успешен')], null);
    },
  });

  await harness.view.load({});
  assert.equal(await harness.view.loadMore(), false);
  assert.equal(harness.appends.length, 0);
  assert.deepEqual(harness.pagination.at(-1), { kind: 'error' });

  assert.equal(await harness.view.loadMore(), true);
  assert.equal(pageAttempts, 2);
  assert.equal(harness.appends[0][0].description, 'Повтор успешен');
});

test('exact duplicate id fails closed without fuzzy dedupe and retry keeps cursor', async () => {
  let pageAttempts = 0;
  const harness = createHarness({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async (_filters, cursor) => {
      if (cursor === null) return response([operation(BASE.id, 'Первая')], CURSOR_1);
      pageAttempts += 1;
      assert.equal(cursor, CURSOR_1);
      if (pageAttempts === 1) return response([operation(BASE.id, 'Дубликат')], CURSOR_2);
      return response([operation(SECOND_ID, 'Корректная')], null);
    },
  });

  await harness.view.load({});
  assert.equal(await harness.view.loadMore(), false);
  assert.equal(harness.appends.length, 0);
  assert.deepEqual(harness.pagination.at(-1), { kind: 'error' });

  assert.equal(await harness.view.loadMore(), true);
  assert.equal(harness.appends[0][0].description, 'Корректная');
});

test('duplicate ids inside one additional page fail closed', async () => {
  const harness = createHarness({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async (_filters, cursor) => cursor === null
      ? response([operation(BASE.id, 'Первая')], CURSOR_1)
      : response([operation(SECOND_ID, 'A'), operation(SECOND_ID, 'B')], null),
  });

  await harness.view.load({});
  assert.equal(await harness.view.loadMore(), false);
  assert.equal(harness.appends.length, 0);
  assert.deepEqual(harness.pagination.at(-1), { kind: 'error' });
});

test('filter change makes an in-flight old page response inert', async () => {
  const oldPage = deferred();
  const harness = createHarness({
    cache: {
      read: async () => null,
      write: async () => {},
    },
    fetchRecent: async (filters, cursor) => {
      if (filters.type === 'EXPENSE' && cursor === null) return response([operation(BASE.id, 'Расход')], CURSOR_1);
      if (filters.type === 'EXPENSE') return oldPage.promise;
      return response([operation(THIRD_ID, 'Доход', { type: 'INCOME' })], null);
    },
  });

  await harness.view.load({ type: 'EXPENSE' });
  const pendingPage = harness.view.loadMore();
  await new Promise((resolve) => setImmediate(resolve));
  await harness.view.load({ type: 'INCOME' });
  oldPage.resolve(response([operation(SECOND_ID, 'Старый расход')], null));
  assert.equal(await pendingPage, false);

  assert.equal(harness.appends.length, 0);
  assert.equal(harness.renders.at(-1)[0].description, 'Доход');
  assert.deepEqual(harness.pagination.at(-1), { kind: 'hidden' });
});

test('concurrent load-more clicks issue only one next-page request', async () => {
  const page = deferred();
  let pageCalls = 0;
  const harness = createHarness({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async (_filters, cursor) => {
      if (cursor === null) return response([operation(BASE.id, 'Первая')], CURSOR_1);
      pageCalls += 1;
      return page.promise;
    },
  });

  await harness.view.load({});
  const firstClick = harness.view.loadMore();
  const secondClick = harness.view.loadMore();
  assert.equal(await secondClick, false);
  assert.equal(pageCalls, 1);
  page.resolve(response([operation(SECOND_ID, 'Вторая')], null));
  assert.equal(await firstClick, true);
  assert.equal(pageCalls, 1);
});

test('PWA exposes a dedicated load-more control and rolls shell cache version', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  assert.match(html, /data-load-more/u);
  assert.match(html, /data-page-state/u);
  assert.match(sw, /prihrash-shell-v5/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});
