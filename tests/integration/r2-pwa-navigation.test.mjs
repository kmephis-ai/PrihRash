import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('R2 top-level navigation exposes only Operations as an interactive destination', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/u)?.[0];
  assert.ok(nav);
  assert.equal((nav.match(/<a\b/gu) ?? []).length, 1);
  assert.match(nav, /<a class="nav-item active" href="#operations" aria-current="page">Операции<\/a>/u);
  assert.doesNotMatch(nav, /href="#(?:home|analytics|more)"/u);
});

test('future navigation items remain visible but explicitly unavailable', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/u)?.[0];
  assert.ok(nav);
  assert.equal((nav.match(/class="nav-item nav-item--future"/gu) ?? []).length, 3);
  assert.equal((nav.match(/aria-disabled="true"/gu) ?? []).length, 3);
  for (const label of ['Главная', 'Аналитика', 'Ещё']) {
    assert.match(nav, new RegExp(`aria-label="${label} — скоро"[^>]*>${label}<\\/span>`, 'u'));
  }
});

test('navigation styling preserves four-slot bottom layout and distinguishes future items', async () => {
  const css = await readFile(new URL('../../web/styles.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns: repeat\(4, 1fr\)/u);
  assert.match(css, /\.bottom-nav \.nav-item--future/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
});
