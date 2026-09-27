import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery-deploy-recovery.yml', 'utf8');
const autocontinue = await readFile('.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', 'utf8');
const classifier = await readFile('scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs', 'utf8');

test('failed recovery Function deploy has an exact-main read-only metadata recovery path', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /failed_run_id:/);
  assert.match(workflow, /group: r1-initial-bootstrap-writer[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /\.commit\.sha == \$sha and \.protected == true/);
  assert.match(workflow, /RECOVERY_DEPLOY_EXACT_SHA_CI_MISSING/);
  assert.match(workflow, /RECOVERY_DEPLOY_FAILED_RUN_NOT_LATEST/);
  assert.match(workflow, /Deploy recovery-only Function version/);
  assert.match(workflow, /Invoke exact read-only recovery tag once/);
  assert.match(workflow, /RECOVERY_DEPLOY_FAILURE_PHASE_NOT_PROVEN/);
  assert.match(workflow, /RECOVERY_DEPLOY_WRITER_CONFLICT/);
  assert.match(workflow, /Re-assert exact current main after read-only provider classification/);
});

test('recovery deploy classification reads provider metadata only and publishes an enum artifact', () => {
  assert.match(workflow, /yc serverless function version list/);
  assert.match(workflow, /yc serverless function list-operations/);
  assert.match(workflow, /yc serverless function version get-by-tag/);
  assert.match(workflow, /classify-yandex-initial-bootstrap-recovery-deploy\.mjs/);
  assert.match(workflow, /r1-initial-bootstrap-recovery-deploy-evidence-/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.doesNotMatch(workflow, /yc serverless function version create/);
  assert.doesNotMatch(workflow, /yc serverless function invoke/);
  assert.doesNotMatch(workflow, /Google|YDB|Lockbox|source_records|migration_runs/);
  assert.match(classifier, /ENUMS\.has\(result\) \? result : 'DIAGNOSTIC_FAILED'/);
  assert.doesNotMatch(classifier, /process\.stderr|console\.(?:log|error)/);
});

test('recovery autocontinue routes only the deployment-classification marker to this workflow', () => {
  assert.match(autocontinue, /READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION/);
  assert.match(autocontinue, /DEPLOYMENT_OUTCOME_UNCLASSIFIED/);
  assert.match(autocontinue, /Recovery-Run-ID: \[1-9\]\[0-9\]\*/);
  assert.match(autocontinue, /r1-initial-bootstrap-recovery-deploy-recovery\.yml/);
  assert.match(autocontinue, /inputs:\{failed_run_id:\$run_id\}/);
  assert.match(autocontinue, /"\$api\/actions\/workflows\/\$recovery_workflow\/dispatches"/);
  assert.match(autocontinue, /RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID/);
  assert.match(autocontinue, /any\(\.\[]; \.filename == \$test and \.status != "removed"\)/);
  assert.match(autocontinue, /\.github\/workflows\/r1-initial-bootstrap-recovery-autocontinue\.yml/);
  assert.doesNotMatch(autocontinue, /\.github\/workflows\/r1-initial-bootstrap-recovery-deploy-recovery\.yml" and \.status != "removed"/);
});
