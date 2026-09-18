import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', import.meta.url),
  'utf8',
);

test('recovery autocontinue is a bounded exact-main read-only dispatch surface', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\n\s*- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Recovery-Probe: READY/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_WRITER_ACTIVE/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-yandex-readiness\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml\/dispatches/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});
