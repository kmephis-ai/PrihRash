import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery-durable-diagnostic.yml', 'utf8');

test('R1 durable recovery diagnostic is exact-base, one-shot and provider-read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /EXPECTED_DIAGNOSTIC_SHA: d411588aa1902771128d2093ad1ae90e60cf62da/);
  assert.match(workflow, /R1 #453: запустить contiguous-prefix read-only recovery diagnostic/);
  assert.match(workflow, /Recovery-Diagnostic: DURABLE_STAGING_REVISION_V2/);
  assert.match(workflow, /length == 2/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/runs/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /initial-shadow-bootstrap\.yml\/dispatches|yc serverless|lockbox secret/);
});
