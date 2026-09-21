import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-yandex-readiness.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_YANDEX_READINESS_RUNBOOK.md');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-readiness.mjs');
const READINESS_PROBE = resolve(ROOT, 'src/runtime/scheduledSyncReadinessProbe.ts');
const YDB_DATA_TRANSPORT = resolve(ROOT, 'src/integration/ydb/ydbJsV6DataTransport.ts');
const RESOURCE_LIMITS_PROBE = resolve(ROOT, 'src/runtime/yandexCloudYdbResourceLimits.ts');

async function text(path) {
  return readFile(path, 'utf8');
}

test('R1 readiness workflow is manual, main-only, OIDC-only and fail-closed', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch):/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /persist-credentials:\s*false/);

  assert.match(workflow, /auth\.yandex\.cloud\/oauth\/token/);
  assert.match(workflow, /token-exchange/);
  assert.match(workflow, /YC_R1_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /READINESS_OIDC_REQUEST_FAILED/);
  assert.match(workflow, /READINESS_WIF_EXCHANGE_FAILED/);
  assert.match(workflow, /READINESS_OIDC_ISSUER_MISMATCH/);
  assert.match(workflow, /READINESS_OIDC_AUDIENCE_MISMATCH/);
  assert.match(workflow, /READINESS_OIDC_SUBJECT_MISMATCH/);
  assert.match(workflow, /READINESS_OIDC_CLAIMS_INVALID/);
  assert.match(workflow, /READINESS_WIF_INVALID_REQUEST/);
  assert.match(workflow, /READINESS_WIF_INVALID_GRANT/);
  assert.match(workflow, /READINESS_WIF_INVALID_TARGET/);
  assert.match(workflow, /READINESS_WIF_UNAUTHORIZED_CLIENT/);
  assert.match(workflow, /READINESS_WIF_UNSUPPORTED_GRANT_TYPE/);
  assert.match(workflow, /--output "\$tmp\/oidc\.json"/);
  assert.match(workflow, /--output "\$tmp\/iam\.json"/);
  assert.match(workflow, /::add-mask::\$\{oidc_token\}/);
  assert.match(workflow, /OIDC_ISSUER:\s*https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(workflow, /OIDC_SUBJECT:\s*repo:kmephis-ai@310519475\/PrihRash@1359286840:ref:refs\/heads\/main/);
  assert.match(workflow, /base64 --decode >"\$tmp\/claims\.json"/);
  assert.match(workflow, /\.iss == \$expected/);
  assert.match(workflow, /\.sub == \$expected/);
  assert.match(workflow, /\.aud == \$expected/);
  assert.doesNotMatch(workflow, /cat .*\/oidc\.json|cat .*\/iam\.json|cat .*\/claims\.json/);
  assert.doesNotMatch(workflow, /echo \"\$oidc_token\"|echo \"\$token_payload\"|echo \"\$wif_error\"/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*(YC_SA_JSON|PRIVATE_KEY|AUTHORIZED_KEY)/i);

  assert.match(workflow, /index\.readinessHandler/);
  assert.doesNotMatch(workflow, /index\.handler(?:\s|$)/);
  assert.match(workflow, /--tags r1-readiness/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /serverless trigger list/);
  assert.doesNotMatch(workflow, /serverless trigger create/);
  assert.match(workflow, /npm run readiness:invoke/);
});


