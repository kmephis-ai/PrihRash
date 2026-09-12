import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery.yml', 'utf8');
const packageScript = await readFile('scripts/package-yandex-initial-bootstrap-recovery-function.mjs', 'utf8');
const verifier = await readFile('scripts/verify-yandex-initial-bootstrap-recovery-package.mjs', 'utf8');

test('initial bootstrap recovery workflow is manual-only and exact-main guarded', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_MAIN_MOVED_BEFORE_INVOKE/);
  assert.match(workflow, /r1-initial-shadow-bootstrap\.yml\/runs/);
  assert.match(workflow, /\.conclusion == "failure"/);
});

test('initial bootstrap recovery deploy exposes only YDB secret to recovery handler', () => {
  assert.match(workflow, /--entrypoint index\.initialBootstrapRecoveryHandler/);
  assert.match(workflow, /--tags r1-initial-bootstrap-recovery/);
  assert.match(workflow, /environment-variable=PRIHRASH_YDB_CONNECTION_STRING/);
  assert.doesNotMatch(workflow, /environment-variable=PRIHRASH_GOOGLE_/);
  assert.doesNotMatch(workflow, /environment-variable=PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.match(workflow, /npm run initial-bootstrap-recovery:invoke/);
});

test('initial bootstrap recovery package excludes write-capable runtime entrypoints', () => {
  assert.match(packageScript, /initialBootstrapRecoveryJob\.js/);
  assert.match(packageScript, /yandexCloudInitialBootstrapRecoveryFunction\.js/);
  assert.doesNotMatch(packageScript, /'initialBootstrapJob\.js'/);
  assert.match(verifier, /recovery probe contains a write-capable statement or transaction call/);
  assert.match(verifier, /dist\/runtime\/yandexCloudInitialBootstrapFunction\.js/);
  assert.match(verifier, /dist\/runtime\/scheduledSyncJob\.js/);
});
