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
  assert.match(workflow, /\^\(EMPTY\|AUTH\|NOT_FOUND\|RATE_LIMIT\|DEADLINE\|UNAVAILABLE\|INVALID_REQUEST\|FAILED_PRECONDITION\|INTERNAL\|OTHER\)\$/);
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
  assert.match(workflow, /retention-days:\s*1/);
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
  assert.match(probe, /SCHEDULED_SYNC_READINESS_YDB_READ_TIMEOUT_MS = 21_000 as const/);
  assert.match(probe, /readTimeoutMs: SCHEDULED_SYNC_READINESS_YDB_READ_TIMEOUT_MS/);
  assert.match(probe, /SCHEDULED_SYNC_READINESS_CLOSE_TIMEOUT_MS = 2_000 as const/);
  assert.match(transport, /query = query\.timeout\(timeoutMs\)/);
  assert.match(transport, /executeStatement<Row>\(transaction, statement, mapParameter\);/);
  assert.match(workflow, /--execution-timeout 45s/);
  assert.match(invoker, /const INVOKE_TIMEOUT_MS = 60_000;/);
  assert.match(runbook, /execution timeout: 45s/);
  assert.match(runbook, /application deadline: 20s/);
  assert.match(runbook, /invoker transport timeout: 60s/);
});

test('R1 readiness workflow proves the exact WIF service account can invoke while staying private', async () => {
  const workflow = await text(WORKFLOW);

  assert.equal((workflow.match(/READINESS_PROVIDER_INVOKER_BINDING_MISSING/g) ?? []).length, 2);
  assert.equal((workflow.match(/--arg expected "\$YC_WIF_SERVICE_ACCOUNT_ID"/g) ?? []).length, 2);
  assert.equal((workflow.match(/\.type == "serviceAccount" and \.id == \$expected/g) ?? []).length, 2);
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
