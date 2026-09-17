import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-lockbox-metadata-diagnostic.yml', 'utf8');

test('R1 Lockbox diagnostic is exact-base, one-shot and metadata-read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /EXPECTED_DIAGNOSTIC_BASE_SHA: 805aa07a3f37f62969f4bfa1accf4ad055b46dc4/);
  assert.match(workflow, /R1 #453: классифицировать Lockbox metadata boundary/);
  assert.match(workflow, /Recovery-Diagnostic: LOCKBOX_METADATA_BOUNDARY_V1/);
  assert.match(workflow, /length == 2/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /yc lockbox secret get --id/);
  assert.match(workflow, /LOCKBOX_METADATA_READ_FAILED/);
  assert.match(workflow, /LOCKBOX_METADATA_MISMATCH/);
  assert.match(workflow, /LOCKBOX_CURRENT_VERSION_MISSING/);
  assert.match(workflow, /AUTH/);
  assert.match(workflow, /NOT_FOUND/);
  assert.match(workflow, /DEADLINE/);
  assert.match(workflow, /UNAVAILABLE/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.doesNotMatch(workflow, /actions:\s*write/);
  assert.doesNotMatch(workflow, /lockbox payload|payload get|secret get-payload/i);
  assert.doesNotMatch(workflow, /serverless function version create|serverless function invoke|initial-shadow-bootstrap\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /ydb\.editor|source_records|transactions|googleapis\.com/);
});

test('R1 Lockbox diagnostic publishes only allowlisted enum evidence', () => {
  assert.match(workflow, /\{status: \$status, code: \$code, transportClass: \$transportClass\}/);
  assert.match(workflow, /r1-lockbox-metadata-diagnostic-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /rm -f "\$tmp\/secret\.json" "\$tmp\/secret\.err"/);
  assert.doesNotMatch(workflow, /cat .*secret\.err|echo .*secret_json|printf .*YC_LOCKBOX_SECRET_ID/);
});
