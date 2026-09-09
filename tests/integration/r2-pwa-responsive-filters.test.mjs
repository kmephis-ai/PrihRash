import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Reader filter layout keeps four canonical controls readable across tablet and desktop widths', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../web/styles.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../web/app.mjs', import.meta.url), 'utf8');

  for (const selector of ['type', 'status', 'account', 'category']) {
    assert.match(html, new RegExp(`data-filter-${selector}`, 'u'));
  }

  assert.match(css, /\.filters \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(css, /\.filter-reset \{ grid-column: 1 \/ -1;/u);
  assert.match(css, /\.filter-options-state \{ grid-column: 1 \/ -1; \}/u);
  assert.match(
    css,
    /@media \(min-width: 760px\) \{[\s\S]*?\.filters \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}[\s\S]*?\.filter-reset \{ grid-column: auto; \}/u,
  );
  assert.doesNotMatch(css, /grid-template-columns: 1fr 1fr auto/u);

  assert.doesNotMatch(app, /matchMedia|innerWidth|outerWidth/u);
});
