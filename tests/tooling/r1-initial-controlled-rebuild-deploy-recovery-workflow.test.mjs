import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(ROOT, path), 'utf8');

test('controlled rebuild deploy recovery is manual, exact-main and read-only', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-deploy-recovery.yml');
  assert.match(workflow, /name: R1 initial controlled rebuild deploy recovery/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*tracking_issue:[\s\S]*expected_main_sha:[\s\S]*failed_run_sha:[\s\S]*failed_run_id:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /\bpush:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /issues: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /actions: write/);
});

test('deploy recovery binds the exact failed pre-invoke run and WU7 authority', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-deploy-recovery.yml');
  assert.match(workflow, /Provider-Authority: WU7_CONTROLLED_REBUILD/);
  assert.match(workflow, /Authority-Scope: PRODUCTION_YDB_INITIAL_SHADOW_ONLY/);
  assert.match(workflow, /Blind-Replay: FORBIDDEN/);
  assert.match(workflow, /Deploy initial-controlled-rebuild-only Function version/);
  assert.match(workflow, /conclusion == "failure"/);
  assert.match(workflow, /Invoke exact controlled rebuild tag once/);
  assert.match(workflow, /conclusion == "skipped"/);
  assert.match(workflow, /FAILED_RUN_SHA: \$\{\{ inputs\.failed_run_sha \}\}/);
  assert.match(workflow, /\.head_sha == \$failed_sha/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_DEPLOY_RECOVERY_WRITER_CONFLICT/);
  assert.doesNotMatch(workflow, /issues\/630/);
});

test('deploy recovery classifies only provider metadata and cannot create or invoke', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-deploy-recovery.yml');
  assert.match(workflow, /serverless function get --name/);
  assert.match(workflow, /serverless function version list --function-id/);
  assert.match(workflow, /r1-initial-controlled-rebuild/);
  assert.match(workflow, /index\.initialControlledRebuildHandler/);
  assert.match(workflow, /nodejs22/);
  assert.doesNotMatch(workflow, /serverless function version create/);
  assert.doesNotMatch(workflow, /serverless function invoke/);
  assert.doesNotMatch(workflow, /initial-controlled-rebuild:invoke/);
  assert.doesNotMatch(workflow, /renameTables|copyTables|executeDataQuery|ydb.*query/i);
  assert.doesNotMatch(workflow, /google_spreadsheet|google_service_account|lockbox_secret/i);
});

test('deploy recovery emits enum-only APPLIED, NOT_APPLIED or RECOVERY_REQUIRED evidence', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-deploy-recovery.yml');
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_DEPLOY_RECOVERY_CLASSIFIED/);
  assert.match(workflow, /"APPLIED","NOT_APPLIED","RECOVERY_REQUIRED"/);
  assert.match(workflow, /EXACT_ACTIVE_TAG/);
  assert.match(workflow, /TAG_ABSENT/);
  assert.match(workflow, /TAG_METADATA_NOT_EXACT_ACTIVE/);
  assert.match(workflow, /TAG_MATCH_AMBIGUOUS/);
  assert.match(workflow, /r1-initial-controlled-rebuild-deploy-recovery-evidence-\$\{\{ github\.run_id \}\}/);
});
