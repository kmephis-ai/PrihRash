import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery-stale-retirement-diagnostic.yml', 'utf8');

test('R1 stale-retirement recovery diagnostic is exact-base, one-shot and provider-read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /EXPECTED_DIAGNOSTIC_SHA: a72760d42eab7116a48b09510ccff43a522ff65c/);
  assert.match(workflow, /R1 #453: запустить stale-retirement read-only recovery diagnostic/);
  assert.match(workflow, /Recovery-Diagnostic: STALE_STAGING_CURRENT_STATE_V1/);
  assert.match(workflow, /length == 2/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/runs/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /initial-shadow-bootstrap\.yml\/dispatches|yc serverless|lockbox secret/);
});
