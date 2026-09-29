import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile(
  '.github/workflows/r1-initial-bootstrap-recovery-deploy-attempt.yml', 'utf8',
)).replace(/\r\n/g, '\n');
const runbook = (await readFile('docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md', 'utf8')).replace(/\r\n/g, '\n');
const historyClassifier = (await readFile(
  'scripts/classify-r1-recovery-deploy-attempt-history.mjs', 'utf8',
)).replace(/\r\n/g, '\n');

test('Owner-authorized recovery deploy-only attempt is exact-main, exact-PR/run, and one-shot', () => {
  assert.match(workflow, /workflow_dispatch:[\s\S]*failed_run_id:[\s\S]*ci_run_id:[\s\S]*source_pr_number:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /actions\/runs\/\$\{CI_RUN_ID\}/);
  assert.match(workflow, /CI_RUN_EXACT_SUCCESS/);
  assert.match(workflow, /merge_commit_sha == \$sha/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED/);
  assert.match(workflow, /Invoke exact read-only recovery tag once" and \.conclusion == "skipped"/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_ALREADY_CONSUMED_FOR_FAILED_RUN/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_ALREADY_USED_FOR_SHA/);
  assert.match(workflow, /classify-r1-recovery-deploy-attempt-history\.mjs/);
  assert.match(workflow, /PRIOR_PREWRITE_STOP_ONLY/);
  assert.match(historyClassifier, /PREWRITE_STOP_ONLY/);
  assert.match(historyClassifier, /PRIOR_ATTEMPT_CONSUMED/);
  assert.match(historyClassifier, /SAME_SHA_PREWRITE_STOP_FORBIDDEN/);
  assert.match(workflow, /issue_630_state/);
  assert.match(workflow, /\$issue_630_state/);
  assert.match(workflow, /'open'/);
  assert.doesNotMatch(workflow, /\.state == "OPEN"/);
  assert.doesNotMatch(workflow, /issues\/453/);
  assert.match(workflow, /classify-r1-recovery-deploy-attempt-history\.mjs/);
  assert.match(workflow, /PRIOR_PREWRITE_STOP_ONLY/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('attempt creates only the recovery Function version, classifies stderr privately, and never invokes', () => {
  assert.match(workflow, /Create exactly one read-only recovery Function version without invoking it/);
  assert.match(workflow, /--execution-timeout 150s/);
  assert.match(workflow, /--retry 0/);
  assert.match(workflow, /2>"\$tmp\/version\.err"/);
  assert.match(workflow, /classify-yandex-initial-bootstrap-recovery-deploy-attempt\.mjs/);
  assert.match(workflow, /recovery-deploy-attempt\.json/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_CLASSIFIED_FAILED_NO_RETRY/);
  assert.doesNotMatch(workflow, /yc serverless function invoke/);
  assert.doesNotMatch(workflow, /yc ydb|migration_runs|source_records|source_snapshots/);
  assert.doesNotMatch(workflow, /yc iam .* (add-access-binding|set-access-bindings|remove-access-binding)/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/version\.err"/);
});

test('the workflow publishes only the enum artifact and reasserts exact main after the attempt', () => {
  assert.match(workflow, /Re-assert exact main after the one-shot deploy-only result/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_MAIN_MOVED_AFTER_CREATE/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/version\.(?:json|err)"/);
});

test('the authorized single deploy-only result has a documented terminal decision and no auto-invoke', () => {
  const evidence = runbook.match(
    /### Owner-authorized one-shot recovery-only Function deploy after PR #869([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the one-shot authority and terminal outcomes must remain documented');
  assert.match(evidence, /Owner authorized in chat exactly one new recovery-only/);
  assert.match(evidence, /Function invoke explicitly out of[\s\S]*?scope/);
  assert.match(evidence, /SOURCE_EVIDENCE_UNUSABLE/);
  assert.match(evidence, /RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE/);
  assert.match(evidence, /Every possible result\s+consumes the one-shot authority/);
  assert.match(evidence, /Provider-Attempt: READY/);
  assert.match(evidence, /Circuit-Rearm: OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY/);
});

test('PR #870 issue-state casing preflight stopped before provider create and consumed no attempt', () => {
  const evidence = runbook.match(
    /#### PR #870 stopped before the authorized create on the issue-state casing guard([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the pre-provider issue-state defect must be recorded as non-consuming');
  assert.match(evidence, /`RECOVERY_DEPLOY_ATTEMPT_ISSUE_INACTIVE`/);
  assert.match(evidence, /Create exactly one read-only recovery Function version without/);
  assert.match(evidence, /was `skipped`/);
  assert.match(evidence, /lowercase `open`/);
  assert.match(evidence, /one-shot create allowance was\nnot consumed/);
  assert.match(evidence, /only a prior exact failed-run attempt whose create step was reached consumes the allowance/);
});
