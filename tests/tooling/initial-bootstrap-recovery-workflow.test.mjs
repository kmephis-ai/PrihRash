import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery.yml', 'utf8');
const packageScript = await readFile('scripts/package-yandex-initial-bootstrap-recovery-function.mjs', 'utf8');
const verifier = await readFile('scripts/verify-yandex-initial-bootstrap-recovery-package.mjs', 'utf8');
const invoker = await readFile('scripts/invoke-yandex-initial-bootstrap-recovery.mjs', 'utf8');

test('initial bootstrap recovery workflow stays manual-only and exact-main guarded', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_MAIN_MOVED_BEFORE_INVOKE/);
  assert.match(workflow, /EXPECTED_FAILED_BOOTSTRAP_RUN_ID: '34806405103'/);
  assert.match(workflow, /EXPECTED_FAILED_BOOTSTRAP_SHA: 2bb070e9c155a460ce06c4e76a3f29708c8b0f73/);
  assert.match(workflow, /actions\/runs\/\$\{EXPECTED_FAILED_BOOTSTRAP_RUN_ID\}/);
  assert.match(workflow, /\.head_sha == \$expected_sha/);
  assert.match(workflow, /Invoke exact initial bootstrap tag once/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILURE_NOT_PROVEN/);
  assert.doesNotMatch(workflow, /\.head_sha == \$sha/);
  assert.match(workflow, /\.conclusion == "failure"/);
  assert.doesNotMatch(workflow, /r1-initial-bootstrap-recovery-diagnostic/);
});

test('initial bootstrap recovery deploy keeps the same single read-only provider path', () => {
  assert.match(workflow, /--entrypoint index\.initialBootstrapRecoveryHandler/);
  assert.match(workflow, /--memory 256m/);
  assert.match(workflow, /--execution-timeout 150s/);
  assert.match(workflow, /--tags r1-initial-bootstrap-recovery/);
  assert.match(workflow, /environment-variable=PRIHRASH_YDB_CONNECTION_STRING/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SPREADSHEET_ID/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /environment-variable=PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.match(workflow, /npm run initial-bootstrap-recovery:invoke/);
});

test('initial bootstrap recovery invoker exposes enum-only classification evidence', () => {
  assert.match(invoker, /INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/);
  assert.match(invoker, /INVOKE_TIMEOUT_MS = 180_000/);
  assert.match(invoker, /exactKeys\(result, \['status', 'code', 'verdict', 'reason'\]\)/);
  assert.match(invoker, /COMMITTED_DURABLE_STATE/);
  assert.match(invoker, /RESIDUAL_REFERENCE_STATE_WITHOUT_RUN/);
  assert.match(invoker, /RESIDUAL_MIXED_STATE_WITHOUT_RUN/);
  assert.match(invoker, /RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE/);
  assert.match(invoker, /RESIDUAL_REFERENCE_STATE_MISMATCH/);
  assert.match(invoker, /REFERENCE_RECONCILIATION_FAILED/);
  assert.doesNotMatch(invoker, /row_count|rows_seen|committedRowsSeen|sourceRecords/);
});

test('initial bootstrap recovery package excludes write-capable runtime entrypoints', () => {
  assert.match(packageScript, /initialBootstrapRecoveryJob\.js/);
  assert.match(packageScript, /yandexCloudInitialBootstrapRecoveryFunction\.js/);
  assert.doesNotMatch(packageScript, /'initialBootstrapJob\.js'/);
  assert.match(verifier, /initialBootstrapResidualSurface\.js/);
  assert.match(verifier, /initialBootstrapReferenceReconciliation\.js/);
  assert.match(verifier, /initialBootstrapReferenceSemantics\.js/);
  assert.match(verifier, /recovery module contains a write-capable statement or transaction call/);
  assert.match(verifier, /dist\/runtime\/yandexCloudInitialBootstrapFunction\.js/);
  assert.match(verifier, /dist\/runtime\/scheduledSyncJob\.js/);
});
