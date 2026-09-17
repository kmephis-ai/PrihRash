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
  assert.match(workflow, /STAGING_STALE_RETIREABLE/);
  assert.match(workflow, /STALE_STAGING_RETIRED/);
  assert.match(workflow, /recovery_state=/);
  assert.match(workflow, /allow_staging_resume='true'/);
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

test('R1 autocontinue keeps resumable, stale-retireable, and retired recovery states distinct', async () => {
  const workflow = await workflowText();

  assert.match(workflow, /Recovery-State: STAGING_RESUMABLE/);
  assert.match(workflow, /Recovery-State: STAGING_STALE_RETIREABLE/);
  assert.match(workflow, /Recovery-State: STALE_STAGING_RETIRED/);
  assert.match(workflow, /\[ "\$recovery_state" = 'STAGING_RESUMABLE' \]/);
  assert.match(workflow, /\[ "\$recovery_state" = 'STAGING_STALE_RETIREABLE' \]/);
  assert.doesNotMatch(workflow, /\[ "\$recovery_state" = 'STALE_STAGING_RETIRED' \]/);
});

test('R1 autocontinue binds Incident-M marker to sanitized evidence and breaks duplicate incident keys cross-run', async () => {
  const workflow = await workflowText();

  assert.match(workflow, /Checkout exact CI source for bounded evidence classifier/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /observedSignature:/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator-evidence-\$latest_run_id/);
  assert.match(workflow, /r1-initial-bootstrap-evidence-\$bootstrap_run_id/);
  assert.match(workflow, /scripts\/r1-autocontinue-evidence\.mjs signature-bootstrap/);
  assert.match(workflow, /scripts\/r1-autocontinue-evidence\.mjs signature-orchestrator/);
  assert.match(workflow, /PREVIOUS_EVIDENCE_MISSING/);
  assert.match(workflow, /PREVIOUS_EVIDENCE_INVALID/);
  assert.match(workflow, /PREVIOUS_OUTCOME_UNCERTAIN/);
  assert.match(workflow, /Observed-Signature: \$observed_signature/);
  assert.match(workflow, /--arg recovery "Recovery-State: \$recovery_state"/);
  assert.match(workflow, /\.recovery == 1/);
  assert.match(workflow, /Circuit-Rearm: ROOT_CAUSE_FIX/);
  assert.match(workflow, /bootstrapInvokeStep \| IN\("success", "failure"\)/);
  assert.match(workflow, /r1-initial-bootstrap-evidence-\$historical_bootstrap_run_id/);
  assert.match(workflow, /historical_completed_at/);
  assert.match(workflow, /artifact-id-at-or-before/);
  assert.match(workflow, /\[\.id, \.head_sha, \.updated_at\] \| @tsv/);
  assert.match(workflow, /signature-bootstrap "\$historical_bootstrap"/);
  assert.match(workflow, /historical_signature.*observed_signature/s);
  assert.match(workflow, /if \[ "\$historical_signature" != "\$observed_signature" \]; then\s+continue/s);
  assert.match(workflow, /prior_root_cause_attempts=\$\(\(prior_root_cause_attempts \+ 1\)\)/);
  assert.match(workflow, /BLOCKED_NEEDS_ROOT_CAUSE/);
  assert.match(workflow, /scripts\/r1-autocontinue-evidence\.mjs decision/);
  assert.match(workflow, /HISTORY_EVIDENCE_MISSING/);
  assert.match(workflow, /HISTORY_EVIDENCE_INVALID/);
  assert.match(workflow, /HISTORY_UNBOUNDED/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
});
