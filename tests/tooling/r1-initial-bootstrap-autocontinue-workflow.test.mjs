import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-bootstrap-autocontinue.yml');

async function workflowText() {
  return readFile(WORKFLOW, 'utf8');
}

test('R1 autocontinue is stage-specific, CI-gated, exact-main, and has no provider authority', async () => {
  const workflow = await workflowText();

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /- CI/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /issues:\s*read/);
  assert.match(workflow, /pull-requests:\s*read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /yandex|\byc\b|lockbox|service-account/i);
});

test('R1 autocontinue dispatches only active #453 exact-main source or one proven pre-invoke main-move successor and never duplicates a SHA', async () => {
  const workflow = await workflowText();

  assert.match(workflow, /commits\/\$SOURCE_SHA\/pulls/);
  assert.match(workflow, /merge_commit_sha == \$sha/);
  assert.match(workflow, /base\.ref == "main"/);
  assert.match(workflow, /head\.repo\.full_name == \$repo/);
  assert.match(workflow, /startswith\("R1 #453:"\)/);
  assert.match(workflow, /NOT_SINGLE_MERGED_MAIN_PR/);
  assert.match(workflow, /parents \| length\) == 1/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator-evidence-\$interrupted_run_id/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS/);
  assert.match(workflow, /bootstrapInvokeStep == "skipped"/);
  assert.match(workflow, /postRecoveryVerdict == null/);
  assert.match(workflow, /Re-verify exact current main before provider deployment/);
  assert.match(workflow, /Invoke exact initial bootstrap tag once/);
  assert.match(workflow, /R1_BOOTSTRAP_AUTOCONTINUE_RESUME_AFTER_PREINVOKE_MAIN_MOVE/);
  assert.match(workflow, /length == 1/);
  assert.doesNotMatch(workflow, /commit_title=/);
  assert.match(workflow, /issues\/453/);
  assert.match(workflow, /issue_state.*open/s);
  assert.match(workflow, /branches\/main/g);
  assert.match(workflow, /SOURCE_SHA/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator\.yml\/runs/);
  assert.match(workflow, /any\(\.head_sha == \$sha\)/);
  assert.match(workflow, /R1_BOOTSTRAP_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.match(workflow, /--data '\{\"ref\":\"main\"\}'/);
  assert.doesNotMatch(workflow, /r1-yandex-readiness\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml\/dispatches/);
});
