import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-lockbox-error-classifier.yml');

async function text(path) {
  return readFile(path, 'utf8');
}

test('Lockbox classifier is manual-only, exact-main, read-only, and proves WIF subject plus CLI and REST metadata paths', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch|workflow_run):/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /current_sha/);
  assert.match(workflow, /YC_R1_FOLDER_ID/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID/);
  assert.match(workflow, /LOCKBOX_SECRET_NAME: prihrash-r1-initial-bootstrap/);
  assert.match(workflow, /yc iam whoami --format json/);
  assert.match(workflow, /yc lockbox secret get --id/);
  assert.match(workflow, /yc lockbox secret get --name "\$LOCKBOX_SECRET_NAME" --folder-id "\$YC_FOLDER_ID"/);
  assert.match(workflow, /https:\/\/lockbox\.api\.cloud\.yandex\.net\/lockbox\/v1\/secrets\/\$\{YC_LOCKBOX_SECRET_ID\}/);
  assert.match(workflow, /Authorization: Bearer \$\{YC_IAM_TOKEN\}/);
  assert.doesNotMatch(workflow, /lockbox payload/);
  assert.doesNotMatch(workflow, /lockbox secret list(?:\s|$)/);
  assert.doesNotMatch(workflow, /serverless function (?:version )?(?:create|update|delete|invoke)/);
  assert.doesNotMatch(workflow, /ydb|google_spreadsheet|initial-bootstrap:invoke/i);
});

test('Lockbox classifier exposes only bounded identity, locator, and REST enums and never raw provider output', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /LOCKBOX_METADATA_OK/);
  assert.match(workflow, /WIF_SUBJECT_MISMATCH/);
  assert.match(workflow, /LOCKBOX_ID_LOCATOR_MISMATCH/);
  assert.match(workflow, /LOCKBOX_CLI_API_DIVERGENCE/);
  assert.match(workflow, /LOCKBOX_API_UNSEEN/);
  assert.match(workflow, /LOCKBOX_REST_PERMISSION_DENIED/);
  assert.match(workflow, /LOCKBOX_REST_AUTH/);
  assert.match(workflow, /LOCKBOX_REST_TRANSPORT/);
  assert.match(workflow, /NOT_FOUND/);
  assert.match(workflow, /PERMISSION_DENIED/);
  assert.match(workflow, /printf '%s' 'AUTH'/);
  assert.match(workflow, /printf '%s' 'TRANSPORT'/);
  assert.match(workflow, /printf '%s' 'OTHER'/);
  assert.match(workflow, /2>"\$tmp\/whoami\.err"/);
  assert.match(workflow, /2>"\$tmp\/by-id\.err"/);
  assert.match(workflow, /2>"\$tmp\/by-name\.err"/);
  assert.match(workflow, /2>"\$tmp\/rest\.err"/);
  assert.match(workflow, /rm -f "\$tmp"\/\*\.err "\$tmp"\/\*\.json/);
  assert.doesNotMatch(workflow, /cat\s+[^\n]*(whoami|by-id|by-name|rest)\.(err|json)/);
  assert.doesNotMatch(workflow, /echo\s+[^\n]*(whoami|by-id|by-name|rest)\.(err|json)/);
  assert.match(workflow, /classification\.json/);
  assert.match(workflow, /identityMatch/);
  assert.match(workflow, /identityLookupClass/);
  assert.match(workflow, /idLookupClass/);
  assert.match(workflow, /nameLookupClass/);
  assert.match(workflow, /locatorMatch/);
  assert.match(workflow, /restLookupClass/);
  assert.match(workflow, /retention-days: 30/);
});
