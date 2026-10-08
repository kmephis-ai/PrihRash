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
const ciClassifier = (await readFile('scripts/classify-github-ci-run.mjs', 'utf8')).replace(/\r\n/g, '\n');
const exactSourceRestore = (await readFile('.github/actions/restore-exact-source/action.yml', 'utf8')).replace(/\r\n/g, '\n');

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
  assert.match(workflow, /--argjson self_id "\$GITHUB_RUN_ID" '[\s\S]*?\.id != \$self_id and \.head_sha == \$sha/);
  assert.match(workflow, /classify-r1-recovery-deploy-attempt-history\.mjs/);
  assert.match(workflow, /PRIOR_PREWRITE_STOP_ONLY/);
  assert.match(workflow, /deploy_workflow_id=/);
  assert.match(workflow, /\.workflow_id == \$workflow_id/);
  assert.match(workflow, /--argjson deploy_workflow_id/);
  assert.doesNotMatch(workflow, /\.name == "R1 initial bootstrap recovery deploy-only attempt"/);
  assert.match(historyClassifier, /run\.display_title === expectedTitle/);
  assert.doesNotMatch(historyClassifier, /run\.name === 'R1 initial bootstrap recovery deploy-only attempt'/);
  assert.match(historyClassifier, /PREWRITE_STOP_ONLY/);
  assert.match(historyClassifier, /PRIOR_ATTEMPT_CONSUMED/);
  assert.match(historyClassifier, /SAME_SHA_PREWRITE_STOP_FORBIDDEN/);
  assert.match(workflow, /jobsByRun/);
  assert.match(workflow, /while IFS= read -r prior_run_id/);
  assert.match(workflow, /tracking_issue_number/);
  assert.match(workflow, /capture\("\^R1 #\(\?<number>\[1-9\]\[0-9\]\*\):"\)\.number/);
  assert.match(workflow, /issues\/\$\{tracking_issue_number\}/);
  assert.match(workflow, /tracking_issue_state/);
  assert.match(workflow, /'open'/);
  assert.doesNotMatch(workflow, /\.state == "OPEN"/);
  assert.doesNotMatch(workflow, /issues\/(?:453|630)/);
  assert.doesNotMatch(workflow, /R1 #453:/);
  assert.match(workflow, /Recovery-Run-ID: 37238416504/);
  assert.match(workflow, /classify-r1-recovery-deploy-attempt-history\.mjs/);
  assert.match(workflow, /PRIOR_PREWRITE_STOP_ONLY/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('current Owner authority is exact-bound to recovery 37238416504 and does not reuse the historical run', () => {
  const current = runbook.match(
    /### 2026-10-07 Owner-authorized one-shot recovery-only Function create for run `37238416504`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(current, 'the current one-shot authority must be documented separately from historical authority');
  for (const line of [
    'Provider-Attempt: READY',
    'Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED',
    'Expected-Transition: RECOVERY_ONLY_FUNCTION_VERSION_CREATE_CLASSIFIED',
    'Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED',
    'Circuit-Rearm: OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY',
    'Recovery-Run-ID: 37238416504',
    'Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs',
  ]) assert.ok(current.includes(line), `current authority marker preserves exact line: ${line}`);
  assert.match(current, /6045593970/);
  assert.match(current, /Function invoke.*out of scope/i);
  assert.doesNotMatch(current, /Recovery-Run-ID: 36341844854/);
});

test('the one-shot PR regression marker binds to this guard test and canonical exact-main CI fallback', () => {
  assert.match(workflow, /Regression-Test: tests\/tooling\/initial-bootstrap-recovery-deploy-attempt-workflow\.test\.mjs/);
  assert.match(ciClassifier, /\['push', 'workflow_dispatch'\]/);
  assert.match(exactSourceRestore, /\.event == "push" or \.event == "workflow_dispatch"/);
  assert.match(exactSourceRestore, /\.head_sha == \$sha/);
  assert.match(exactSourceRestore, /\.head_branch == "main"/);
});

test('provider preflight reuses canonical REST Function, binding and trigger reads before the one-shot create', () => {
  assert.match(workflow, /serverless-functions\.api\.cloud\.yandex\.net\/functions\/v1\/functions/);
  assert.match(workflow, /--data-urlencode "folderId=\$\{YC_FOLDER_ID\}"/);
  assert.match(workflow, /--data-urlencode "filter=\$\{function_filter\}"/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_FUNCTION_LIST_REST_TRANSPORT_FAILED/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_FUNCTION_LIST_PERMISSION_DENIED/);
  assert.match(workflow, /:listAccessBindings/);
  assert.match(workflow, /classify-yandex-function-access-bindings\.mjs/);
  assert.match(workflow, /serverless-triggers\.api\.cloud\.yandex\.net\/triggers\/v1\/triggers/);
  assert.match(workflow, /classify-yandex-trigger-list\.mjs/);
  assert.match(workflow, /--connect-timeout 5 --max-time 15 --max-filesize 1048576/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_RUNTIME_SA_READ_FAILED/);
  assert.doesNotMatch(workflow, /yc serverless function get --name/);
  assert.doesNotMatch(workflow, /yc serverless function list-access-bindings/);
  assert.doesNotMatch(workflow, /yc serverless trigger list/);
});

test('attempt creates only the recovery Function version, classifies stderr privately, and never invokes', () => {
  assert.match(workflow, /Create exactly one read-only recovery Function version without invoking it/);
  assert.match(workflow, /--execution-timeout 150s/);
  assert.match(workflow, /--retry 0/);
  assert.match(workflow, /2>"\$tmp\/version\.err"/);
  assert.match(workflow, /create_started_at=.*toISOString/);
  assert.match(workflow, /create_finished_at=.*toISOString/);
  assert.match(workflow, /functions\/v1\/functions\/\$\{encoded_function_id\}\/operations/);
  assert.match(workflow, /--data-urlencode 'pageSize=1000'/);
  assert.match(workflow, /operations_read_status='READY'/);
  assert.match(workflow, /--error-with-operation-evidence/);
  assert.match(workflow, /classify-yandex-initial-bootstrap-recovery-deploy-attempt\.mjs/);
  assert.match(workflow, /recovery-deploy-attempt\.json/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_CLASSIFIED_FAILED_NO_RETRY/);
  assert.doesNotMatch(workflow, /yc serverless function invoke/);
  assert.doesNotMatch(workflow, /yc ydb|migration_runs|source_records|source_snapshots/);
  assert.doesNotMatch(workflow, /yc iam .* (add-access-binding|set-access-bindings|remove-access-binding)/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/version\.err"/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/operations-rest\.json"/);
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
  assert.match(evidence, /`ListOperations` read-back in the bounded create window/);
  assert.match(evidence, /`PRE_OPERATION_OR_SYNC_REJECTION`/);
  assert.match(evidence, /`ASYNC_OPERATION_OBSERVED`/);
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
