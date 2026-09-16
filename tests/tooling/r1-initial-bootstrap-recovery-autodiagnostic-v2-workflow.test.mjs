import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery-autodiagnostic-v2.yml', 'utf8');

test('R1 recovery autodiagnostic v2 is exact-taxonomy-base and provider-read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /EXPECTED_TAXONOMY_SHA: f2fec79cafb7b4e0d86a636df0da89c975fc1009/);
  assert.match(workflow, /\.base\.sha/);
  assert.match(workflow, /Recovery-Diagnostic: STAGING_REVISION_TAXONOMY_V2/);
  assert.match(workflow, /length == 2/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/runs/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /yc serverless|lockbox secret|initial-shadow-bootstrap\.yml\/dispatches/);
});
