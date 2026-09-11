import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-ydb-schema-bootstrap.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_YDB_SCHEMA_BOOTSTRAP_RUNBOOK.md');
const READINESS_RUNBOOK = resolve(ROOT, 'docs/R1_YANDEX_READINESS_RUNBOOK.md');
const PACKAGE_SCRIPT = resolve(ROOT, 'scripts/package-yandex-schema-bootstrap-function.mjs');
const PACKAGE_VERIFY = resolve(ROOT, 'scripts/verify-yandex-schema-bootstrap-package.mjs');

async function text(path) {
  return readFile(path, 'utf8');
}

test('R1 schema bootstrap workflow is manual main-only OIDC and dedicated-identity only', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch):/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /YC_R1_SCHEMA_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /YC_R1_WIF_SERVICE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z0-9_]*(YC_SA_JSON|PRIVATE_KEY|AUTHORIZED_KEY|YDB_CONNECTION)/i);

  assert.match(workflow, /OIDC_SUBJECT:\s*repo:kmephis-ai@310519475\/PrihRash@1359286840:ref:refs\/heads\/main/);
  assert.match(workflow, /SCHEMA_BOOTSTRAP_OIDC_ISSUER_MISMATCH/);
  assert.match(workflow, /SCHEMA_BOOTSTRAP_OIDC_AUDIENCE_MISMATCH/);
  assert.match(workflow, /SCHEMA_BOOTSTRAP_OIDC_SUBJECT_MISMATCH/);
  assert.match(workflow, /SCHEMA_BOOTSTRAP_WIF_EXCHANGE_FAILED/);
  assert.doesNotMatch(workflow, /cat .*\/(oidc|iam|claims)\.json/);
});

test('R1 schema bootstrap deploys only dedicated private trigger-free 001→002 function package', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /FUNCTION_NAME:\s*prihrash-r1-schema-bootstrap/);
  assert.match(workflow, /RUNTIME_SERVICE_ACCOUNT_NAME:\s*prihrash-schema-bootstrap/);
  assert.match(workflow, /LOCKBOX_SECRET_NAME:\s*prihrash-r1-schema-bootstrap/);
  assert.match(workflow, /\.artifacts\/yandex-schema-bootstrap-function/);
  assert.match(workflow, /index\.schemaBootstrapHandler/);
  assert.match(workflow, /--tags r1-schema-bootstrap/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /serverless trigger list/);
  assert.doesNotMatch(workflow, /serverless trigger create/);
  assert.match(workflow, /key=ydb_connection_string/);
  assert.doesNotMatch(workflow, /google_spreadsheet_id|google_service_account_email|google_service_account_private_key/);
  assert.doesNotMatch(workflow, /index\.(?:readinessHandler|handler)(?:\s|$)/);
  assert.doesNotMatch(workflow, /003_initial_bootstrap_identity_manifest|db\/auth/);
  assert.match(workflow, /npm run schema-bootstrap:invoke/);
  assert.doesNotMatch(workflow, /npm run readiness:invoke/);
});

test('schema bootstrap package is structurally limited to canonical migrations 001 and 002', async () => {
  const packageScript = await text(PACKAGE_SCRIPT);
  const verifier = await text(PACKAGE_VERIFY);
  const source = `${packageScript}\n${verifier}`;

  assert.match(source, /001_initial\.sql/);
  assert.match(source, /002_reference_source_labels\.sql/);
  assert.match(verifier, /003_initial_bootstrap_identity_manifest\.sql/);
  assert.match(verifier, /db\/auth\/001_owner_auth\.sql/);
  assert.match(verifier, /forbidden bootstrap content/);
  assert.doesNotMatch(packageScript, /003_initial_bootstrap_identity_manifest|db\/auth\/001_owner_auth/);
  assert.doesNotMatch(packageScript, /yandexCloudScheduledSyncFunction|googleSheets/);
});

test('provider runbook keeps write authority separate and defines retirement after read-only readiness PASS', async () => {
  const runbook = await text(RUNBOOK);
  const readiness = await text(READINESS_RUNBOOK);

  assert.match(runbook, /001_initial\.sql → 002_reference_source_labels\.sql/);
  assert.match(runbook, /Migration `003_initial_bootstrap_identity_manifest\.sql`.*не входят/s);
  assert.match(runbook, /prihrash-schema-bootstrap/);
  assert.match(runbook, /`ydb\.editor` \*\*на target YDB database\*\*/);
  assert.match(runbook, /prihrash-backend.*`ydb\.viewer`/);
  assert.match(runbook, /lockbox\.payloadViewer/);
  assert.match(runbook, /prihrash-github-schema-bootstrap/);
  assert.match(runbook, /Deployment identity \*\*не получает\*\* `ydb\.editor`/);
  assert.match(runbook, /YC_R1_SCHEMA_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(runbook, /READINESS_READY/);
  assert.match(runbook, /Retirement condition/);
  assert.match(runbook, /снять `ydb\.editor`/);
  assert.match(readiness, /R1_YDB_SCHEMA_BOOTSTRAP_RUNBOOK\.md/);
  assert.match(readiness, /readiness identity остаётся `ydb\.viewer`/);
});
