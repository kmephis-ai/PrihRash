import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { operationCardsMarkup, operationTableRowsMarkup } from '../../web/operation-markup.mjs';

const ITEM = Object.freeze({
  id: '00000000-0000-0000-0000-000000000901',
  typeLabel: 'Расход',
  amountLabel: '1 234,50 ₽',
  dateLabel: '2026-09-08',
  description: '<Продукты & дом>',
  meta: 'Visa <main> · Продукты',
  quality: Object.freeze(['Аннулировано', 'Исторический агрегат']),
});

test('mobile cards and desktop rows use the same presentation item without a second financial mapping', () => {
  const cards = operationCardsMarkup([ITEM]);
  const rows = operationTableRowsMarkup([ITEM]);

  for (const markup of [cards, rows]) {
    assert.match(markup, /data-operation-id="00000000-0000-0000-0000-000000000901"/u);
    assert.match(markup, /&lt;Продукты &amp; дом&gt;/u);
    assert.match(markup, /Visa &lt;main&gt; · Продукты/u);
    assert.match(markup, /1 234,50 ₽/u);
    assert.match(markup, /Аннулировано/u);
    assert.match(markup, /Исторический агрегат/u);
    assert.doesNotMatch(markup, /<Продукты & дом>/u);
  }

  assert.match(cards, /operation-card/u);
  assert.match(rows, /operation-table__date/u);
  assert.match(rows, /operation-table__amount/u);
});

test('desktop row keeps an explicit neutral quality cell when no warning exists', () => {
  const rows = operationTableRowsMarkup([{ ...ITEM, quality: [] }]);
  assert.match(rows, /operation-table__quality">—<\/td>/u);
});

test('PWA shell exposes responsive semantic table and mobile cards with one Reader state machine', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../web/styles.css', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');

  assert.match(html, /data-operations-cards/u);
  assert.match(html, /<table class="operations-table">/u);
  assert.match(html, /<caption class="visually-hidden">Последние операции<\/caption>/u);
  for (const heading of ['Дата', 'Операция', 'Тип', 'Контекст', 'Сумма', 'Качество']) assert.match(html, new RegExp(`scope="col">${heading}<`, 'u'));
  assert.match(html, /data-operations-table/u);

  assert.match(app, /createRecentOperationsView\(\{ cache, fetchRecent, render, append, setStatus, setPagination \}\)/u);
  assert.match(app, /cardList\.innerHTML = operationCardsMarkup\(items\)/u);
  assert.match(app, /tableBody\.innerHTML = operationTableRowsMarkup\(items\)/u);
  assert.match(app, /cardList\.insertAdjacentHTML\('beforeend', operationCardsMarkup\(items\)\)/u);
  assert.match(app, /tableBody\.insertAdjacentHTML\('beforeend', operationTableRowsMarkup\(items\)\)/u);

  assert.match(css, /\.operations-table-wrap \{ display: none; \}/u);
  assert.match(css, /@media \(min-width: 760px\)/u);
  assert.match(css, /\.operations--cards \{ display: none; \}/u);
  assert.match(css, /\.operations-table-wrap \{ display: block;/u);
  assert.match(css, /overflow-x: auto/u);
  assert.match(css, /font-variant-numeric: tabular-nums/u);

  assert.match(sw, /prihrash-shell-v21/u);
  assert.match(sw, /'\/operation-markup\.mjs'/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});