test('R1 readiness resource-limits-only mode uses existing runtime SA without IAM widening or YDB mutation', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /resource_limits_only:/);
  assert.match(workflow, /RESOURCE_LIMITS_ONLY: \${{ inputs\.resource_limits_only/);
  assert.match(workflow, /Fail closed if resource-limits runtime boundary is unsafe/);
  assert.match(workflow, /YDB_RESOURCE_LIMITS_MAIN_MOVED_BEFORE_DEPLOY/);
  assert.match(workflow, /YDB_RESOURCE_LIMITS_MAIN_MOVED_BEFORE_INVOKE/);
  assert.match(workflow, /RUNTIME_SERVICE_ACCOUNT_NAME:\s*prihrash-backend/);
  assert.match(workflow, /--service-account-id "\$PRIHRASH_YC_FUNCTION_SA_ID"/);
  assert.match(workflow, /--entrypoint index\.resourceLimitsHandler/);
  assert.match(workflow, /--tags r1-ydb-resource-limits/);
  assert.match(workflow, /--environment "PRIHRASH_YC_FOLDER_ID=\${YC_FOLDER_ID}"/);
  assert.match(workflow, /--metadata-options gce-http-endpoint=disabled,aws-v1-http-endpoint=disabled/);
  assert.match(workflow, /npm run resource-limits:invoke \| tee "\$tmp"/);
  assert.match(workflow, /r1-ydb-resource-limits-evidence-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /YDB_RESOURCE_LIMITS_CLASSIFIED/);
  assert.match(workflow, /SINGLE.*NONE.*AMBIGUOUS.*READ_FAILED/s);
  assert.match(workflow, /SERVERLESS.*DEDICATED.*UNKNOWN/s);
  assert.doesNotMatch(workflow, /yc ydb database (?:list|get|update|create|delete|move)\b/);
  assert.doesNotMatch(workflow, /(?:add|set)-access-binding|allow-unauthenticated-invoke/);

  const resourceDeploy = workflow.slice(
    workflow.indexOf('- name: Deploy resource-limits read-only function version'),
    workflow.indexOf('- name: Fail closed if provider boundary is unsafe'),
  );
  assert.match(resourceDeploy, /--secret "environment-variable=PRIHRASH_YDB_CONNECTION_STRING,[^\n]*key=ydb_connection_string"/);
  assert.doesNotMatch(resourceDeploy, /PRIHRASH_GOOGLE_/);
  assert.equal((resourceDeploy.match(/--secret /g) ?? []).length, 1);

  const probe = await text(RESOURCE_LIMITS_PROBE);
  assert.match(probe, /parseYdbDatabaseIdFromConnectionString/);
  assert.match(probe, /parsed\.protocol !== 'grpcs:'/);
  assert.match(probe, /parsed\.searchParams\.getAll\('database'\)/);
  assert.match(probe, /folderId !== expectedFolderId/);
  assert.match(probe, /new URL\(`\$\{YANDEX_YDB_DATABASES_API\}\/\$\{encodeURIComponent\(databaseId\)\}`\)/);
  assert.match(probe, /database\.id !== databaseId/);
  assert.match(probe, /database\.folderId !== folderId/);
  assert.doesNotMatch(probe, /searchParams\.set\('folderId'/);
  assert.doesNotMatch(probe, /pageSize/);
});

test('R1 readiness persists only allowlisted enum-only evidence while preserving invoke failure', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /id:\s*readiness-invoke/);
  assert.match(workflow, /npm run readiness:invoke \| tee "\$tmp"/);
  assert.match(workflow, /invoke_status="\$\{PIPESTATUS\[0\]\}"/);
  assert.match(workflow, /\(keys \| sort\) == \["code", "status"\]/);
  assert.match(workflow, /\(keys \| sort\) == \["code", "outputShape", "status", "transportClass"\]/);
  assert.match(workflow, /\.code != "READINESS_INVOKE_NONZERO_UNCLASSIFIED"/);
  assert.match(workflow, /\.code == "READINESS_INVOKE_NONZERO_UNCLASSIFIED"/);
  assert.match(workflow, /\^STDOUT_\(EMPTY\|TEXT\|JSON_OBJECT\|JSON_ARRAY\|JSON_STRING\|JSON_NUMBER\|JSON_BOOLEAN\|JSON_NULL\)__STDERR_/);
  assert.match(workflow, /\.transportClass \| type\) == "string"/);
  assert.match(workflow, /\^\(EMPTY\|AUTH\|NOT_FOUND\|RATE_LIMIT\|DEADLINE\|UNAVAILABLE\|FUNCTION_ERROR\|INVALID_REQUEST\|FAILED_PRECONDITION\|INTERNAL\|OTHER\)\$/);
  assert.match(workflow, /then \{status, code, outputShape, transportClass\}/);
  assert.match(workflow, /else \{status, code\}/);
  assert.match(workflow, /READINESS_READY/);
  assert.match(workflow, /READINESS_INVOKE_FUNCTION_TIMEOUT/);
  assert.match(workflow, /READINESS_GOOGLE_SOURCE_READ_FAILED/);
  assert.match(workflow, /READINESS_YDB_MIGRATION_EVIDENCE_READ_FAILED/);
  assert.match(workflow, /READINESS_EVIDENCE_INVALID/);
  assert.match(workflow, /exit "\$invoke_status"/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /steps\.readiness-invoke\.outcome == 'success'/);
  assert.match(workflow, /steps\.readiness-invoke\.outcome == 'failure'/);
  assert.match(workflow, /r1-yandex-readiness-evidence-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /r1-yandex-readiness-evidence\/classification\.json/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /retention-days:\s*30/);
});

