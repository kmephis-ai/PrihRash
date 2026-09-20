import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../../.github/workflows/r1-initial-bootstrap-stale-validated-terminalization.yml', import.meta.url);
const packagePath = new URL('../../package.json', import.meta.url);

test('Gate B workflow is manual, exact-run bounded, shared-lock serialized and has no automatic trigger', async () => {
  const source = await readFile(workflowPath, 'utf8');
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\n\s+(push|schedule|workflow_run):/);
  assert.match(source, /group: r1-initial-bootstrap-writer/);
  assert.match(source, /GITHUB_RUN_ATTEMPT.*'1'/);
  assert.match(source, /ALLOW_STALE_VALIDATED_MARKER_ONLY/);
  assert.match(source, /HISTORICAL_CONTROLLED_RUN_ID: '35469651936'/);
  assert.match(source, /HISTORICAL_SOURCE_SHA: acb40fb81befc548939f72146df729d27d591cbe/);
  assert.match(source, /INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED/);
  assert.match(source, /SWAP_OUTCOME_AMBIGUOUS/);
  assert.match(source, /READINESS_READY/);
  assert.match(source, /actions\/workflows\/ci\.yml/);
  assert.match(source, /Historical one-run Owner exception \(2026-09-20\)/);
});

test('Gate B provider surface reuses private function boundary and cannot blindly replay WRITE', async () => {
  const source = await readFile(workflowPath, 'utf8');
  assert.match(source, /FUNCTION_NAME: prihrash-r1-initial-bootstrap/);
  assert.match(source, /--entrypoint index\.initialBootstrapStaleValidatedTerminalizationHandler/);
  assert.match(source, /--source-path \.artifacts\/yandex-initial-bootstrap-stale-validated-terminalization-function/);
  assert.match(source, /--no-logging/);
  assert.match(source, /GATE_B_FUNCTION_PUBLIC/);
  assert.match(source, /GATE_B_FUNCTION_TRIGGER_PRESENT/);
  assert.equal((source.match(/--data '\{"mode":"WRITE"\}'/g) ?? []).length, 1);
  assert.equal((source.match(/--data '\{"mode":"RECOVER"\}'/g) ?? []).length, 1);
  assert.match(source, /GATE_B_WRITE_OUTCOME_UNKNOWN_RECOVER_READ_ONLY/);
  assert.match(source, /GATE_B_RECOVERY_REQUIRED_NO_RETRY/);
});

test('canonical check verifies the dedicated Gate B deployment package', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.match(pkg.scripts.check, /package:initial-bootstrap-stale-validated-terminalization:from-build/);
  assert.match(pkg.scripts['package:initial-bootstrap-stale-validated-terminalization:from-build'], /verify-yandex-initial-bootstrap-stale-validated-terminalization-package\.mjs/);
});
