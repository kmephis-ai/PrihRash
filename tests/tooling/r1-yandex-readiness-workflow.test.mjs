import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-yandex-readiness.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_YANDEX_READINESS_RUNBOOK.md');

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
  assert.match(workflow, /--output "\$tmp\/oidc\.json"/);
  assert.match(workflow, /--output "\$tmp\/iam\.json"/);
  assert.match(workflow, /::add-mask::\$\{oidc_token\}/);
  assert.doesNotMatch(workflow, /cat .*\/oidc\.json|cat .*\/iam\.json/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*(YC_SA_JSON|PRIVATE_KEY|AUTHORIZED_KEY)/i);

  assert.match(workflow, /index\.readinessHandler/);
  assert.doesNotMatch(workflow, /index\.handler(?:\s|$)/);
  assert.match(workflow, /--tags r1-readiness/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /serverless trigger list/);
  assert.doesNotMatch(workflow, /serverless trigger create/);
  assert.match(workflow, /npm run readiness:invoke/);
});

test('R1 readiness workflow never transports Lockbox payload through GitHub', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /LOCKBOX_SECRET_NAME:\s*prihrash-r1-readiness/);
  assert.match(workflow, /google_service_account_private_key/);
  assert.match(workflow, /--secret /);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*(GOOGLE|PRIVATE|YDB_CONNECTION|LOCKBOX_PAYLOAD)/);
  assert.doesNotMatch(workflow, /--environment[^\n]*(GOOGLE|YDB)/i);
});

test('canonical runbook binds WIF identity to exact repository main subject', async () => {
  const runbook = await text(RUNBOOK);

  assert.match(runbook, /repo:kmephis-ai\/PrihRash:ref:refs\/heads\/main/);
  assert.match(runbook, /issuer: https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(runbook, /audience: https:\/\/github\.com\/kmephis-ai/);
  assert.match(runbook, /YC_R1_FOLDER_ID/);
  assert.match(runbook, /YC_R1_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(runbook, /Long-lived Yandex authorized key\/OAuth token в GitHub не используется/);
});
