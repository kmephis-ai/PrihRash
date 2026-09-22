import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-ydb-schema-upgrade-004.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_YDB_SCHEMA_UPGRADE_004_RUNBOOK.md');
const PACKAGE_SCRIPT = resolve(ROOT, 'scripts/package-yandex-schema-upgrade-004-function.mjs');
const PACKAGE_VERIFY = resolve(ROOT, 'scripts/verify-yandex-schema-upgrade-004-package.mjs');

async function text(path) { return readFile(path, 'utf8'); }

test('migration-004 provider workflow is manual exact-main only and requires explicit Owner authority token', async () => {
  const workflow = await text(WORKFLOW);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /expected_main_sha:/);
  assert.match(workflow, /confirmation:/);
  assert.match(workflow, /OWNER_APPROVED_SCHEMA_UPGRADE_004_ONCE/);
  assert.match(workflow, /GITHUB_SHA.*inputs\.expected_main_sha/s);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT.*1/s);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch):/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /YC_R1_SCHEMA_UPGRADE_004_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /YC_R1_SCHEMA_UPGRADE_004_LOCKBOX_SECRET_ID/);
});

test('migration-004 workflow deploys only the dedicated private trigger-free upgrade package', async () => {
  const workflow = await text(WORKFLOW);
  assert.match(workflow, /FUNCTION_NAME:\s*prihrash-r1-schema-upgrade-004/);
  assert.match(workflow, /RUNTIME_SERVICE_ACCOUNT_NAME:\s*prihrash-schema-upgrade-004/);
  assert.match(workflow, /LOCKBOX_SECRET_NAME:\s*prihrash-r1-schema-upgrade-004/);
  assert.match(workflow, /\.artifacts\/yandex-schema-upgrade-004-function/);
  assert.match(workflow, /index\.schemaUpgrade004Handler/);
  assert.match(workflow, /--tags r1-schema-upgrade-004/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /serverless trigger list/);
  assert.doesNotMatch(workflow, /serverless trigger create/);
  assert.match(workflow, /key=ydb_connection_string/);
  assert.doesNotMatch(workflow, /google_spreadsheet_id|google_service_account_email|google_service_account_private_key/);
  assert.match(workflow, /npm run schema-upgrade-004:invoke/);
  assert.doesNotMatch(workflow, /schema-bootstrap:invoke|readiness:invoke|initial-controlled-rebuild/);
});

test('migration-004 package contains canonical 004 and structurally excludes every other migration/runtime writer path', async () => {
  const packageScript = await text(PACKAGE_SCRIPT);
  const verifier = await text(PACKAGE_VERIFY);
  assert.match(packageScript, /004_source_record_revision_run_index\.sql/);
  assert.doesNotMatch(packageScript, /001_initial\.sql|002_reference_source_labels\.sql|003_initial_bootstrap_identity_manifest\.sql|db\/auth/);
  assert.match(verifier, /migrations\/001_initial\.sql/);
  assert.match(verifier, /migrations\/002_reference_source_labels\.sql/);
  assert.match(verifier, /migrations\/003_initial_bootstrap_identity_manifest\.sql/);
  assert.match(verifier, /dist\/runtime\/ydbSchemaBootstrap\.js/);
  assert.match(verifier, /dist\/runtime\/yandexCloudScheduledSyncFunction\.js/);
  assert.match(verifier, /forbidden migration-004 content/);
  assert.doesNotMatch(packageScript, /yandexCloudScheduledSyncFunction|yandexCloudSchemaBootstrapFunction|googleSheets|initialControlledRebuild/);
});

test('migration-004 runbook keeps live DDL behind separate explicit Owner authority and requires schema-v4 readiness', async () => {
  const runbook = await text(RUNBOOK);
  assert.match(runbook, /migration `004_source_record_revision_run_index\.sql`/);
  assert.match(runbook, /GLOBAL SYNC/);
  assert.match(runbook, /GLOBAL ASYNC.*запрещ/u);
  assert.match(runbook, /OWNER_APPROVED_SCHEMA_UPGRADE_004_ONCE/);
  assert.match(runbook, /не применяет DDL/);
  assert.match(runbook, /READINESS_READY/);
  assert.match(runbook, /requiredMigrationVersion=4/);
  assert.match(runbook, /#630/);
});
