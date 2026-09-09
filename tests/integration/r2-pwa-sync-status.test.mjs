import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  formatReaderSyncStatus,
  sanitizeReaderSyncStatus,
} from '../../web/reader-sync-status.mjs';

function ready(overrides = {}) {
  return {
    apiVersion: 1,
    state: 'READY',
    lastCommittedAt: '2026-09-08T07:00:05.000Z',
    hasIncompleteRun: false,
    ...overrides,
  };
}

test('browser validates exact sync-status v1 shape before display', () => {
  const safe = sanitizeReaderSyncStatus(ready());
  assert.deepEqual(safe, ready());
  assert.equal(
    formatReaderSyncStatus(safe, () => '08.09.2026, 10:00'),
    'Синхронизация: 08.09.2026, 10:00',
  );
  assert.equal(
    formatReaderSyncStatus(ready({ state: 'DEGRADED', hasIncompleteRun: true }), () => '08.09.2026, 10:00'),
    'Синхронизация: требуется проверка · последняя успешная 08.09.2026, 10:00',
  );
  assert.equal(
    formatReaderSyncStatus(ready({ state: 'UNAVAILABLE', lastCommittedAt: null })),
    'Синхронизация: подтверждённой копии ещё нет',
  );
});

test('browser sync-status validation fails closed on hidden fields and inconsistent state', () => {
  const cases = [
    ready({ apiVersion: 2 }),
    ready({ state: 'UNKNOWN' }),
    ready({ hiddenDigest: 'must-not-cross-browser-boundary' }),
    ready({ state: 'READY', hasIncompleteRun: true }),
    ready({ state: 'DEGRADED', hasIncompleteRun: false }),
    ready({ state: 'UNAVAILABLE', lastCommittedAt: '2026-09-08T07:00:05.000Z' }),
    ready({ lastCommittedAt: '2026-09-08 07:00:05' }),
  ];
  for (const value of cases) assert.throws(() => sanitizeReaderSyncStatus(value), /INVALID_READER_SYNC_STATUS/u);
});

test('PWA loads sync status independently and never routes it through browser persistence', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const syncStatus = await readFile(new URL('../../web/reader-sync-status.mjs', import.meta.url), 'utf8');
  const cache = await readFile(new URL('../../web/reader-cache.mjs', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');

  assert.match(html, /data-shadow-sync-status/u);
  assert.match(app, /fetch\('\/api\/v1\/reader\/sync-status'/u);
  assert.match(app, /loadSyncStatus\(\);[\s\S]*filterOptionsView\.load\(\);[\s\S]*applyFilters\(\);/u);
  assert.match(app, /Синхронизация: статус недоступен/u);
  assert.doesNotMatch(syncStatus, /indexedDB|localStorage|caches\./u);
  assert.doesNotMatch(cache, /sync-status/u);
  assert.match(sw, /prihrash-shell-v11/u);
  assert.match(sw, /'\/reader-sync-status\.mjs'/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});
