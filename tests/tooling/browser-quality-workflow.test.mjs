import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/browser-quality.yml');
const CONFIG = resolve(ROOT, 'playwright.config.mjs');
const SUITE = resolve(ROOT, 'tests/browser/critical-flows.spec.mjs');
const PACKAGE_JSON = resolve(ROOT, 'package.json');
const PREVIEW_BUILD = resolve(ROOT, 'scripts/build-r2-ui-preview.mjs');

async function text(path) {
  return readFile(path, 'utf8');
}

test('browser quality stays separate from canonical check and pins one Chromium Playwright version', async () => {
  const packageJson = JSON.parse(await text(PACKAGE_JSON));
  const config = await text(CONFIG);

  assert.equal(packageJson.devDependencies['@playwright/test'], '1.63.0');
  assert.equal(packageJson.scripts['test:browser'], 'npm run preview:build --silent && playwright test --config=playwright.config.mjs');
  assert.doesNotMatch(packageJson.scripts.check, /test:browser|playwright/u);
  assert.match(config, /browserName:\s*'chromium'/u);
  assert.doesNotMatch(config, /firefox|webkit/iu);
  assert.match(config, /trace:\s*'retain-on-failure'/u);
  assert.match(config, /screenshot:\s*'only-on-failure'/u);
  assert.match(config, /workers:\s*1/u);
});

test('browser workflow runs independently on PR/main and uploads only failure diagnostics', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/u);
  assert.match(workflow, /contents:\s*read/u);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u);
  assert.match(workflow, /playwright install --with-deps chromium/u);
  assert.match(workflow, /npm run test:browser/u);
  assert.match(workflow, /if:\s*failure\(\)/u);
  assert.match(workflow, /retention-days:\s*3/u);
  assert.doesNotMatch(workflow, /firefox|webkit|Yandex|YDB|google.*credential/iu);
});

test('browser critical suite covers responsive Reader, durable offline outbox, validated ACK and optimistic conflict', async () => {
  const suite = await text(SUITE);
  const previewBuild = await text(PREVIEW_BUILD);

  assert.match(suite, /pageerror/u);
  assert.match(suite, /message\.type\(\) === 'error'/u);
  assert.match(suite, /width:\s*390,\s*height:\s*844/u);
  assert.match(suite, /data-filter-type/u);
  assert.match(suite, /data-load-more/u);
  assert.match(suite, /setOffline\(true\)/u);
  assert.match(suite, /CREATE_EXPENSE/u);
  assert.match(suite, /CREATE_INCOME/u);
  assert.match(suite, /INVALID_PREVIEW_EXPENSE_ACK/u);
  assert.match(suite, /deliverPreviewExpenseIntent/u);
  assert.match(suite, /Ничего не перезаписано/u);
  assert.match(suite, /Нажмите «Сохранить изменения» ещё раз/u);
  assert.match(suite, /\[browser-metric\]/u);
  assert.match(previewBuild, /preview-writer-delivery\.mjs/u);
  assert.match(previewBuild, /preview-income-writer-delivery\.mjs/u);
  assert.match(previewBuild, /preview-transfer-writer-delivery\.mjs/u);
});
