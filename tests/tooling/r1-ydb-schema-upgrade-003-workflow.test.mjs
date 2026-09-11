import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-ydb-schema-upgrade-003.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_YDB_SCHEMA_UPGRADE_003_RUNBOOK.md');
const PACKAGE_SCRIPT = resolve(ROOT, 'scripts/package-yandex-schema-upgrade-003-function.mjs');
const PACKAGE_VERIFY = resolve(ROOT, 'scripts/verify-yandex-schema-upgrade-003-package.mjs');
const OLD_PACKAGE_SCRIPT = resolve(ROOT, 'scripts/package-yandex-schema-bootstrap-function.mjs');

async function text(path) {
  return readFile(path, 'utf8');
}

test('migration-003 provider workflow is manual main-only and uses a separate temporary identity surface', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch):/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /YC_R1_SCHEMA_UPGRADE_003_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /YC_R1_SCHEMA_UPGRADE_003_LOCKBOX_SECRET_ID/);
  assert.doesNotMatch(workflow, /YC_R1_SCHEMA_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /YC_R1_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /OIDC_SUBJECT:\s*repo:kmephis-ai@310519475\/PrihRash@1359286840:ref:refs\/heads\/main/);
});

test('migration-003 workflow deploys only the dedicated private trigger-free upgrade package', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /FUNCTION_NAME:\s*prihrash-r1-schema-upgrade-003/);
  assert.match(workflow, /RUNTIME_SERVICE_ACCOUNT_NAME:\s*prihrash-schema-upgrade-003/);
  assert.match(workflow, /LOCKBOX_SECRET_NAME:\s*prihrash-r1-schema-upgrade-003/);
  assert.match(workflow, /\.artifacts\/yandex-schema-upgrade-003-function/);
  assert.match(workflow, /index\.schemaUpgrade003Handler/);
  assert.match(workflow, /--tags r1-schema-upgrade-003/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /serverless trigger list/);
  assert.doesNotMatch(workflow, /serverless trigger create/);
  assert.match(workflow, /key=ydb_connection_string/);
  assert.doesNotMatch(workflow, /google_spreadsheet_id|google_service_account_email|google_service_account_private_key/);
  assert.match(workflow, /npm run schema-upgrade-003:invoke/);
  assert.doesNotMatch(workflow, /schema-bootstrap:invoke|readiness:invoke/);
});

test('migration-003 package contains canonical 003 and structurally excludes every other migration/runtime writer path', async () => {
  const packageScript = await text(PACKAGE_SCRIPT);
  const verifier = await text(PACKAGE_VERIFY);
  const oldPackage = await text(OLD_PACKAGE_SCRIPT);

  assert.match(packageScript, /003_initial_bootstrap_identity_manifest\.sql/);
  assert.doesNotMatch(packageScript, /001_initial\.sql|002_reference_source_labels\.sql|db\/auth/);
  assert.match(verifier, /migrations\/001_initial\.sql/);
  assert.match(verifier, /migrations\/002_reference_source_labels\.sql/);
  assert.match(verifier, /dist\/runtime\/ydbSchemaBootstrap\.js/);
  assert.match(verifier, /dist\/runtime\/yandexCloudScheduledSyncFunction\.js/);
  assert.match(verifier, /forbidden migration-003 content/);
  assert.doesNotMatch(packageScript, /yandexCloudScheduledSyncFunction|yandexCloudSchemaBootstrapFunction|googleSheets/);

  assert.doesNotMatch(oldPackage, /003_initial_bootstrap_identity_manifest/);
});

test('migration-003 runbook keeps live DDL behind explicit owner authority and requires post-apply readiness plus retirement', async () => {
  const runbook = await text(RUNBOOK);

  assert.match(runbook, /migration `003_initial_bootstrap_identity_manifest\.sql`/);
  assert.match(runbook, /не выполняется автоматически/);
  assert.match(runbook, /`ydb\.editor`/);
  assert.match(runbook, /READINESS_READY/);
  assert.match(runbook, /requiredMigrationVersion.*3/s);
  assert.match(runbook, /Retirement/);
  assert.match(runbook, /initial shadow bootstrap.*только после/s);
  assert.doesNotMatch(runbook, /migration `004`.*разреш/u);
});
