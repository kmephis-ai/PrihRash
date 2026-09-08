import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

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
  assert.match(app, /Счёт и категория недоступны/u);
  assert.match(sw, /prihrash-shell-v5/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});
