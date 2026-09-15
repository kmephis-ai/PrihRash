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

test('R1 autocontinue requires explicit root-cause attempt evidence or one proven pre-invoke main-move successor and never duplicates a SHA', async () => {
  const workflow = await workflowText();

  assert.match(workflow, /commits\/\$SOURCE_SHA\/pulls/);
  assert.match(workflow, /merge_commit_sha == \$sha/);
  assert.match(workflow, /base\.ref == "main"/);
  assert.match(workflow, /head\.repo\.full_name == \$repo/);
  assert.match(workflow, /startswith\("R1 #453:"\)/);
  assert.match(workflow, /Provider-Attempt: READY/);
  assert.match(workflow, /Observed-Signature:/);
  assert.match(workflow, /Expected-Transition:/);
  assert.match(workflow, /Recovery-State:/);
  assert.match(workflow, /Circuit-Rearm: ROOT_CAUSE_FIX/);
  assert.match(workflow, /Regression-Test: tests\//);
  assert.match(workflow, /ATTEMPT_MARKER_INVALID/);
  assert.match(workflow, /pulls\/\$source_pr_number\/files\?per_page=100/);
  assert.match(workflow, /ROOT_CAUSE_EVIDENCE_MISSING/);
  assert.match(workflow, /STAGING_RESUMABLE/);
  assert.match(workflow, /NOT_SINGLE_MERGED_MAIN_PR/);
  assert.match(workflow, /parents \| length\) == 1/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator-evidence-\$interrupted_run_id/);
  assert.match(workflow, /interrupted_run_id="\$\(jq -r --arg sha/);
  assert.match(workflow, /artifact_id="\$\(jq -r --arg name/);
  assert.doesNotMatch(workflow, /\] \\\n\s*\| sort_by/);
  assert.doesNotMatch(workflow, /\] \\\n\s*\| if length/);
  assert.doesNotMatch(workflow, /<<<"\$existing" \|\| true/);
  assert.doesNotMatch(workflow, /<<<"\$artifacts" \|\| true/);
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
  assert.match(workflow, /allow_staging_resume/);
  assert.match(workflow, /--data "\$dispatch_payload"/);
  assert.doesNotMatch(workflow, /r1-yandex-readiness\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml\/dispatches/);
});
