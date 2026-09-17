import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-lockbox-locator-diagnostic.yml', 'utf8');

test('R1 Lockbox locator diagnostic is exact-base, one-shot and read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /EXPECTED_DIAGNOSTIC_BASE_SHA: e69e993f54fe92776439bfd2a92cb26a19178e83/);
  assert.match(workflow, /R1 #453: классифицировать canonical Lockbox locator/);
  assert.match(workflow, /Recovery-Diagnostic: LOCKBOX_CANONICAL_LOCATOR_V1/);
  assert.match(workflow, /length == 2/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /yc lockbox secret get "\$LOCKBOX_SECRET_NAME" --folder-id "\$YC_FOLDER_ID"/);
  assert.match(workflow, /LOCKBOX_CANONICAL_NAME_LOOKUP_FAILED/);
  assert.match(workflow, /LOCKBOX_LOCATOR_MATCH/);
  assert.match(workflow, /LOCKBOX_LOCATOR_STALE/);
  assert.match(workflow, /LOCKBOX_CANONICAL_METADATA_MISMATCH/);
  assert.match(workflow, /LOCKBOX_CURRENT_VERSION_MISSING/);
  assert.match(workflow, /AUTH/);
  assert.match(workflow, /NOT_FOUND/);
  assert.match(workflow, /DEADLINE/);
  assert.match(workflow, /UNAVAILABLE/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.doesNotMatch(workflow, /actions:\s*write/);
  assert.doesNotMatch(workflow, /lockbox payload|payload get|secret get-payload/i);
  assert.doesNotMatch(workflow, /lockbox secret list/);
  assert.doesNotMatch(workflow, /serverless function version create|serverless function invoke|initial-shadow-bootstrap\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /ydb\.editor|source_records|transactions|googleapis\.com/);
});

test('R1 Lockbox locator diagnostic publishes only allowlisted enum evidence', () => {
  assert.match(workflow, /\{status: \$status, code: \$code, transportClass: \$transportClass\}/);
  assert.match(workflow, /r1-lockbox-locator-diagnostic-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /rm -f "\$tmp\/secret\.json" "\$tmp\/secret\.err"/);
  assert.doesNotMatch(workflow, /cat .*secret\.err|echo .*secret_json|printf .*YC_LOCKBOX_SECRET_ID/);
});
