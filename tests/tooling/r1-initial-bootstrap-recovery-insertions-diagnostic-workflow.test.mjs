import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery-insertions-diagnostic.yml', 'utf8');

test('R1 insertion-only recovery diagnostic is exact-base, one-shot and provider-read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /EXPECTED_DIAGNOSTIC_SHA: 5b4058e476df3b758ade182b2d183073c3b71f70/);
  assert.match(workflow, /R1 #453: запустить insertion-only read-only recovery diagnostic/);
  assert.match(workflow, /Recovery-Diagnostic: AUTHORITATIVE_SOURCE_INSERTIONS_V1/);
  assert.match(workflow, /length == 2/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/runs/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /initial-shadow-bootstrap\.yml\/dispatches|yc serverless|lockbox secret/);
});
