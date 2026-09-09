import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createReaderCacheRecord, parseReaderCacheRecord } from '../../web/reader-cache.mjs';
import { refreshRecentOperations } from '../../web/reader-load.mjs';
import { sanitizeReaderResponse } from '../../web/presentation.mjs';

const base = {
  id: '00000000-0000-0000-0000-000000000001', type: 'EXPENSE', occurredOn: '2026-09-08', capturedAt: '2026-09-08T08:00:00.000Z',
  recordGranularity: 'TRANSACTION', datePrecision: 'DAY', aggregatePeriodMonth: null, financialPeriodId: null,
  periodAssignmentQuality: 'UNASSIGNED', amountMinor: 12345, currency: 'RUB', fromAccount: { id: 'a', label: 'Карта Visa' },
  toAccount: null, category: { id: 'c', label: 'Продукты' }, paidByMember: null, description: 'Покупка', note: null,
  status: 'POSTED', analyticsState: 'INCLUDED', flowKind: null, version: 1,
};

function response(overrides = {}) {
  return { apiVersion: 1, items: [base], pageSize: 1, nextCursor: null, ...overrides };
}

function cacheRecord(value = response(), savedAt = '2026-09-08T09:00:00.000Z') {
  return createReaderCacheRecord(value, savedAt);
}

test('warm path renders cached operations before pending network completes', async () => {
  let releaseNetwork;
  const network = new Promise((resolve) => { releaseNetwork = resolve; });
  const renders = [];
  const statuses = [];
  const promise = refreshRecentOperations({
    cache: { read: async () => cacheRecord(), write: async () => {} },
    fetchRecent: async () => network,
    render: (items) => renders.push(items),
    setStatus: (status) => statuses.push(status),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders.length, 1);
  assert.equal(renders[0][0].description, 'Покупка');
  assert.deepEqual(statuses[0], { kind: 'cached', savedAt: '2026-09-08T09:00:00.000Z' });

  releaseNetwork(response());
  await promise;
  assert.equal(renders.length, 2);
  assert.equal(statuses.at(-1).kind, 'fresh');
});

test('successful refresh writes validated cache before rendering fresh result', async () => {
  const events = [];
  const newer = response({ items: [{ ...base, description: 'Новая покупка', amountMinor: 20000 }] });
  await refreshRecentOperations({
    cache: {
      read: async () => null,
      write: async (value, savedAt) => events.push(['write', value, savedAt]),
    },
    fetchRecent: async () => newer,
    render: (items) => events.push(['render', items]),
    setStatus: (status) => events.push(['status', status]),
    clock: () => new Date('2026-09-08T10:00:00.000Z'),
  });

  assert.equal(events[0][0], 'write');
  assert.equal(events[1][0], 'render');
  assert.equal(events[1][1][0].description, 'Новая покупка');
  assert.deepEqual(events[2], ['status', { kind: 'fresh', savedAt: '2026-09-08T10:00:00.000Z' }]);
});

test('network failure preserves valid cached data and marks it offline', async () => {
  const renders = [];
  const statuses = [];
  await refreshRecentOperations({
    cache: { read: async () => cacheRecord(), write: async () => assert.fail('must not write') },
    fetchRecent: async () => { throw new Error('offline'); },
    render: (items) => renders.push(items),
    setStatus: (status) => statuses.push(status),
  });
  assert.equal(renders.length, 1);
  assert.deepEqual(statuses.at(-1), { kind: 'offline', savedAt: '2026-09-08T09:00:00.000Z' });
});

test('malformed network response does not overwrite a previous valid cache', async () => {
  let writes = 0;
  const statuses = [];
  await refreshRecentOperations({
    cache: { read: async () => cacheRecord(), write: async () => { writes += 1; } },
    fetchRecent: async () => response({ items: [{ ...base, amountMinor: 0 }] }),
    render: () => {},
    setStatus: (status) => statuses.push(status),
  });
  assert.equal(writes, 0);
  assert.equal(statuses.at(-1).kind, 'offline');
});

test('network failure without cache produces safe error state', async () => {
  const statuses = [];
  await refreshRecentOperations({
    cache: { read: async () => null, write: async () => {} },
    fetchRecent: async () => { throw new Error('offline'); },
    render: () => assert.fail('must not render'),
    setStatus: (status) => statuses.push(status),
  });
  assert.deepEqual(statuses, [{ kind: 'error', savedAt: null }]);
});

test('sanitizer persists only whitelisted Reader fields', () => {
  const safe = sanitizeReaderResponse({
    ...response(),
    oauthToken: 'must-not-persist',
    items: [{ ...base, privateProviderId: 'hidden', fromAccount: { ...base.fromAccount, secret: 'hidden' } }],
  });
  assert.equal('oauthToken' in safe, false);
  assert.equal('privateProviderId' in safe.items[0], false);
  assert.equal('secret' in safe.items[0].fromAccount, false);
  assert.deepEqual(Object.keys(safe.items[0].fromAccount), ['id', 'label']);
});

test('cache record validation fails closed on unsupported or malformed cache', () => {
  assert.throws(() => parseReaderCacheRecord({ ...cacheRecord(), schemaVersion: 2 }), /INVALID_READER_CACHE/);
  assert.throws(() => parseReaderCacheRecord({ ...cacheRecord(), savedAt: 'not-a-date' }), /INVALID_READER_CACHE/);
  assert.throws(() => parseReaderCacheRecord({ ...cacheRecord(), response: { apiVersion: 2, items: [] } }), /INVALID_READER_RESPONSE/);
  assert.throws(
    () => parseReaderCacheRecord({ ...cacheRecord(), response: response({ items: [{ ...base, amountMinor: 0 }] }) }),
    /INVALID_READER_RESPONSE/,
  );
});

function createFakeIndexedDb(initialValue) {
  let stored = initialValue;
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
        get: () => makeRequest(() => stored, transaction),
        put: (value) => makeRequest(() => { stored = value; return undefined; }, transaction),
        delete: () => makeRequest(() => { stored = undefined; return undefined; }, transaction),
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
    stored: () => stored,
  };
}

test('IndexedDB adapter round-trips one validated bounded recent-operations record', async () => {
  const { indexedDb, stored } = createFakeIndexedDb();
  const { createIndexedDbReaderCache } = await import('../../web/reader-cache.mjs');
  const cache = createIndexedDbReaderCache(indexedDb);

  await cache.write(response(), '2026-09-08T10:00:00.000Z');
  assert.equal(stored().schemaVersion, 1);
  assert.equal(stored().apiVersion, 1);
  assert.equal('oauthToken' in stored().response, false);

  const value = await cache.read();
  assert.equal(value.savedAt, '2026-09-08T10:00:00.000Z');
  assert.equal(value.response.items[0].description, 'Покупка');
});

test('IndexedDB adapter ignores and clears malformed persisted data', async () => {
  const { indexedDb, stored } = createFakeIndexedDb({ schemaVersion: 9, apiVersion: 1, savedAt: 'bad', response: {} });
  const { createIndexedDbReaderCache } = await import('../../web/reader-cache.mjs');
  const cache = createIndexedDbReaderCache(indexedDb);

  assert.equal(await cache.read(), null);
  assert.equal(stored(), undefined);
});


test('Service Worker keeps financial API responses outside Cache Storage', async () => {
  const source = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/u);
  assert.doesNotMatch(source, /cache\.(?:add|put)\([^\n]*\/api\//u);
});
