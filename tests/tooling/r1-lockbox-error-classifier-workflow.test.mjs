import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-lockbox-error-classifier.yml');

async function text(path) {
  return readFile(path, 'utf8');
}

test('Lockbox classifier is manual-only, exact-main, and read-only', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch|workflow_run):/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /current_sha/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID/);
  assert.match(workflow, /yc lockbox secret get --id/);
  assert.doesNotMatch(workflow, /lockbox payload/);
  assert.doesNotMatch(workflow, /lockbox secret list(?:\s|$)/);
  assert.doesNotMatch(workflow, /serverless function (?:version )?(?:create|update|delete|invoke)/);
  assert.doesNotMatch(workflow, /ydb|google_spreadsheet|initial-bootstrap:invoke/i);
});

test('Lockbox classifier exposes only bounded error enums and never raw stderr', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /LOCKBOX_METADATA_OK/);
  assert.match(workflow, /NOT_FOUND/);
  assert.match(workflow, /PERMISSION_DENIED/);
  assert.match(workflow, /transport_class='AUTH'/);
  assert.match(workflow, /transport_class='TRANSPORT'/);
  assert.match(workflow, /transport_class='OTHER'/);
  assert.match(workflow, /2>"\$tmp\/secret\.err"/);
  assert.match(workflow, /rm -f "\$tmp\/secret\.err"/);
  assert.doesNotMatch(workflow, /cat\s+[^\n]*secret\.err/);
  assert.doesNotMatch(workflow, /echo\s+[^\n]*secret\.err/);
  assert.match(workflow, /classification\.json/);
  assert.match(workflow, /transportClass/);
  assert.match(workflow, /retention-days: 30/);
});
