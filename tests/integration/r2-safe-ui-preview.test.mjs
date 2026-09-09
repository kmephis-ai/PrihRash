import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSyntheticPreviewFetch, syntheticPreviewEvidence } from '../../web/preview-transport.mjs';
import { sanitizeReaderResponse } from '../../web/presentation.mjs';
import { sanitizeReaderFilterOptions } from '../../web/reader-filters.mjs';
import { sanitizeReaderSyncStatus } from '../../web/reader-sync-status.mjs';

function createTransport() {
  const outbound = [];
  const nativeFetch = async (input) => {
    outbound.push(String(input));
    return new Response('static');
  };
  return { outbound, fetch: createSyntheticPreviewFetch({ nativeFetch, baseUrl: 'https://preview.example/PrihRash/' }) };
}

test('synthetic preview evidence contains no private/provider data and covers current Reader UX', () => {
  assert.equal(syntheticPreviewEvidence.operations.length >= 8, true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.type === 'EXPENSE'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.type === 'INCOME'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.type === 'TRANSFER'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.status === 'VOIDED'), true);
  assert.equal(syntheticPreviewEvidence.operations.some((item) => item.recordGranularity === 'PERIOD_AGGREGATE' && item.datePrecision === 'MONTH'), true);
  assert.equal(JSON.stringify(syntheticPreviewEvidence).includes('mepnet'), false);
  assert.equal(JSON.stringify(syntheticPreviewEvidence).includes('89.125.'), false);
});

test('preview serves valid Reader v1 responses and never sends API requests to native network', async () => {
  const transport = createTransport();
  const first = await transport.fetch('/api/v1/operations/recent?limit=50');
  assert.equal(first.status, 200);
  const page = sanitizeReaderResponse(await first.json());
  assert.equal(page.items.length, syntheticPreviewEvidence.pageSize);
  assert.equal(page.nextCursor, 'demoPage_2');

  const second = await transport.fetch(`/api/v1/operations/recent?limit=50&cursor=${page.nextCursor}`);
  assert.equal(second.status, 200);
  assert.equal(sanitizeReaderResponse(await second.json()).nextCursor, null);

  const options = await transport.fetch('/api/v1/reader/filter-options');
  sanitizeReaderFilterOptions(await options.json());
  const sync = await transport.fetch('/api/v1/reader/sync-status');
  sanitizeReaderSyncStatus(await sync.json());
  assert.deepEqual(transport.outbound, []);
});

test('preview applies all four Reader filters using canonical stable ids', async () => {
  const transport = createTransport();
  const accountId = syntheticPreviewEvidence.accounts[1].id;
  const categoryId = syntheticPreviewEvidence.categories[1].id;
  const response = await transport.fetch(`/api/v1/operations/recent?limit=50&type=EXPENSE&status=POSTED&accountId=${accountId}&categoryId=${categoryId}`);
  const safe = sanitizeReaderResponse(await response.json());
  assert.equal(safe.items.length > 0, true);
  for (const item of safe.items) {
    assert.equal(item.type, 'EXPENSE');
    assert.equal(item.status, 'POSTED');
    assert.equal(item.fromAccount?.id === accountId || item.toAccount?.id === accountId, true);
    assert.equal(item.category?.id, categoryId);
  }
});

test('preview fails closed for unknown API endpoints/mutations but permits static asset fetch', async () => {
  const transport = createTransport();
  assert.equal((await transport.fetch('/api/v1/not-real')).status, 404);
  assert.equal((await transport.fetch('/api/v1/reader/sync-status', { method: 'POST' })).status, 405);
  assert.equal((await transport.fetch('./styles.css')).status, 200);
  assert.deepEqual(transport.outbound, ['./styles.css']);
});

test('preview bootstrap reuses canonical index markup instead of duplicating product UI', async () => {
  const preview = await readFile(new URL('../../web/preview.html', import.meta.url), 'utf8');
  const bootstrap = await readFile(new URL('../../web/preview-bootstrap.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(preview, /data-operations-cards/u);
  assert.match(bootstrap, /fetch\('\.\/index\.html'/u);
  assert.match(bootstrap, /document\.body\.replaceWith\(body\)/u);
  assert.match(bootstrap, /installSyntheticPreviewTransport/u);
  assert.match(bootstrap, /только синтетические данные/u);
});

test('preview build emits static root without service worker or manifest deployment coupling', async () => {
  await rm(new URL('../../.artifacts/r2-ui-preview', import.meta.url), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/build-r2-ui-preview.mjs'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const index = await readFile(new URL('../../.artifacts/r2-ui-preview/index.html', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../../.artifacts/r2-ui-preview/app-shell.html', import.meta.url), 'utf8');
  const bootstrap = await readFile(new URL('../../.artifacts/r2-ui-preview/preview-bootstrap.mjs', import.meta.url), 'utf8');
  assert.match(index, /preview-bootstrap\.mjs/u);
  assert.match(shell, /data-operations-cards/u);
  assert.match(shell, />Только чтение</u);
  assert.match(shell, /data-state class="state" role="status" aria-live="polite" aria-atomic="true"/u);
  assert.doesNotMatch(shell, /Добавить операцию|>＋</u);
  assert.match(shell, /aria-label="Главная — скоро"/u);
  assert.doesNotMatch(shell, /href="#(?:home|analytics|more)"/u);
  assert.match(bootstrap, /fetch\('\.\/app-shell\.html'/u);
  assert.doesNotMatch(index, /manifest\.webmanifest/u);
});
