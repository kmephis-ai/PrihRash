import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-bootstrap-orchestrator.yml');
const DISPATCHER = resolve(ROOT, 'scripts/r1-bootstrap-orchestrator-child-workflow.mjs');

async function text(path) {
  return readFile(path, 'utf8');
}

test('R1 bootstrap orchestrator has one manual entrypoint and no autonomous trigger', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /allow_staging_resume:/);
  assert.match(workflow, /allow_stale_staging_retirement:/);
  assert.match(workflow, /default: 'false'/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule|repository_dispatch|workflow_run):/);
  assert.match(workflow, /github\.repository == 'kmephis-ai\/PrihRash'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /\.protected == true/);
  assert.match(workflow, /\.name == "CI"/);
  assert.match(workflow, /\.conclusion == "success"/);
});

test('orchestrator recovery boundary stays read-only and includes historical proof evidence', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /uses: \.\/\.github\/actions\/restore-exact-source/);
  assert.doesNotMatch(workflow, /npm run package:initial-bootstrap-recovery/);
  assert.match(workflow, /index\.initialBootstrapRecoveryHandler/);
  assert.match(workflow, /--tags r1-initial-bootstrap-recovery/);
  assert.match(workflow, /npm run initial-bootstrap-recovery:invoke/g);
  assert.match(workflow, /environment-variable=PRIHRASH_YDB_CONNECTION_STRING/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SPREADSHEET_ID/);
  assert.match(workflow, /PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.doesNotMatch(workflow, /index\.initialBootstrapHandler/);
  assert.doesNotMatch(workflow, /npm run initial-bootstrap:invoke/);
});

test('orchestrator proceeds only from bounded recovery states and performs at most one bootstrap dispatch', async () => {
  const workflow = await text(WORKFLOW);
  const bootstrapDispatches = workflow.match(/r1-bootstrap-orchestrator-child-workflow\.mjs bootstrap/g) ?? [];

  assert.equal(bootstrapDispatches.length, 1);
  assert.match(workflow, /NOT_APPLIED/);
  assert.match(workflow, /EMPTY_DURABLE_STATE/);
  assert.match(workflow, /RECOVERY_REQUIRED/);
  assert.match(workflow, /RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE/);
  assert.match(workflow, /STALE_STAGING_RETIRED/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_STALE_RETIREMENT_FRESH_BOOTSTRAP_ARMED/);
  assert.match(workflow, /STAGING_RUN_PRESENT/);
  assert.match(workflow, /inputs\.allow_staging_resume/);
  assert.match(workflow, /inputs\.allow_stale_staging_retirement/);
  assert.match(workflow, /COMPLETE_CURRENT_RUN_ONLY/);
  assert.match(workflow, /AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_STAGING_RESUME_ARMED/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_STALE_STAGING_RETIREMENT_ARMED/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_STAGING_AUTHORITY_AMBIGUOUS/);
  assert.match(workflow, /initial-bootstrap-recovery:invoke >"\$tmp" 2>"\$diag"/);
  assert.match(workflow, /extract_single_diag 'R1_STAGING_REVISION_EVIDENCE'/);
  assert.match(workflow, /extract_single_diag 'R1_STAGING_DURABLE_REVISION_EVIDENCE'/);
  assert.match(workflow, /extract_single_diag 'R1_STAGING_RETIREMENT_EVIDENCE'/);
  assert.match(workflow, /extract_single_diag 'R1_STAGING_SOURCE_DECODE_EVIDENCE'/);
  assert.match(workflow, /extract_single_diag 'R1_STAGING_EXACT_REVISION_EVIDENCE'/);
  assert.match(workflow, /EXACT_CURRENT_RUN_MATCH/);
  assert.match(workflow, /\^\$\{prefix\}=/);
  assert.doesNotMatch(workflow, /\\\$\{prefix\}/);
  assert.doesNotMatch(workflow, /R1_STAGING_REVISION_EVIDENCE=\/\/p' "\$tmp"/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_INITIAL_RECOVERY_BLOCKED/);
  assert.match(workflow, /r1-bootstrap-orchestrator-child-workflow\.mjs readiness/);
  assert.match(workflow, /\.code == "READINESS_READY"/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_MAIN_MOVED_BEFORE_BOOTSTRAP/);
  assert.doesNotMatch(workflow, /EXPECTED_FAILED_BOOTSTRAP_RUN_ID|EXPECTED_FAILED_BOOTSTRAP_SHA/);
});

test('non-success after a reached bootstrap invoke gets one read-only classification and never a second bootstrap', async () => {
  const workflow = await text(WORKFLOW);
  const recoveryInvokes = workflow.match(/npm run initial-bootstrap-recovery:invoke/g) ?? [];
  const bootstrapDispatches = workflow.match(/r1-bootstrap-orchestrator-child-workflow\.mjs bootstrap/g) ?? [];

  assert.equal(recoveryInvokes.length, 2);
  assert.equal(bootstrapDispatches.length, 1);
  assert.match(workflow, /steps\.bootstrap\.outputs\.conclusion != 'success'/);
  assert.match(workflow, /steps\.bootstrap\.outputs\.invoke_step != 'NOT_REACHED'/);
  assert.match(workflow, /steps\.bootstrap\.outputs\.invoke_step != 'skipped'/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_POST_RECOVERY_FAILED/);
  assert.doesNotMatch(workflow, /controlled.*rebuild|cleanup|timer|cutover/i);
});

test('child dispatcher can launch only canonical child workflows and fails closed on concurrency or inconsistent success evidence', async () => {
  const dispatcher = await text(DISPATCHER);

  assert.match(dispatcher, /readiness: 'r1-yandex-readiness\.yml'/);
  assert.match(dispatcher, /bootstrap: 'r1-initial-shadow-bootstrap\.yml'/);
  assert.match(dispatcher, /repository !== REPOSITORY/);
  assert.match(dispatcher, /branch\?\.commit\?\.sha !== expectedSha/);
  assert.match(dispatcher, /branch\?\.protected !== true/);
  assert.match(dispatcher, /activeMainDispatch/);
  assert.match(dispatcher, /event === 'workflow_dispatch'/);
  assert.match(dispatcher, /body: JSON\.stringify\(\{ ref: 'main' \}\)/);
  assert.match(dispatcher, /CHILD_WORKFLOW_ALREADY_ACTIVE/);
  assert.match(dispatcher, /CHILD_WORKFLOW_AMBIGUOUS/);
  assert.match(dispatcher, /Invoke exact initial bootstrap tag once/);
  assert.match(dispatcher, /run\.conclusion === 'success' && invokeStepConclusion !== 'success'/);
  assert.match(dispatcher, /result\.conclusion = 'inconsistent'/);
  assert.match(dispatcher, /result\.invokeStepConclusion = 'UNKNOWN'/);
});

test('orchestrator publishes one retained privacy-safe evidence artifact including resume authorization', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /r1-initial-bootstrap-orchestrator-evidence-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /classification\.json/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED/);
  assert.match(workflow, /R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED/);
  assert.match(workflow, /stagingResumeAuthorized/);
  assert.match(workflow, /staleStagingRetirementAuthorized/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /rawPayload|row_count|amount|notes/i);
});
