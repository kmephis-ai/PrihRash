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
const REFERENCE_AWARE_RUNTIME = resolve(ROOT, 'src/runtime/initialBootstrapReferenceAwareJob.ts');

async function text(path) {
  return (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
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
  assert.match(workflow, /--execution-timeout 600s/);
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

test('reached bootstrap invoke publishes one short-lived enum-only artifact without changing retry semantics', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /id:\s*bootstrap-invoke/);
  assert.match(workflow, /npm run initial-bootstrap:invoke \| tee/);
  assert.match(workflow, /invoke_status="\$\{PIPESTATUS\[0\]\}"/);
  assert.match(workflow, /exit "\$invoke_status"/);
  assert.match(workflow, /runtimeCode:/);
  assert.match(workflow, /REFERENCE_APPLICATION_YDB_DATA_FAILED/);
  assert.match(workflow, /REFERENCE_FUNCTION_MODULE_LOAD_FAILED/);
  assert.match(workflow, /REFERENCE_FUNCTION_HANDLER_UNCAUGHT/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED/);
  assert.match(workflow, /httpStatus:/);
  assert.match(workflow, /functionError:/);
  for (const httpStatus of [
    'HTTP_400',
    'HTTP_403',
    'HTTP_404',
    'HTTP_413',
    'HTTP_429',
    'HTTP_500',
    'HTTP_502',
    'HTTP_503',
    'HTTP_504',
    'HTTP_4XX_OTHER',
    'HTTP_5XX_OTHER',
    'HTTP_OTHER',
  ]) {
    assert.match(workflow, new RegExp(`"${httpStatus}"`));
  }
  assert.match(workflow, /\.functionError \| IN\("PRESENT", "ABSENT"\)/);
  assert.match(
    workflow,
    /\$code != "INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED"[\s\S]*?\(\.httpStatus \| type\) == "string"[\s\S]*?\(\.functionError \| type\) == "string"/,
  );
  assert.match(workflow, /Publish enum-only bootstrap evidence/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /r1-initial-bootstrap-evidence-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /r1-initial-bootstrap-evidence\/classification\.json/);
  assert.match(workflow, /retention-days:\s*30/);
  assert.doesNotMatch(workflow, /--retry\s+[1-9]/);

  const projection = workflow.match(/\| \{[\s\S]*?\n\s+\}\n\s+' > "\$candidate"/)?.[0];
  assert.ok(projection, 'enum-only evidence projection must remain explicit');
  assert.match(projection, /status: \$status/);
  assert.match(projection, /code: \$code/);
  assert.match(projection, /runtimeCode:/);
  assert.match(projection, /httpStatus:/);
  assert.match(projection, /functionError:/);
  assert.doesNotMatch(projection, /\.(?:stdout|stderr|message|payload|details)\b/i);
});

test('bootstrap execution envelope gives provider timeout precedence without enabling retries', async () => {
  const workflow = await text(WORKFLOW);
  const invoker = await text(INVOKER);

  assert.match(workflow, /--execution-timeout 600s/);
  assert.match(invoker, /INVOKE_TIMEOUT_MS = 630_000/);
  assert.doesNotMatch(workflow, /--retry\s+[1-9]/);
});

test('bootstrap package exports only dedicated bootstrap handlers and removes scheduled/schema runtime entrypoints', async () => {
  const packageScript = await text(PACKAGE_SCRIPT);
  const verifier = await text(PACKAGE_VERIFY);

  assert.match(packageScript, /export async function initialBootstrapHandler/);
  assert.match(packageScript, /export async function initialBootstrapGateCHandler/);
  assert.match(packageScript, /await import\('\.\/dist\/runtime\/yandexCloudInitialBootstrapFunction\.js'\)/);
  assert.match(packageScript, /REFERENCE_FUNCTION_MODULE_LOAD_FAILED/);
  assert.match(packageScript, /REFERENCE_FUNCTION_HANDLER_UNCAUGHT/);
  assert.doesNotMatch(packageScript, /catch \(error\)/);
  assert.match(packageScript, /ALLOWED_RUNTIME_BASENAMES/);
  assert.match(packageScript, /initialBootstrapJob\.js/);
  assert.match(packageScript, /yandexCloudInitialBootstrapFunction\.js/);
  assert.match(verifier, /bootstrap runtime module import failed/);
  assert.match(verifier, /pathToFileURL/);
  assert.match(verifier, /runtime surface is not bootstrap-only/);
  assert.match(verifier, /yandexCloudScheduledSyncFunction\.js/);
  assert.match(verifier, /scheduledSyncJob\.js/);
  assert.match(verifier, /yandexCloudSchemaBootstrapFunction\.js/);
  assert.match(verifier, /yandexCloudSchemaUpgrade003Function\.js/);
  assert.match(verifier, /yandexCloudSchemaUpgrade004Function\.js/);
  assert.match(verifier, /ydbJsV6SchemaBootstrapClient\.js/);
});

test('bootstrap invoker uses one private HTTPS raw invocation and exposes only bounded privacy-safe HTTP failure taxonomy', async () => {
  const invoker = await text(INVOKER);

  assert.match(invoker, /BOOTSTRAP_TAG = 'r1-initial-bootstrap'/);
  assert.match(invoker, /FUNCTIONS_ORIGIN = 'https:\/\/functions\.yandexcloud\.net'/);
  assert.match(invoker, /url\.searchParams\.set\('tag', BOOTSTRAP_TAG\)/);
  assert.match(invoker, /url\.searchParams\.set\('integration', 'raw'\)/);
  assert.match(invoker, /method: 'POST'/);
  assert.match(invoker, /Authorization: `Bearer \${iamToken}`/);
  assert.match(invoker, /INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED/);
  assert.match(invoker, /HTTP_502/);
  assert.match(invoker, /x-function-error/);
  assert.match(invoker, /if \(response\.status !== 200\)/);
  assert.match(invoker, /response\.body\.cancel/);
  assert.match(invoker, /if \(result\.status !== 'PASS'\) process\.exitCode = 2/);
  assert.doesNotMatch(invoker, /serverless['"],\s*['"]function['"],\s*['"]invoke/);
  assert.doesNotMatch(invoker, /INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED|transportClass|outputShape/);
});

test('runbook keeps Google authoritative, forbids blind retry/timer and requires retirement after committed reconciliation', async () => {
  const runbook = await text(RUNBOOK);

  assert.match(runbook, /Google authoritative → YDB shadow/);
  assert.match(runbook, /Root-cause correction for post-invoke HTTP 502/);
  assert.match(runbook, /EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN/);
  assert.match(runbook, /removes the duplicate full projection and releases the raw lease/);
  assert.match(runbook, /Ответы на форму \(11\)/);
  assert.match(runbook, /#433/);
  assert.match(runbook, /main\.protected=true/);
  assert.match(runbook, /READINESS_READY/);
  assert.match(runbook, /INITIAL_BOOTSTRAP_COMMITTED/);
  assert.match(runbook, /independent post-COMMITTED/);
  assert.match(runbook, /Не делать blind retry/);
  assert.match(runbook, /`ydb\.editor`/);
  assert.match(runbook, /`functions\.auditor` только на target PrihRash folder/u);
  assert.match(runbook, /снять temporary folder-scoped `functions\.auditor`/u);
  assert.match(runbook, /Retirement после successful bootstrap/);
  assert.match(runbook, /Timer остаётся выключен|timer всё ещё выключен/);
  assert.match(runbook, /YDB остаётся shadow/);
  assert.doesNotMatch(runbook, /auto-rebuild.*разреш/u);
});


test('STAGING resume releases no-longer-needed reference planning state before application work', async () => {
  const runtime = await text(REFERENCE_AWARE_RUNTIME);

  assert.match(
    runtime,
    /function releaseReferencePlanningState\(\): void \{\s*primitives = null;\s*referenceRows = null;\s*referencePlan = null;\s*\}/s,
  );
  assert.match(
    runtime,
    /if \(referencePlan\.writes\.length === 0\) \{\s*releaseReferencePlanningState\(\);\s*return runApplicationSafely\(observation, dependencies, runApplication\);\s*\}/s,
  );
  assert.match(
    runtime,
    /isInitialBootstrapResidualReferenceRecoveryAuthorized\([\s\S]*?\)\) \{\s*throw new InitialBootstrapReferenceAwareRuntimeError\('REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE'\);\s*\}\s*releaseReferencePlanningState\(\);\s*return runApplicationSafely\(observation, dependencies, runApplication\);/s,
  );
});

test('initial bootstrap reuses canonical observation for reference planning and releases the full source lease', async () => {
  const job = await text(new URL('../../src/runtime/initialBootstrapJob.ts', import.meta.url));
  const runtime = await text(REFERENCE_AWARE_RUNTIME);

  assert.match(job, /async function readInitialBootstrapObservation\([\s\S]*?const source = runtime\.createSource\([\s\S]*?const lease = await source\.readFullSnapshotObservation\(\);[\s\S]*?return buildInitialBootstrapObservation\([\s\S]*?\);\n\}/);
  assert.match(job, /const observation = await readInitialBootstrapObservation\([\s\S]*?runtime\.readReferenceResolver\(adapter, observation\)/);
  assert.doesNotMatch(runtime, /let lease:|let digest:/);
  assert.doesNotMatch(runtime, /projectGoogleSnapshotForIncrementalMigration/);
  assert.match(runtime, /observation\.rows\.map\(\(row, sourceOrdinal\) => Object\.freeze\(\{\s*sourceOrdinal,\s*rawPayload: row\.rawPayload/);
});
