import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/dependency-review.yml', import.meta.url);
const docsUrl = new URL('../../docs/QUALITY_SECURITY_GATES.md', import.meta.url);
const workflowsUrl = new URL('../../.github/workflows/', import.meta.url);

test('dependency review is pull-request-only, read-only, pinned and independent', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /^name: Dependency Review$/m);
  assert.match(workflow, /on:\n  pull_request:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /name: dependency-review/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /actions\/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48/);
  assert.match(workflow, /fail-on-severity: high/);
  assert.doesNotMatch(workflow, /workflow_dispatch|schedule:|push:|id-token: write|contents: write|pull-requests: write/);
  assert.doesNotMatch(workflow, /npm run check|playwright|initial-bootstrap|yandex|YDB|GOOGLE/);
});

test('CodeQL remains provider-managed Default Setup with fail-closed reassessment', async () => {
  const docs = await readFile(docsUrl, 'utf8');
  const workflowNames = await readdir(workflowsUrl);

  assert.match(docs, /CodeQL Default Setup/);
  assert.match(docs, /BLOCKED\/REASSESS/);
  assert.match(docs, /Do not add a custom\/Advanced CodeQL workflow/);
  assert.equal(workflowNames.some((name) => /codeql/i.test(name)), false);
});
