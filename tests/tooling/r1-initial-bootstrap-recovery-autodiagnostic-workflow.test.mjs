import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/r1-initial-bootstrap-recovery-autodiagnostic.yml',
  'utf8',
);

test('R1 recovery autodiagnostic is one-shot, CI-gated and provider-read-only', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /Recovery-Diagnostic: STAGING_REVISION_EVIDENCE/);
  assert.match(workflow, /r1-initial-bootstrap-recovery-autodiagnostic\.yml.*status == "added"/s);
  assert.match(workflow, /initialBootstrapStagingRevisionDiagnostic\.ts.*status == "added"/s);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.match(workflow, /Retirement condition: delete this workflow immediately/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /id-token:|yc serverless|storage\.yandexcloud|lockbox secret|initial-shadow-bootstrap\.yml\/dispatches/);
});
