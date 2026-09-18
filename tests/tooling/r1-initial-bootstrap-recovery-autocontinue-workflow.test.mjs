import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', import.meta.url),
  'utf8',
);

test('R1 recovery autocontinue is exact-main, read-only-recovery-only and fail-closed', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\n\s*- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch):/);

  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /issues:\s*read/);
  assert.match(workflow, /pull-requests:\s*read/);
  assert.match(workflow, /cancel-in-progress:\s*false/);

  assert.match(workflow, /Recovery-Attempt: READY/);
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Expected-Recovery-Evidence: EXACT_CURRENT_RUN_CLASSIFICATION/);
  assert.match(workflow, /Recovery-State: STAGING_RESUMABLE/);
  assert.match(workflow, /R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_ATTEMPT_MARKER_INVALID/);
  assert.match(workflow, /R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_ISSUE_INACTIVE/);
  assert.match(workflow, /R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_ACTIVE_WRITER/);
  assert.match(workflow, /R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_MAIN_MOVED_BEFORE_DISPATCH/);

  assert.match(workflow, /actions\/workflows\/r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /actions\/workflows\/r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /actions\/workflows\/r1-initial-shadow-bootstrap\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /actions\/workflows\/r1-yandex-readiness\.yml\/dispatches/);
});

test('R1 recovery autocontinue retires operationally when Issue #453 is closed', () => {
  assert.match(workflow, /api\/issues\/453/);
  assert.match(workflow, /issue_state.*!= 'open'/s);
  assert.match(workflow, /R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_ISSUE_INACTIVE/);
});
