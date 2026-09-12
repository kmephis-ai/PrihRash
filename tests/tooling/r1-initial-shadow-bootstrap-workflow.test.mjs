import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-shadow-bootstrap.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md');
const PACKAGE_SCRIPT = resolve(ROOT, 'scripts/package-yandex-initial-bootstrap-function.mjs');
const PACKAGE_VERIFY = resolve(ROOT, 'scripts/verify-yandex-initial-bootstrap-package.mjs');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap.mjs');

async function text(path) {
  return readFile(path, 'utf8');
}

test('initial shadow bootstrap workflow is manual main-only and structurally gated by #433 plus exact-sha readiness', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch):/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /issues:\s*read/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /issues\/433/);
  assert.match(workflow, /\.state == "closed"/);
  assert.match(workflow, /\.protected == true/);
  assert.match(workflow, /actions\/workflows\/r1-yandex-readiness\.yml\/runs/);
  assert.match(workflow, /\.head_sha == \$sha/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_EXACT_SHA_READINESS_MISSING/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_MAIN_MOVED_BEFORE_DEPLOY/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_MAIN_MOVED_BEFORE_INVOKE/);
});

test('initial shadow bootstrap workflow uses only dedicated WIF, Function, runtime and Lockbox locators', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /FUNCTION_NAME:\s*prihrash-r1-initial-bootstrap/);
  assert.match(workflow, /RUNTIME_SERVICE_ACCOUNT_NAME:\s*prihrash-initial-bootstrap/);
  assert.match(workflow, /LOCKBOX_SECRET_NAME:\s*prihrash-r1-initial-bootstrap/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID/);
  assert.doesNotMatch(workflow, /YC_R1_SCHEMA_UPGRADE_003_WIF_SERVICE_ACCOUNT_ID|YC_R1_SCHEMA_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /OIDC_SUBJECT:\s*repo:kmephis-ai@310519475\/PrihRash@1359286840:ref:refs\/heads\/main/);
});

test('workflow deploys a private trigger-free bootstrap-only version with exact server-side secret bindings', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /\.artifacts\/yandex-initial-bootstrap-function/);
  assert.match(workflow, /index\.initialBootstrapHandler/);
  assert.match(workflow, /--tags r1-initial-bootstrap/);
  assert.match(workflow, /--memory 256m/);
  assert.match(workflow, /--execution-timeout 150s/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /serverless trigger list/);
  assert.doesNotMatch(workflow, /serverless trigger create/);
  for (const key of [
    'google_spreadsheet_id',
    'google_service_account_email',
    'google_service_account_private_key',
    'ydb_connection_string',
    'initial_bootstrap_private_historical_evidence',
  ]) {
    assert.match(workflow, new RegExp(`key=${key}`));
  }
  assert.match(workflow, /npm run initial-bootstrap:invoke/);
  assert.doesNotMatch(workflow, /npm run (?:readiness|schema-bootstrap|schema-upgrade-003):invoke/);
});

test('bootstrap package exports only the dedicated handler and removes scheduled/schema runtime entrypoints', async () => {
  const packageScript = await text(PACKAGE_SCRIPT);
  const verifier = await text(PACKAGE_VERIFY);

  assert.match(packageScript, /export \{ initialBootstrapHandler \}/);
  assert.match(packageScript, /ALLOWED_RUNTIME_BASENAMES/);
  assert.match(packageScript, /initialBootstrapJob\.js/);
  assert.match(packageScript, /yandexCloudInitialBootstrapFunction\.js/);
  assert.match(verifier, /runtime surface is not bootstrap-only/);
  assert.match(verifier, /yandexCloudScheduledSyncFunction\.js/);
  assert.match(verifier, /scheduledSyncJob\.js/);
  assert.match(verifier, /yandexCloudSchemaBootstrapFunction\.js/);
  assert.match(verifier, /yandexCloudSchemaUpgrade003Function\.js/);
  assert.match(verifier, /ydbJsV6SchemaBootstrapClient\.js/);
});

test('bootstrap invoker is retry-zero, exact-tag and never classifies non-PASS as success', async () => {
  const invoker = await text(INVOKER);

  assert.match(invoker, /BOOTSTRAP_TAG = 'r1-initial-bootstrap'/);
  assert.match(invoker, /'--retry', '0'/);
  assert.match(invoker, /'--no-user-output'/);
  assert.match(invoker, /if \(result\.status !== 'PASS'\) process\.exitCode = 2/);
  assert.doesNotMatch(invoker, /capturedErrorField|SAFE_FAILURE_CODE_BY_MARKER/);
});

test('runbook keeps Google authoritative, forbids blind retry/timer and requires retirement after committed reconciliation', async () => {
  const runbook = await text(RUNBOOK);

  assert.match(runbook, /Google authoritative → YDB shadow/);
  assert.match(runbook, /Ответы на форму \(11\)/);
  assert.match(runbook, /#433/);
  assert.match(runbook, /main\.protected=true/);
  assert.match(runbook, /READINESS_READY/);
  assert.match(runbook, /INITIAL_BOOTSTRAP_COMMITTED/);
  assert.match(runbook, /independent post-COMMITTED/);
  assert.match(runbook, /Не делать blind retry/);
  assert.match(runbook, /`ydb\.editor`/);
  assert.match(runbook, /Retirement после successful bootstrap/);
  assert.match(runbook, /Timer остаётся выключен|timer всё ещё выключен/);
  assert.match(runbook, /YDB остаётся shadow/);
  assert.doesNotMatch(runbook, /auto-rebuild.*разреш/u);
});