test('R1 readiness timeout envelopes preserve the bounded application deadline with transport headroom', async () => {
  const [workflow, invoker, probe, transport, runbook] = await Promise.all([
    text(WORKFLOW),
    text(INVOKER),
    text(READINESS_PROBE),
    text(YDB_DATA_TRANSPORT),
    text(RUNBOOK),
  ]);

  assert.match(probe, /SCHEDULED_SYNC_READINESS_DEADLINE_MS = 20_000 as const/);
  assert.match(probe, /SCHEDULED_SYNC_READINESS_YDB_READY_TIMEOUT_MS = 10_000 as const/);
  assert.match(probe, /readyTimeoutMs: SCHEDULED_SYNC_READINESS_YDB_READY_TIMEOUT_MS/);
  assert.match(probe, /SCHEDULED_SYNC_READINESS_YDB_READ_TIMEOUT_MS = 21_000 as const/);
  assert.match(probe, /readTimeoutMs: SCHEDULED_SYNC_READINESS_YDB_READ_TIMEOUT_MS/);
  assert.match(probe, /SCHEDULED_SYNC_READINESS_CLOSE_TIMEOUT_MS = 2_000 as const/);
  assert.match(transport, /query = query\.timeout\(timeoutMs\)/);
  assert.match(transport, /executeStatement<Row>\(\s*transaction,\s*statement,\s*mapParameter,\s*undefined,\s*\(error\) =>/);
  assert.match(workflow, /--execution-timeout 45s/);
  assert.match(invoker, /const INVOKE_TIMEOUT_MS = 60_000;/);
  assert.match(runbook, /execution timeout: 45s/);
  assert.match(runbook, /application deadline: 20s, YDB Driver ready cancellation: 10s/);
  assert.match(runbook, /invoker transport timeout: 60s/);
});

test('R1 readiness workflow proves the exact WIF service account can invoke while staying private', async () => {
  const workflow = await text(WORKFLOW);

  assert.equal((workflow.match(/READINESS_PROVIDER_INVOKER_BINDING_MISSING/g) ?? []).length, 2);
  assert.equal((workflow.match(/--arg expected "\$YC_WIF_SERVICE_ACCOUNT_ID"/g) ?? []).length, 3);
  assert.equal((workflow.match(/\.type == "serviceAccount" and \.id == \$expected/g) ?? []).length, 3);
  assert.match(workflow, /allUsers/);
  assert.match(workflow, /allAuthenticatedUsers/);
  assert.doesNotMatch(workflow, /add-access-binding|set-access-bindings|allow-unauthenticated-invoke/);
});

test('R1 readiness workflow never transports Lockbox payload through GitHub', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /LOCKBOX_SECRET_NAME:\s*prihrash-r1-readiness/);
  assert.match(workflow, /google_service_account_private_key/);
  assert.match(workflow, /--secret /);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*(GOOGLE|PRIVATE|YDB_CONNECTION|LOCKBOX_PAYLOAD)/);
  assert.doesNotMatch(workflow, /--environment[^\n]*(GOOGLE|YDB)/i);
});

test('canonical runbook binds WIF identity to immutable exact repository main subject', async () => {
  const runbook = await text(RUNBOOK);

  assert.match(runbook, /repo:kmephis-ai@310519475\/PrihRash@1359286840:ref:refs\/heads\/main/);
  assert.match(runbook, /issuer: https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(runbook, /audience: https:\/\/github\.com\/kmephis-ai/);
  assert.match(runbook, /YC_R1_FOLDER_ID/);
  assert.match(runbook, /YC_R1_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(runbook, /Long-lived Yandex authorized key\/OAuth token в GitHub не используется/);
});
