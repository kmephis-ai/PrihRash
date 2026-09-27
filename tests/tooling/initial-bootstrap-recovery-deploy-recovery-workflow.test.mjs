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
  assert.match(workflow, /serverless-functions\.api\.cloud\.yandex\.net\/functions\/v1\/functions\/\$\{function_id\}:tagHistory/);
  assert.match(workflow, /data-urlencode "tag=\$\{TARGET_TAG\}"/);
  assert.match(workflow, /data-urlencode 'pageSize=1000'/);
  assert.match(workflow, /classify-yandex-initial-bootstrap-recovery-deploy\.mjs/);
  assert.match(workflow, /CREATE_OPERATION_AMBIGUOUS\|CREATE_OPERATION_IN_PROGRESS/);
  assert.match(workflow, /RECOVERY_TAGGED_VERSION_CANDIDATE_PRESENT\|RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW/);
  assert.match(workflow, /RECOVERY_DEPLOY_INPUT_INVALID\|RECOVERY_VERSION_ENTRY_INVALID\|RECOVERY_VERSION_TAGS_INVALID\|RECOVERY_VERSION_TIMESTAMP_INVALID\|RECOVERY_METADATA_JSON_INVALID\|RECOVERY_CLASSIFIER_INTERNAL_ERROR\|RECOVERY_TAG_HISTORY_READ_FAILED\|RECOVERY_TAG_HISTORY_METADATA_INVALID\|RECOVERY_TAG_HISTORY_INCOMPLETE\|RECOVERY_TAG_HISTORY_AMBIGUOUS\|RECOVERY_TAG_HISTORY_VERSION_NOT_OBSERVED\|RECOVERY_TAG_HISTORY_VERSION_CANDIDATE_PRESENT\) ;;/);
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
  assert.match(autocontinue, /DEPLOY_RUN_NOT_LATEST_FAILED/);
  assert.match(autocontinue, /DEPLOY_RUN_PHASE_NOT_PROVEN/);
  assert.match(autocontinue, /Deploy recovery-only Function version" and \.conclusion == "failure"/);
  assert.match(autocontinue, /Invoke exact read-only recovery tag once" and \.conclusion == "skipped"/);
  assert.match(autocontinue, /r1-initial-bootstrap-recovery-deploy-recovery\.yml/);
  assert.match(autocontinue, /inputs:\{failed_run_id:\$run_id\}/);
  assert.match(autocontinue, /"\$api\/actions\/workflows\/\$recovery_workflow\/dispatches"/);
  assert.match(autocontinue, /RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID/);
  assert.match(autocontinue, /any\(\.\[]; \.filename == \$test and \.status != "removed"\)/);
  assert.match(autocontinue, /\.filename == "\.github\/workflows\/r1-initial-bootstrap-recovery-autocontinue\.yml"/);
  assert.match(autocontinue, /\.filename == "\.github\/workflows\/r1-initial-bootstrap-recovery-deploy-recovery\.yml"/);
  assert.match(autocontinue, /\.filename == "scripts\/classify-yandex-initial-bootstrap-recovery-deploy\.mjs"/);
  assert.match(autocontinue, /or\s+\([\s\S]*any\(\.\[]; \.filename == "\.github\/workflows\/r1-initial-bootstrap-recovery-deploy-recovery\.yml"/);
  assert.match(autocontinue, /\.github\/workflows\/r1-initial-bootstrap-recovery-deploy-recovery\.yml/);
  assert.match(autocontinue, /scripts\/classify-yandex-initial-bootstrap-recovery-deploy\.mjs/);
  assert.doesNotMatch(autocontinue, /\.filename == "AGENTS\.md"/);
  assert.match(autocontinue, /RECOVERY_AUTOCONTINUE_DEPLOY_RUN_NOT_LATEST_FAILED/);
  assert.match(autocontinue, /RECOVERY_AUTOCONTINUE_DEPLOY_RUN_PHASE_NOT_PROVEN/);
  assert.match(autocontinue, /actions\/workflows\/r1-initial-bootstrap-recovery\.yml\/runs\?branch=main&event=workflow_dispatch&status=failure/);
  assert.match(autocontinue, /Deploy recovery-only Function version" and \.conclusion == "failure"/);
  assert.match(autocontinue, /Invoke exact read-only recovery tag once" and \.conclusion == "skipped"/);
});
