import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-bootstrap-autocontinue.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md');

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
  assert.match(workflow, /R1 completion sprint: пробить первый COMMITTED shadow baseline/);
  assert.match(workflow, /tracking_issue_number/);
  assert.match(workflow, /r1_title_prefix="R1 #\$\{tracking_issue_number\}:"/);
  assert.match(workflow, /startsWith\(\$prefix\)|startswith\(\$prefix\)/i);
  assert.doesNotMatch(workflow, /R1 #453:|issues\/453|NOT_R1_453_SOURCE/);
  assert.match(workflow, /Provider-Attempt: READY/);
  assert.match(workflow, /Observed-Signature:/);
  assert.match(workflow, /Expected-Transition:/);
  assert.match(workflow, /Recovery-State:/);
  assert.match(workflow, /Circuit-Rearm: ROOT_CAUSE_FIX/);
  assert.match(workflow, /Circuit-Rearm: SOURCE_DRIFT_REBASE/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED\/RECOVERY_REQUIRED\/STAGING_RUN_PRESENT/);
  assert.match(workflow, /SOURCE_DRIFT_EVIDENCE_MISSING/);
  assert.match(workflow, /docs\/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK\.md/);
  assert.match(workflow, /Regression-Test: tests\//);
  assert.match(workflow, /ATTEMPT_MARKER_INVALID/);
  assert.match(workflow, /pulls\/\$source_pr_number\/files\?per_page=100/);
  assert.match(workflow, /ROOT_CAUSE_EVIDENCE_MISSING/);
  assert.match(workflow, /STAGING_RESUMABLE/);
  assert.match(workflow, /STAGING_STALE_RETIREABLE/);
  assert.match(workflow, /STALE_STAGING_RETIRED/);
  assert.match(workflow, /recovery_state=/);
  assert.match(workflow, /allow_staging_resume='true'/);
  assert.match(workflow, /allow_stale_staging_retirement='true'/);
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
  assert.match(workflow, /TRACKING_ISSUE_NOT_EXACT/);
  assert.match(workflow, /TRACKING_ISSUES_UNBOUNDED/);
  assert.match(workflow, /issues\/\$\{tracking_issue_number\}/);
  assert.match(workflow, /\.title == "R1 completion sprint: пробить первый COMMITTED shadow baseline"/);
  assert.match(workflow, /branches\/main/g);
  assert.match(workflow, /SOURCE_SHA/);
  assert.match(workflow, /SOURCE_CI_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /R1_BOOTSTRAP_AUTOCONTINUE_CI_RUN_ID_INVALID/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator\.yml\/runs/);
  assert.match(workflow, /any\(\.head_sha == \$sha\)/);
  assert.match(workflow, /R1_BOOTSTRAP_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.match(workflow, /allow_staging_resume/);
  assert.match(workflow, /allow_stale_staging_retirement/);
  assert.match(workflow, /async_invocation/);
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
  assert.match(workflow, /allow_staging_resume='true'/);
  assert.match(workflow, /allow_stale_staging_retirement='true'/);
  assert.doesNotMatch(workflow, /\[ "\$recovery_state" = 'STALE_STAGING_RETIRED' \]/);
});

test('first async provider marker is recovery-bound, bypasses sync circuit, and dispatches only stale-retirement async mode', async () => {
  const workflow = await workflowText();
  const runbook = await readFile(RUNBOOK, 'utf8');
  const asyncGate = workflow.match(
    /if \[ "\$async_provider_attempt" = 'true' \]; then([\s\S]*?)elif \[ "\$orchestrator_preflight"/,
  )?.[1];

  assert.ok(asyncGate, 'async provider gate must remain separately bounded');
  assert.match(workflow, /Async-Provider-Attempt: READY/);
  assert.match(workflow, /Owner-Decision: R1_ASYNC_INVOCATION_CONTRACT_APPROVED/);
  assert.match(workflow, /Observed-Recovery: INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED\/RECOVERY_REQUIRED\/STAGING_RUN_PRESENT/);
  assert.match(workflow, /Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_ASYNC_POST_WINDOW_RECOVERY_CLASSIFIED/);
  assert.match(workflow, /Recovery-State: STAGING_STALE_RETIREABLE/);
  assert.match(workflow, /Recovery-Run-ID: \[1-9\]\[0-9\]\*/);
  assert.match(asyncGate, /R1_BOOTSTRAP_AUTOCONTINUE_ASYNC_CHANGESET_INVALID/);
  assert.match(asyncGate, /r1-initial-bootstrap-recovery-evidence-\$async_recovery_run_id/);
  assert.match(asyncGate, /Invoke exact read-only recovery tag once/);
  assert.match(asyncGate, /Publish enum-only recovery evidence/);
  assert.match(asyncGate, /INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/);
  assert.match(asyncGate, /RECOVERY_REQUIRED/);
  assert.match(asyncGate, /STAGING_RUN_PRESENT/);
  assert.match(asyncGate, /allow_staging_resume='false'/);
  assert.match(asyncGate, /allow_stale_staging_retirement='true'/);
  assert.match(asyncGate, /async_invocation='true'/);
  assert.doesNotMatch(asyncGate, /ROOT_CAUSE_FIX|prior_root_cause_attempts|BLOCKED_NEEDS_ROOT_CAUSE/);
  assert.match(workflow, /async_provider_attempt" != 'true'/);
  assert.match(workflow, /--arg async "\$async_invocation"/);
  assert.match(workflow, /async_invocation:\$async/);

  const evidence = runbook.match(
    /### First async provider attempt after fresh full recovery `36782526425`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'fresh async attempt evidence must remain canonical');
  assert.match(evidence, /`0c2c4f06a5da00eec5bf4d8654f03930fc69c546`/);
  assert.match(evidence, /Full recovery `36782526425` then completed `SUCCESS`/);
  assert.match(evidence, /AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH/);
  assert.match(evidence, /COMPLETE_CURRENT_RUN_ONLY/);
  assert.match(evidence, /STALE_STAGING_CURRENT_STATE_EMPTY/);
  assert.match(evidence, /EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN/);
  assert.match(evidence, /Async-Provider-Attempt: READY/);
  assert.match(evidence, /allow_staging_resume=false/);
  assert.match(evidence, /allow_stale_staging_retirement=true/);
  assert.match(evidence, /async_invocation=true/);
  assert.doesNotMatch(evidence, /Provider-Attempt: READY/);
});

test('source-drift preflight accepts only exact successful recovery and dispatches false/false orchestrator', async () => {
  const workflow = await workflowText();
  const preflightGate = workflow.match(
    /if \[ "\$orchestrator_preflight" = 'true' \]; then([\s\S]*?)\n\s*else\n\s*rearm_mode=/,
  )?.[1];

  assert.ok(preflightGate, 'preflight branch must remain separately bounded');
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Orchestrator-Preflight: READY/);
  assert.match(workflow, /Observed-Recovery: INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED\/RECOVERY_REQUIRED\/STAGING_RUN_PRESENT/);
  assert.match(workflow, /Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED\/RECOVERY_REQUIRED\/STAGING_RUN_PRESENT/);
  assert.match(workflow, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(workflow, /Recovery-Run-ID: \[1-9\]\[0-9\]\*/);
  assert.match(preflightGate, /PREFLIGHT_CHANGESET_INVALID/);
  assert.match(preflightGate, /\.github\/actions\/restore-exact-source\/action\.yml/);
  assert.match(preflightGate, /\.github\/workflows\/r1-initial-bootstrap-orchestrator\.yml/);
  assert.match(preflightGate, /tests\/tooling\/exact-source-artifact\.test\.mjs/);
  assert.match(preflightGate, /tests\/tooling\/r1-initial-bootstrap-orchestrator-workflow\.test\.mjs/);
  assert.match(preflightGate, /all\(\.\[\]; \.filename \| IN\(/);
  assert.doesNotMatch(preflightGate, /\.filename \| startswith\("src\/"\)/);
  assert.match(preflightGate, /compare\/\$preflight_recovery_sha\.\.\.\$SOURCE_SHA/);
  assert.match(preflightGate, /Deploy recovery-only Function version/);
  assert.match(preflightGate, /Invoke exact read-only recovery tag once/);
  assert.match(preflightGate, /r1-initial-bootstrap-recovery-evidence-\$preflight_recovery_run_id/);
  assert.match(preflightGate, /INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/);
  assert.match(preflightGate, /RECOVERY_REQUIRED/);
  assert.match(preflightGate, /STAGING_RUN_PRESENT/);
  assert.doesNotMatch(preflightGate, /allow_staging_resume='true'|allow_stale_staging_retirement='true'/);
  assert.match(workflow, /source_is_r1" = 'true' \] && \[ "\$orchestrator_preflight" != 'true'/);
  assert.match(workflow, /allow_staging_resume='false'/);
  assert.match(workflow, /allow_stale_staging_retirement='false'/);
});

test('source-drift rebase requires exact pre-write evidence and arms stale retirement only', async () => {
  const workflow = await workflowText();
  const sourceDriftGate = workflow.match(
    /if \[ "\$rearm_mode" = 'SOURCE_DRIFT_REBASE' \]; then([\s\S]*?)elif ! jq -e/,
  )?.[1];

  assert.ok(sourceDriftGate, 'source-drift branch must remain separately bounded');
  assert.match(sourceDriftGate, /tests\/tooling\/r1-initial-bootstrap-autocontinue-workflow\.test\.mjs/);
  assert.match(sourceDriftGate, /docs\/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK\.md/);
  assert.match(workflow, /Observed-Signature: R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED\/RECOVERY_REQUIRED\/STAGING_RUN_PRESENT/);
  assert.match(workflow, /and \$recovery == \["Recovery-State: STAGING_STALE_RETIREABLE"\]/);
  assert.match(workflow, /allow_staging_resume='false'/);
  assert.match(workflow, /allow_stale_staging_retirement='true'/);
  assert.match(workflow, /\{ref:"main", inputs:\{ci_run_id:\$ci_run_id, allow_staging_resume:\$resume, allow_stale_staging_retirement:\$stale, async_invocation:\$async\}\}/);
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
  assert.match(workflow, /historical_matches[\s\S]*Circuit-Rearm: ROOT_CAUSE_FIX/);
  assert.match(workflow, /BLOCKED_NEEDS_ROOT_CAUSE/);
  assert.match(workflow, /scripts\/r1-autocontinue-evidence\.mjs decision/);
  assert.match(workflow, /HISTORY_EVIDENCE_MISSING/);
  assert.match(workflow, /HISTORY_EVIDENCE_INVALID/);
  assert.match(workflow, /HISTORY_UNBOUNDED/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
});
