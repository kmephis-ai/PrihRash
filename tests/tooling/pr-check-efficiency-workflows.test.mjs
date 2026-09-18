import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const prCheckWorkflows = [
  'ci.yml',
  'browser-quality.yml',
  'r2-ui-preview.yml',
];

const nonCancelableProviderWorkflows = [
  'r1-yandex-readiness.yml',
  'r1-initial-shadow-bootstrap.yml',
  'r1-initial-bootstrap-recovery.yml',
  'r1-initial-bootstrap-orchestrator.yml',
  'r1-initial-bootstrap-autocontinue.yml',
  'r1-initial-bootstrap-recovery-autocontinue.yml',
  'r1-ydb-schema-bootstrap.yml',
  'r1-ydb-schema-upgrade-003.yml',
];

async function workflow(name) {
  return readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
}

test('ordinary PR checks cache npm downloads and cancel only superseded PR runs', async () => {
  for (const name of prCheckWorkflows) {
    const source = await workflow(name);
    assert.match(source, /pull_request:/);
    if (name !== 'r2-ui-preview.yml') {
      assert.match(source, /push:\s*\n\s*branches:\s*\[main\]/);
    }
    assert.match(source, /cache:\s*npm/);
    assert.match(source, /cache-dependency-path:\s*package-lock\.json/);
    assert.match(source, /group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.head_ref \|\| github\.run_id \}\}/);
    assert.match(source, /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/);
  }
});

test('optional R2 preview runs only for UI changes or an explicit dispatch', async () => {
  const source = await workflow('r2-ui-preview.yml');
  assert.doesNotMatch(source, /\n\s*push:/);
  assert.match(source, /pull_request:\s*\n\s*paths:/);
  assert.match(source, /web\/\*\*/);
  assert.match(source, /workflow_dispatch:/);
});

test('R1 provider and recovery workflows remain explicitly non-cancelable', async () => {
  for (const name of nonCancelableProviderWorkflows) {
    const source = await workflow(name);
    assert.match(source, /cancel-in-progress:\s*false/);
    assert.doesNotMatch(source, /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/);
  }
});
