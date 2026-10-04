import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile('.github/workflows/r1-initial-bootstrap-recovery.yml', 'utf8')).replace(/\r\n/g, '\n');
const packageScript = await readFile('scripts/package-yandex-initial-bootstrap-recovery-function.mjs', 'utf8');
const verifier = await readFile('scripts/verify-yandex-initial-bootstrap-recovery-package.mjs', 'utf8');
const invoker = await readFile('scripts/invoke-yandex-initial-bootstrap-recovery.mjs', 'utf8');
const bootstrapWorkflow = await readFile('.github/workflows/r1-initial-shadow-bootstrap.yml', 'utf8');
const controlledWorkflow = await readFile('.github/workflows/r1-initial-controlled-rebuild.yml', 'utf8');
const swapRecoveryWorkflow = await readFile('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml', 'utf8');
const orchestratorWorkflow = await readFile('.github/workflows/r1-initial-bootstrap-orchestrator.yml', 'utf8');
const recoveryAutocontinueWorkflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', 'utf8');
const bootstrapApplication = await readFile('src/migration/initialBootstrapApplication.ts', 'utf8');
const gateCGuard = await readFile('src/migration/initialBootstrapGateCGuard.ts', 'utf8');
const recoveryDeployHistory = await readFile('scripts/classify-r1-recovery-deploy-attempt-history.mjs', 'utf8');
const recoveryDeployClassifier = await readFile('scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs', 'utf8');

test('initial bootstrap recovery workflow stays manual-only and exact-main guarded', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /surface_only:/);
  assert.match(workflow, /RECOVERY_SURFACE_ONLY: \$\{\{ inputs\.surface_only/);
  assert.match(workflow, /controlled_preparation_only:/);
  assert.match(workflow, /RECOVERY_CONTROLLED_PREPARATION_ONLY: \$\{\{ inputs\.controlled_preparation_only/);
  assert.match(workflow, /staging_revision_cardinality_only:/);
  assert.match(workflow, /RECOVERY_REVISION_CARDINALITY_ONLY: \$\{\{ inputs\.staging_revision_cardinality_only/);
  assert.match(workflow, /causal_bootstrap_run_id:/);
  assert.match(workflow, /allow_preinvoke_async_deploy_failure:/);
  assert.match(workflow, /RECOVERY_ALLOW_PREINVOKE_ASYNC_DEPLOY_FAILURE/);
  assert.match(workflow, /CAUSAL_BOOTSTRAP_RUN_ID.*!=.*selected_run_id/);
  assert.match(workflow, /export RECOVERY_CAUSAL_BOOTSTRAP_RUN_ID="\$CAUSAL_BOOTSTRAP_RUN_ID"/);
  assert.match(workflow, /\.run_started_at/);
  assert.match(workflow, /causal_bootstrap_started_at=/);
  assert.match(workflow, /PRIHRASH_R1_RECOVERY_REVISION_CARDINALITY_ONLY=/);
  assert.match(workflow, /R1_STAGING_REVISION_CARDINALITY_EVIDENCE=/);
  assert.match(workflow, /recovery_mode_count=\$\(\(RECOVERY_SURFACE_ONLY \+ RECOVERY_CONTROLLED_PREPARATION_ONLY \+ RECOVERY_REVISION_CARDINALITY_ONLY\)\)/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_MODE_CONFLICT/);
  assert.match(workflow, /https:\/\/serverless-functions\.api\.cloud\.yandex\.net\/functions\/v1\/functions/);
  assert.match(workflow, /--header "Authorization: Bearer \$\{YC_IAM_TOKEN\}"/);
  assert.match(workflow, /--data-urlencode "folderId=\$\{YC_FOLDER_ID\}"/);
  assert.match(workflow, /--data-urlencode "filter=\$\{function_filter\}"/);
  assert.match(workflow, /function_filter="name=\\"\$\{FUNCTION_NAME\}\\""/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_LIST_REST_TRANSPORT_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_LIST_REST_AUTH_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_LIST_PERMISSION_DENIED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_LIST_REST_UNEXPECTED_STATUS/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_NOT_FOUND/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_NOT_UNIQUE/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FUNCTION_LIST_METADATA_INVALID/);
  assert.match(workflow, /\(\.nextPageToken \/\/ ""\) == ""/);
  assert.doesNotMatch(workflow, /yc serverless function (?:get --name|list --folder-id) "\$?(?:FUNCTION_NAME|YC_FOLDER_ID)"/);
  assert.doesNotMatch(workflow, /yc serverless function list-access-bindings/);
  assert.equal((workflow.match(/:listAccessBindings/g) ?? []).length, 2);
  assert.equal((workflow.match(/classify-yandex-function-access-bindings\.mjs/g) ?? []).length, 2);
  assert.equal((workflow.match(/--max-filesize 1048576/g) ?? []).length, 2);
  const runtimeResolution = workflow.indexOf('runtime_sa_id=');
  const firstBindingsClassification = workflow.indexOf('classify-yandex-function-access-bindings.mjs');
  assert.ok(runtimeResolution >= 0 && runtimeResolution < firstBindingsClassification);
  assert.match(workflow, /\$YC_WIF_SERVICE_ACCOUNT_ID" "\$runtime_sa_id"\)/);
  assert.match(workflow, /\$YC_WIF_SERVICE_ACCOUNT_ID" "\$PRIHRASH_YC_FUNCTION_SA_ID"\)/);
  assert.equal((workflow.match(/INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_INVOKER_BINDING_MISSING/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_MAIN_MOVED_BEFORE_INVOKE/);
  assert.doesNotMatch(workflow, /EXPECTED_FAILED_BOOTSTRAP_RUN_ID|EXPECTED_FAILED_BOOTSTRAP_SHA/);
  assert.match(workflow, /actions\/workflows\/r1-initial-shadow-bootstrap\.yml\/runs\?branch=main&event=workflow_dispatch&status=failure&per_page=100/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_BOOTSTRAP_HISTORY_READ_FAILED/);
  assert.match(workflow, /sort_by\(\.created_at, \.id\)/);
  assert.match(workflow, /selected_run_id/);
  assert.match(workflow, /selected_run_sha/);
  assert.match(workflow, /actions\/runs\/\$\{selected_run_id\}/);
  assert.match(workflow, /\.head_sha == \$expected_sha/);
  assert.match(workflow, /Invoke exact initial bootstrap tag once/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILURE_NOT_PROVEN/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_PREINVOKE_ASYNC_RUN_NOT_EXACT/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_PREINVOKE_ASYNC_MODE_CONFLICT/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_PREINVOKE_ASYNC_FAILURE_NOT_PROVEN/);
  assert.match(workflow, /CAUSAL_BOOTSTRAP_RUN_ID" != '36783942040'/);
  assert.match(workflow, /Deploy initial-bootstrap-only Function version"[\s\S]*?\.conclusion == "failure"/);
  assert.match(workflow, /Verify exact async invocation configuration"[\s\S]*?\.conclusion == "skipped"/);
  assert.match(workflow, /Invoke exact initial bootstrap tag once"[\s\S]*?\.conclusion == "skipped"/);
  assert.match(workflow, /Publish enum-only bootstrap evidence"[\s\S]*?\.conclusion == "skipped"/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_FAILED_ATTEMPT_MISSING/);
  assert.match(workflow, /\.conclusion == "failure"/);
  assert.doesNotMatch(workflow, /r1-initial-bootstrap-recovery-diagnostic/);
});

test('stale VALIDATED recovery holds the shared writer boundary and queued bootstrap remains Gate C blocked', () => {
  for (const writerWorkflow of [workflow, bootstrapWorkflow, controlledWorkflow, swapRecoveryWorkflow]) {
    assert.match(writerWorkflow, /concurrency:[\s\S]*group: r1-initial-bootstrap-writer[\s\S]*cancel-in-progress: false/);
  }
  assert.match(orchestratorWorkflow, /group: r1-initial-bootstrap-orchestrator/);
  assert.match(gateCGuard, /INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT/);
  assert.match(gateCGuard, /FROM migration_runs WHERE state = 'FAILED' AND error_code =/);
  assert.match(bootstrapApplication, /STALE_VALIDATED_TERMINALIZATION_REQUIRES_GATE_C/);
  assert.match(bootstrapApplication, /admissionMode === 'STALE_VALIDATED_GATE_C'/);
  assert.match(bootstrapApplication, /readInitialBootstrapGateCBlockerCount/);
  assert.match(bootstrapApplication, /blockerCount !== 1/);
  assert.match(bootstrapApplication, /else if \(await hasInitialBootstrapGateCBlocker/);
  assert.match(bootstrapApplication, /runInitialBootstrapGateCApplication/);
});

test('initial bootstrap recovery deploy keeps the same single read-only provider path', () => {
  assert.match(workflow, /--entrypoint index\.initialBootstrapRecoveryHandler/);
  assert.match(workflow, /--memory 1g/);
  assert.match(workflow, /recovery_execution_timeout='150s'/);
  assert.match(workflow, /if \[ "\$RECOVERY_CONTROLLED_PREPARATION_ONLY" = '1' \]; then[\s\S]*recovery_execution_timeout='600s'/);
  assert.match(workflow, /--execution-timeout "\$recovery_execution_timeout"/);
  assert.match(workflow, /--environment "PRIHRASH_R1_RECOVERY_SURFACE_ONLY=\$\{RECOVERY_SURFACE_ONLY\}"/);
  assert.match(workflow, /--environment "PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY=\$\{RECOVERY_CONTROLLED_PREPARATION_ONLY\}"/);
  assert.match(workflow, /if \[ -n "\$CAUSAL_BOOTSTRAP_STARTED_AT" \]; then[\s\S]*PRIHRASH_R1_RECOVERY_CAUSAL_BOOTSTRAP_STARTED_AT=\$\{CAUSAL_BOOTSTRAP_STARTED_AT\}/);
  assert.match(workflow, /"\$\{recovery_environment\[@\]\}"/);
  assert.match(workflow, /--tags r1-initial-bootstrap-recovery/);
  assert.match(workflow, /environment-variable=PRIHRASH_YDB_CONNECTION_STRING/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SPREADSHEET_ID/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(workflow, /environment-variable=PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.match(workflow, /npm run initial-bootstrap-recovery:invoke/);
});

test('exact successful source create-step and immutable tag history bypass Operation provenance before invoke', () => {
  const sourceProof = workflow.indexOf('--successful-source-step-version');
  const operationRead = workflow.indexOf('yc serverless function list-operations', sourceProof);
  const operationGet = workflow.indexOf('operation.api.cloud.yandex.net/operations/v1/operations', sourceProof);
  const auditRead = workflow.indexOf('target-folder-audit-trails.json', sourceProof);
  const successExit = workflow.indexOf("reuse_status='EXACT_RECOVERY_VERSION_CREATED'", sourceProof);
  assert.ok(sourceProof >= 0 && successExit > sourceProof);
  assert.ok(operationRead === -1 || operationRead > successExit);
  assert.ok(operationGet === -1 || operationGet > successExit);
  assert.ok(auditRead === -1 || auditRead > successExit);
  assert.match(workflow, /reuse-attempt-\$\{REUSE_DEPLOY_ATTEMPT_RUN_ID\}-jobs\.json/);
  assert.match(workflow, /Create exactly one read-only recovery Function version without invoking it/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /reuse_source_started_at=.*reuse_started_at/s);
  assert.match(workflow, /reuse_source_finished_at=.*reuse_finished_at/s);
  assert.match(workflow, /RECOVERY_REUSE_OPERATION_LIST_NOT_ATTEMPTED/);
  assert.match(workflow, /proof_observed_at="\$\(node -e 'process\.stdout\.write\(new Date\(\)\.toISOString\(\)\)'\)"/);
  assert.match(workflow, /"\$RUN_STARTED_AT" "\$RUN_FINISHED_AT" "\$proof_observed_at"/);
  assert.match(recoveryDeployClassifier, /classifyRecoveryVersionFromSuccessfulSourceStep/);
  assert.match(recoveryDeployClassifier, /functionTagHistoryRecord/);
  assert.match(recoveryDeployClassifier, /effectiveTo > observed/);
  assert.match(recoveryDeployClassifier, /exactRecoveryTaggedVersion/);
});

test('temporary audit permission probe is source-marker-bound and retires only per-run bindings', () => {
  assert.match(workflow, /audit_source_permission_probe:/);
  assert.match(workflow, /AUDIT_SOURCE_PERMISSION_PROBE: \$\{\{ inputs\.audit_source_permission_probe/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE\/AUDIT_TRAIL_LIST_PERMISSION_DENIED\/SOURCE_EVIDENCE_UNUSABLE/);
  assert.match(workflow, /TEMPORARY_AUDIT_SOURCE_READ_AND_CLASSIFY/);
  assert.match(workflow, /Authority-Scope: TEMPORARY_AUDIT_VIEWER_AT_EXACT_FOLDER_AND_LOGGING_READER_AT_EXACT_CLOUD_LOG_GROUP/);
  assert.match(workflow, /RECOVERY_REUSE_TEMP_AUDIT_VIEWER_ADDED_VERIFIED/);
  assert.match(workflow, /RECOVERY_REUSE_TEMP_LOGGING_READER_ADDED_VERIFIED/);
  assert.match(workflow, /classify-r1-temporary-audit-source-binding\.mjs/);
  assert.match(workflow, /resource-manager folder list-access-bindings --id "\$YC_FOLDER_ID"/);
  assert.match(workflow, /resource-manager folder add-access-binding --id "\$YC_FOLDER_ID"/);
  assert.match(workflow, /logging group add-access-binding --id "\$audit_log_group_id"/);
  assert.match(workflow, /remove-access-binding/);
  assert.match(workflow, /bindingRetirementEvidence/);
  const initialization = workflow.slice(
    workflow.indexOf("audit_viewer_binding_evidence='RECOVERY_REUSE_TEMP_AUDIT_VIEWER_NOT_REQUESTED'"),
    workflow.indexOf('trap write_reuse_result EXIT'),
  );
  assert.ok(initialization.indexOf("temporary_logging_reader_added='false'") >= 0);
  assert.ok(workflow.indexOf("temporary_logging_reader_added='false'") < workflow.indexOf('trap write_reuse_result EXIT'));
  assert.match(initialization, /logging_reader_binding_evidence='RECOVERY_REUSE_TEMP_LOGGING_READER_NOT_REQUESTED'/);
  assert.match(workflow, /if ! jq -cn[\s\S]*> "\$tmp\/classification\.json"; then[\s\S]*RECOVERY_REUSE_CLASSIFICATION_ARTIFACT_WRITE_FAILED/);
  assert.match(workflow, /trap write_reuse_result EXIT/);
});

test('read-only reuse requires exact accepted deploy history and version metadata, then skips every create', () => {
  assert.match(workflow, /reuse_deploy_attempt_run_id:/);
  assert.match(workflow, /reuse_failed_recovery_run_id:/);
  assert.match(workflow, /reuse_source_pr_number:/);
  assert.match(recoveryAutocontinueWorkflow, /Recovery-Version-Run-ID/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_MODE_CONFLICT/);
  assert.match(workflow, /classify-r1-recovery-deploy-attempt-history\.mjs reuse-source/);
  assert.match(workflow, /reuse_source_workflow_id=/);
  assert.match(workflow, /--argjson workflow_id "\$reuse_source_workflow_id"/);
  assert.match(recoveryDeployHistory, /sourceWorkflowId: args\[6\]/);
  assert.doesNotMatch(workflow, /\.name=="R1 initial bootstrap recovery deploy-only attempt"/);
  assert.match(recoveryDeployHistory, /RECOVERY_VERSION_REUSE_SOURCE_PROVEN/);
  assert.match(recoveryDeployHistory, /Preserve failed create as the consumed terminal outcome/);
  assert.match(recoveryAutocontinueWorkflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(recoveryAutocontinueWorkflow, /Recovery-Version-Run-ID/);
  assert.match(workflow, /Verify exact accepted recovery Function version for reuse/);
  assert.match(workflow, /classify-yandex-initial-bootstrap-recovery-deploy\.mjs/);
  assert.match(workflow, /functions\/\$\{PRIHRASH_YC_FUNCTION_ID\}:tagHistory/);
  assert.match(workflow, /data-urlencode 'pageSize=1000'/);
  assert.doesNotMatch(workflow, /functionTagHistoryRecord"\:\[\]\}/);
  assert.match(workflow, /--successful-source-step-version/);
  assert.match(workflow, /reuse-attempt-\$\{REUSE_DEPLOY_ATTEMPT_RUN_ID\}-jobs\.json/);
  assert.match(workflow, /\.started_at/);
  assert.match(workflow, /\.completed_at/);
  assert.match(workflow, /RECOVERY_REUSE_OPERATION_LIST_NOT_ATTEMPTED/);
  assert.doesNotMatch(
    workflow.slice(
      workflow.indexOf('      - name: Verify exact accepted recovery Function version for reuse'),
      workflow.indexOf('      - name: Deploy recovery-only Function version'),
    ),
    /list-operations|operation\.api\.cloud\.yandex\.net|--audit-source-decision|--audit-events/,
  );
  assert.match(workflow, /Publish enum-only accepted-version proof outcome/);
  assert.match(workflow, /steps\.reuse-version\.outcome != 'skipped'/);
  assert.match(workflow, /trap write_reuse_result EXIT/);
  assert.match(workflow, /recoveryVersionReuse:\$reuse/);
  assert.match(workflow, /versionMetadataEvidence/);
  assert.match(workflow, /tagHistoryEvidence/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_VERSION_NOT_EXACT/);
  assert.match(recoveryDeployClassifier, /EXACT_RECOVERY_VERSION_CREATED/);
  assert.match(workflow, /name: Deploy recovery-only Function version\s+if: inputs\.reuse_deploy_attempt_run_id == ''/);
  assert.match(workflow, /name: Re-verify exact current main before recovery deployment\s+if: inputs\.reuse_deploy_attempt_run_id == ''/);
  assert.match(workflow, /name: Invoke exact read-only recovery tag once\s+if: inputs\.reuse_deploy_attempt_run_id == '' \|\| steps\.reuse-version\.outputs\.reuse_status == 'EXACT_RECOVERY_VERSION_CREATED'/);
  assert.equal((workflow.match(/name: Invoke exact read-only recovery tag once/g) ?? []).length, 1);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_FAILED_PHASE_NOT_PROVEN/);
  assert.match(workflow, /RECOVERY_REUSE_CLASSIFICATION_ARTIFACT_WRITE_FAILED/);
  assert.match(workflow, /latest_history_decision/);
  assert.match(workflow, /--arg current_sha "\$GITHUB_SHA" --arg source_sha "\$source_failed_sha"/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_INTERVENING_RUN_NOT_EXACT/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_INTERVENING_PHASE_NOT_PROVEN/);
  assert.match(workflow, /\.id != \$self[\s\S]*\.created_at > \$created/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_SOURCE_PR_AUTHORITY_INVALID/);
  assert.match(workflow, /Recovery-Classification-Run-ID/);
  assert.match(workflow, /source_classification_run_id.*newer_run_id/s);
  assert.match(workflow, /\.number == \$number and \.merged_at != null and \.merge_commit_sha == \$sha/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_PR_NOT_EXACT/);
  assert.match(workflow, /capture\("\^R1 #\(\?<number>\[1-9\]\[0-9\]\*\):"\)\.number/);
  assert.match(workflow, /Recovery-Probe: READY/);
  assert.match(workflow, /READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(workflow, /Recovery-Version-Run-ID/);
  assert.match(workflow, /\$failed_run == \[\("Recovery-Run-ID: " \+ \$failed_id\)\]/);
  assert.match(workflow, /\$version_run == \[\("Recovery-Version-Run-ID: " \+ \$version_id\)\]/);
  assert.doesNotMatch(workflow, /issues\/(?:630|453)\b/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_SOURCE_MARKER_INVALID/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_VERSION_NOT_EXACT/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_VERSION_CLASSIFICATION_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_REUSE_ISSUE_INACTIVE/);
});

test('recovery reuse keeps original target phase separate from the failed preflight predecessor', (t) => {
  const sourceFailedBlock = workflow.slice(workflow.indexOf('source_failed_jobs="$(curl'));
  const sourceFailedFilter = sourceFailedBlock.match(/if ! jq -e '\n([\s\S]*?)\n\s*' <<<"\$source_failed_jobs"/)?.[1];
  assert.ok(sourceFailedFilter, 'extract the original failed recovery target phase predicate');
  const runBlock = workflow.slice(workflow.indexOf('newer_run="$(curl'));
  const runFilter = runBlock.match(/if ! jq -e --argjson id "\$newer_run_id"[\s\S]*?--argjson source_id "\$REUSE_FAILED_RECOVERY_RUN_ID" '\n([\s\S]*?)\n\s*' <<<"\$newer_run"/)?.[1];
  const jobsBlock = workflow.slice(workflow.indexOf('newer_jobs="$(curl'));
  const jobsFilter = jobsBlock.match(/if ! jq -e '\n([\s\S]*?)\n\s*' <<<"\$newer_jobs"/)?.[1];
  assert.ok(runFilter, 'extract canonical recovery run identity predicate');
  assert.ok(jobsFilter, 'extract canonical recovery phase predicate');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }
  const originalTarget = (steps) => ({ jobs: [{
    name: 'initial-bootstrap-recovery',
    conclusion: 'failure',
    steps,
  }] });
  const classifiesOriginalTarget = (value) => spawnSync('jq', ['-e', sourceFailedFilter], {
    input: JSON.stringify(value), encoding: 'utf8',
  }).status === 0;
  assert.equal(classifiesOriginalTarget(originalTarget([
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'skipped' },
    { name: 'Deploy recovery-only Function version', conclusion: 'failure' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ])), true);
  assert.equal(classifiesOriginalTarget(originalTarget([
    { name: 'Deploy recovery-only Function version', conclusion: 'failure' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ])), true);
  assert.equal(classifiesOriginalTarget(originalTarget([
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
    { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ])), false);
  assert.equal(classifiesOriginalTarget(originalTarget([
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'skipped' },
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'skipped' },
    { name: 'Deploy recovery-only Function version', conclusion: 'failure' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ])), false);
  assert.equal(classifiesOriginalTarget({ jobs: [] }), false);

  const runRecord = (overrides = {}) => ({
    id: 17,
    workflow_id: 29,
    name: 'R1 initial bootstrap recovery',
    head_branch: 'main',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    head_sha: 'c'.repeat(40),
    created_at: '2026-09-29T23:12:25Z',
    ...overrides,
  });
  const exactRun = (value, sourceId = 36341844854) => spawnSync('jq', [
    '-e', '--argjson', 'id', '17', '--argjson', 'workflow_id', '29',
    '--arg', 'current_sha', 'd'.repeat(40), '--arg', 'source_sha', 'a'.repeat(40),
    '--arg', 'source_created', '2026-09-27T18:45:46Z', '--argjson', 'source_id', String(sourceId), runFilter,
  ], { input: JSON.stringify(value), encoding: 'utf8' }).status === 0;
  assert.equal(exactRun(runRecord()), true);
  for (const mismatch of [
    { id: 18 }, { workflow_id: 30 }, { event: 'push' }, { status: 'in_progress' },
    { conclusion: 'success' }, { head_sha: 'd'.repeat(40) }, { head_sha: 'a'.repeat(40) },
    { created_at: 'invalid' }, { created_at: '2026-09-27T18:45:46Z', id: 36341844853 },
  ]) assert.equal(exactRun(runRecord(mismatch)), false, JSON.stringify(mismatch));
  assert.equal(exactRun(runRecord({ id: 17, created_at: '2026-09-27T18:45:46Z' }), 16), true);
  assert.equal(exactRun(runRecord({ id: 17, created_at: '2026-09-27T18:45:46Z' }), 18), false);

  const job = (overrides = {}) => ({ jobs: [{
    name: 'initial-bootstrap-recovery',
    conclusion: 'failure',
    steps: [
      { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
      { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
      { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
    ],
    ...overrides,
  }] });
  const exactPhases = (value) => spawnSync('jq', ['-e', jobsFilter], {
    input: JSON.stringify(value), encoding: 'utf8',
  }).status === 0;
  assert.equal(exactPhases(job()), true);
  assert.equal(exactPhases(job({ steps: [
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'skipped' },
    { name: 'Deploy recovery-only Function version', conclusion: 'failure' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ] })), true);
  assert.equal(exactPhases({ jobs: [...job().jobs, ...job().jobs] }), false);
  assert.equal(exactPhases(job({ conclusion: 'success' })), false);
  assert.equal(exactPhases(job({ steps: [] })), false);
  assert.equal(exactPhases(job({ steps: [
    ...job().jobs[0].steps,
    { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
  ] })), false);
  assert.equal(exactPhases(job({ steps: [
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
    { name: 'Deploy recovery-only Function version', conclusion: 'success' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ] })), false);
  assert.equal(exactPhases(job({ steps: [
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
    { name: 'Deploy recovery-only Function version', conclusion: 'failure' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
  ] })), false);
  assert.equal(exactPhases(job({ steps: [
    { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
    { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
    { name: 'Invoke exact read-only recovery tag once', conclusion: 'failure' },
  ] })), false);
});

test('bounded recovery history in the running workflow binds the current run and one latest predecessor', (t) => {
  const responseGuard = workflow.match(/if ! jq -e --argjson self "\$GITHUB_RUN_ID" '\n([\s\S]*?)\n\s*' <<<"\$recovery_history"/)?.[1];
  assert.ok(responseGuard, 'extract the canonical current-run and one-predecessor response guard');
  const filter = workflow.match(/latest_history_decision="\$\(jq -r --arg created "\$source_failed_created_at" --argjson id "\$REUSE_FAILED_RECOVERY_RUN_ID" '\n([\s\S]*?)\n\s*' <<<"\$recovery_history"\)"/)?.[1];
  assert.ok(filter, 'extract the canonical bounded latest-prior decision');
  assert.match(workflow, /--data-urlencode 'per_page=2'/);
  assert.match(workflow, /--data-urlencode 'sort=created' --data-urlencode 'direction=desc'/);
  assert.match(workflow, /\.workflow_runs\[0\]\.id == \$self/);
  assert.match(workflow, /latest_history_decision/);
  assert.match(workflow, /and \(\.created_at \| type == "string" and test\("\^\[0-9\]/);
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }
  const currentRunId = 500;
  const currentRun = { id: currentRunId, created_at: '2026-09-30T02:00:00Z' };
  const sourceRun = { id: 36341844854, created_at: '2026-09-27T18:45:46Z' };
  const latestCandidate = { id: 36643931461, created_at: '2026-09-29T23:12:25Z' };
  const responsePassesGuard = (history) => spawnSync('jq', [
    '-e', '--argjson', 'self', String(currentRunId), responseGuard,
  ], { input: JSON.stringify(history), encoding: 'utf8' }).status === 0;
  assert.equal(responsePassesGuard({ total_count: 20, workflow_runs: [currentRun, sourceRun] }), true);
  assert.equal(responsePassesGuard({ total_count: 20, workflow_runs: [currentRun, latestCandidate] }), true);
  assert.equal(responsePassesGuard({ total_count: 20, workflow_runs: [sourceRun, currentRun] }), false);
  assert.equal(responsePassesGuard({ total_count: 20, workflow_runs: [currentRun, sourceRun, latestCandidate] }), false);
  assert.equal(responsePassesGuard({ total_count: 20, workflow_runs: [currentRun, currentRun] }), false);
  assert.equal(responsePassesGuard({ total_count: 1, workflow_runs: [currentRun, sourceRun] }), false);
  const decide = (prior) => {
    const result = spawnSync('jq', [
      '-r', '--arg', 'created', sourceRun.created_at, '--argjson', 'id', String(sourceRun.id), filter,
    ], { input: JSON.stringify({ total_count: 20, workflow_runs: [currentRun, prior] }), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(decide(sourceRun), 'SOURCE_ONLY');
  assert.equal(decide(latestCandidate), 'NEWER:36643931461');
  assert.equal(decide({ ...latestCandidate, created_at: 'invalid' }), 'UNCLASSIFIED');
  assert.equal(decide({ ...sourceRun, id: sourceRun.id - 1 }), 'UNCLASSIFIED');
});

test('read-only reuse authorization PR is distinct from the historical deploy-authority PR', (t) => {
  const filter = workflow.match(/source_pr_marker="\$\(jq -Rn --arg body "\$source_pr_body" --arg failed_id "\$REUSE_FAILED_RECOVERY_RUN_ID" --arg version_id "\$REUSE_DEPLOY_ATTEMPT_RUN_ID" --arg permission_probe "\$AUDIT_SOURCE_PERMISSION_PROBE" '\r?\n([\s\S]*?)\r?\n            '\)"/)?.[1];
  assert.ok(filter, 'extract the canonical reuse-authorization PR marker filter');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }
  const body = [
    'Provider-Attempt: NOT_AUTHORIZED',
    'Recovery-Probe: READY',
    'Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State: STAGING_PRESENT_UNCLASSIFIED',
    'Recovery-Run-ID: 36341844854',
    'Recovery-Version-Run-ID: 36611387299',
    'Recovery-Classification-Run-ID: 36697361841',
    'Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
  ].join('\n');
  const parse = (marker) => {
    const result = spawnSync('jq', [
      '-Rn', '--arg', 'body', marker,
      '--arg', 'failed_id', '36341844854',
      '--arg', 'version_id', '36611387299', '--arg', 'permission_probe', '0', filter,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(parse(body), { valid: true, classificationRunId: '36697361841' });
  assert.equal(parse(body.replace('Recovery-Version-Run-ID: 36611387299', 'Recovery-Version-Run-ID: 36611387298')).valid, false);
  assert.equal(parse(body.replace('Recovery-Classification-Run-ID: 36697361841', 'Recovery-Classification-Run-ID: 0')).valid, false);
  assert.equal(parse(`${body}\nRecovery-Classification-Run-ID: 36697361841`).valid, false);
  assert.equal(parse(`${body}\nObserved-Signature: INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED`).valid, false);
  assert.equal(parse(body.replace('Provider-Attempt: NOT_AUTHORIZED', 'Provider-Attempt: READY')).valid, false);
  assert.deepEqual(parse(body.replace('\nRecovery-Classification-Run-ID: 36697361841', '')), {
    valid: true,
    classificationRunId: null,
  });
  const permissionBody = [
    'Provider-Attempt: READY',
    'Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_REUSE/AUDIT_TRAIL_LIST_PERMISSION_DENIED/SOURCE_EVIDENCE_UNUSABLE',
    'Expected-Transition: TEMPORARY_AUDIT_SOURCE_READ_AND_CLASSIFY',
    'Recovery-State: STAGING_PRESENT_UNCLASSIFIED',
    'Circuit-Rearm: ROOT_CAUSE_FIX',
    'Authority-Scope: TEMPORARY_AUDIT_VIEWER_AT_EXACT_FOLDER_AND_LOGGING_READER_AT_EXACT_CLOUD_LOG_GROUP',
    'Recovery-Run-ID: 36341844854',
    'Recovery-Version-Run-ID: 36611387299',
    'Recovery-Classification-Run-ID: 36709073723',
    'Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
  ].join('\n');
  const permissionResult = spawnSync('jq', [
    '-Rn', '--arg', 'body', permissionBody,
    '--arg', 'failed_id', '36341844854',
    '--arg', 'version_id', '36611387299',
    '--arg', 'permission_probe', '1', filter,
  ], { encoding: 'utf8' });
  assert.equal(permissionResult.status, 0, permissionResult.stderr);
  assert.deepEqual(JSON.parse(permissionResult.stdout), { valid: true, classificationRunId: '36709073723' });
});

test('initial bootstrap recovery persists only enum-only classification evidence', () => {
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_EVIDENCE_INVALID/);
  assert.match(workflow, /\(keys \| sort\) == \["code", "reason", "status", "verdict"\]/);
  assert.match(workflow, /\.status == "PASS"/);
  assert.match(workflow, /\.code == "INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED"/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /r1-initial-bootstrap-recovery-evidence-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /classification\.json/);
  assert.match(workflow, /R1_STAGING_CONTROLLED_PREPARATION_EVIDENCE=/);
  assert.match(workflow, /R1_STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE=/);
  assert.match(workflow, /R1_STAGING_CONTROLLED_PREPARATION_QUERY_ERROR_EVIDENCE=/);
  assert.match(workflow, /R1_STAGING_CONTROLLED_PREPARATION_GRPC_STATUS_EVIDENCE=/);
  assert.match(workflow, /R1_STAGING_CONTROLLED_PREPARATION_PHASE_EVIDENCE=/);
  assert.match(workflow, /READY\|BASELINE_EXISTS\|VALIDATION_BLOCKED\|YDB_QUERY_TIMEOUT/);
  assert.match(workflow, /YDB_DATA_QUERY_EXECUTION_FAILED/);
  assert.match(workflow, /YDB_DATA_QUERY_EXECUTION_YDB_UNAVAILABLE/);
  assert.match(workflow, /YDB_DATA_QUERY_EXECUTION_YDB_OVERLOADED/);
  assert.match(workflow, /YDB_DATA_QUERY_EXECUTION_YDB_BAD_SESSION/);
  assert.match(workflow, /DURABLE_RECONCILIATION_FAILURE\|REVISION_EVIDENCE_FAILURE\|PRIVATE_EVIDENCE_FAILURE/);
  assert.match(workflow, /APPLICATION_BOOTSTRAP_OBSERVATION_INVALID/);
  assert.match(workflow, /APPLICATION_RESUME_RUN_COUNTERS_MISMATCH/);
  assert.match(workflow, /APPLICATION_SNAPSHOT_EVIDENCE_MISMATCH/);
  assert.match(workflow, /APPLICATION_CONTROLLED_CONTINUATION_ROUTE_NOT_REQUIRED/);
  assert.match(workflow, /DIAGNOSTIC_FAILED/);
  assert.doesNotMatch(workflow, /\|APPLICATION_FAILURE\|/);
  assert.doesNotMatch(workflow, /YDB_DATA_FAILURE\|/);
  assert.doesNotMatch(workflow, /YDB_DATA_QUERY_EXECUTION_YDB_TIMEOUT/);
  assert.match(workflow, /UNOBSERVED\|NO_RETRY\|RETRIED\|NON_RETRYABLE\|EXHAUSTED\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_RETRY_EVIDENCE_INVALID/);
  assert.match(workflow, /UNOBSERVED\|ABORT_TIMEOUT\|YDB_STATUS\|GRPC_STATUS\|CLIENT_ERROR\|OTHER\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_QUERY_ERROR_EVIDENCE_INVALID/);
  assert.match(workflow, /CANCELLED\|UNKNOWN\|INVALID_ARGUMENT\|DEADLINE_EXCEEDED\|NOT_FOUND/);
  assert.match(workflow, /PERMISSION_DENIED\|RESOURCE_EXHAUSTED\|FAILED_PRECONDITION\|ABORTED/);
  assert.match(workflow, /INTERNAL\|UNAVAILABLE\|DATA_LOSS\|UNAUTHENTICATED\|NON_GRPC\|UNRECOGNIZED\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_GRPC_STATUS_EVIDENCE_INVALID/);
  assert.match(workflow, /UNOBSERVED\|ADMISSION_READ\|CURRENT_STATE_PREFLIGHT\|FRESH_CONTEXT_PREPARATION/);
  assert.match(workflow, /RESUME_CONTEXT_READ\|RESUME_IDENTITY_MANIFEST_READ\|RESUME_SNAPSHOT_READ/);
  assert.match(workflow, /RECONCILIATION_READ\|VALIDATION_EVALUATION\|CURRENT_PLAN_PREPARATION\|CURRENT_WRITE_PREPARATION/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_PHASE_EVIDENCE_INVALID/);
  assert.match(workflow, /UNOBSERVED\|LT_10_RU\|GE_10_LT_3000_RU\|GE_3000_RU\|STATS_UNAVAILABLE\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_METADATA_SCAN_COST_EVIDENCE_INVALID/);
  assert.match(workflow, /UNOBSERVED\|REFERENCE_SNAPSHOT_READ\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_REFERENCE_READ_STAGE_EVIDENCE_INVALID/);
  assert.match(workflow, /UNOBSERVED\|REVISION_METADATA_SCAN\|REVISION_PAYLOAD_BATCH\|REVISION_COLLISION_READ\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_RECONCILIATION_READ_STAGE_EVIDENCE_INVALID/);
  assert.match(workflow, /controlled-preparation\.json/);
  assert.match(workflow, /controlled-preparation-retry\.json/);
  assert.match(workflow, /controlled-preparation-query-error\.json/);
  assert.match(workflow, /controlled-preparation-grpc-status\.json/);
  assert.match(workflow, /controlled-preparation-phase\.json/);
  assert.match(workflow, /controlled-preparation-metadata-scan-cost\.json/);
  assert.match(workflow, /controlled-preparation-revision-payload-batch\.json/);
  assert.match(workflow, /AFTER_TWO_TO_FOUR_PAGES/);
  assert.match(workflow, /UNOBSERVED\|LT_10_RU\|GE_10_RU\|DIAGNOSTIC_FAILED/);
  assert.match(workflow, /controlled-preparation-historical-revision-page-progress\.json/);
  assert.match(workflow, /controlled-preparation-historical-revision-estimated-ru\.json/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_HISTORICAL_REVISION_PAGE_PROGRESS_EVIDENCE_INVALID/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_HISTORICAL_REVISION_ESTIMATED_RU_EVIDENCE_INVALID/);
  assert.match(workflow, /controlled-preparation-reference-evidence\.json/);
  assert.match(workflow, /ALL_BATCHES_WITHIN_64_KIB\|SINGLE_REVISION_EXCEEDS_64_KIB/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_REVISION_PAYLOAD_BATCH_EVIDENCE_INVALID/);
  assert.match(workflow, /REFERENCE_READER_VIKA_MEMBER_NOT_FOUND/);
  assert.match(workflow, /REFERENCE_READER_REFERENCE_SNAPSHOT_KIND_MISSING/);
  assert.match(workflow, /REFERENCE_READER_REFERENCE_SNAPSHOT_KIND_UNKNOWN/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_CONTROLLED_PREPARATION_REFERENCE_EVIDENCE_INVALID/);
  assert.match(workflow, /controlled-preparation-reference-read-stage\.json/);
  assert.match(workflow, /controlled-preparation-reconciliation-read-stage\.json/);
  assert.match(workflow, /staging-run-lineage\.json/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_STAGING_RUN_LINEAGE_EVIDENCE_INVALID/);
  assert.match(workflow, /causal_bootstrap_run_id:/);
  assert.match(workflow, /CAUSAL_BOOTSTRAP_RUN_ID.*inputs\.causal_bootstrap_run_id/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_CAUSAL_RUN_NOT_LATEST_FAILED_CHILD/);
  assert.match(workflow, /\.run_started_at/);
  assert.match(workflow, /causal_bootstrap_started_at=/);
  assert.match(workflow, /PRIHRASH_R1_RECOVERY_CAUSAL_BOOTSTRAP_STARTED_AT/);
  assert.match(workflow, /staging-run-lineage\.json/);
  assert.match(workflow, /STAGING_STARTED_AFTER_BOOTSTRAP_CHILD\|STAGING_PREDATES_BOOTSTRAP_CHILD/);
  assert.match(workflow, /retention-days: 30/);
});

test('initial bootstrap recovery invoker exposes enum-only classification evidence', () => {
  assert.match(invoker, /INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/);
  assert.match(invoker, /INVOKE_TIMEOUT_MS = 180_000/);
  assert.match(invoker, /CONTROLLED_PREPARATION_INVOKE_TIMEOUT_MS = 630_000/);
  assert.match(invoker, /RECOVERY_CONTROLLED_PREPARATION_ONLY === '1'[\s\S]*CONTROLLED_PREPARATION_INVOKE_TIMEOUT_MS/);
  assert.match(invoker, /exactKeys\(result, \['status', 'code', 'verdict', 'reason'\]\)/);
  assert.match(invoker, /COMMITTED_DURABLE_STATE/);
  assert.match(invoker, /RESIDUAL_REFERENCE_STATE_WITHOUT_RUN/);
  assert.match(invoker, /RESIDUAL_MIXED_STATE_WITHOUT_RUN/);
  assert.match(invoker, /RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE/);
  assert.match(invoker, /RESIDUAL_REFERENCE_STATE_MISMATCH/);
  assert.match(invoker, /REFERENCE_RECONCILIATION_FAILED/);
  assert.doesNotMatch(invoker, /row_count|rows_seen|committedRowsSeen|sourceRecords/);
});

test('initial bootstrap recovery package excludes write-capable runtime entrypoints', () => {
  assert.match(packageScript, /initialBootstrapRecoveryJob\.js/);
  assert.match(packageScript, /yandexCloudInitialBootstrapRecoveryFunction\.js/);
  assert.doesNotMatch(packageScript, /'initialBootstrapJob\.js'/);
  assert.match(verifier, /initialBootstrapResidualSurface\.js/);
  assert.match(verifier, /initialBootstrapReferenceReconciliation\.js/);
  assert.match(verifier, /initialBootstrapReferenceSemantics\.js/);
  assert.match(verifier, /initialStaleValidatedHistoricalSwapProof\.js/);
  assert.match(verifier, /initialStaleValidatedHistoricalCandidate\.js/);
  assert.match(verifier, /initialBootstrapPrivateEvidence\.js/);
  assert.match(verifier, /ydbReferenceEvidenceReader\.js/);
  assert.match(verifier, /recovery module contains a write-capable statement or transaction call/);
  assert.match(verifier, /dist\/runtime\/yandexCloudInitialBootstrapFunction\.js/);
  assert.match(verifier, /dist\/runtime\/scheduledSyncJob\.js/);
});


test('VALIDATED source and Gate A blocker evidence are stored separately and remain allowlisted', async () => {
  const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery.yml', 'utf8');
  assert.match(workflow, /R1_VALIDATED_SOURCE_EVIDENCE=/);
  assert.match(workflow, /VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY/);
  assert.match(workflow, /AUTHORITATIVE_SNAPSHOT_MATCH\|AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH\|AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED\|AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_VALIDATED_SOURCE_EVIDENCE_INVALID; exit 1/);
  assert.match(workflow, /validated-source\.json/);
  assert.match(workflow, /R1_STALE_VALIDATED_GATE_BLOCKER=/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_STALE_VALIDATED_GATE_BLOCKER_INVALID; exit 1/);
  assert.match(workflow, /gate-a\.json/);
  assert.ok(workflow.includes('r1-initial-bootstrap-recovery-evidence/*.json'));
});


test('controlled preparation recovery diagnostic preserves the controlled timeout envelope without write authority', async () => {
  const runtime = await readFile('src/runtime/initialBootstrapRecoveryJob.ts', 'utf8');
  assert.match(runtime, /INITIAL_RECOVERY_CONTROLLED_PREPARATION_YDB_READY_TIMEOUT_MS = 10_000/);
  assert.match(runtime, /INITIAL_RECOVERY_CONTROLLED_PREPARATION_YDB_READ_TIMEOUT_MS = 21_000/);
  assert.match(runtime, /INITIAL_RECOVERY_CONTROLLED_PREPARATION_YDB_TRANSACTION_TIMEOUT_MS = 25_000/);
  assert.doesNotMatch(runtime, /readRequestUnitObserver/);
  assert.match(runtime, /createInitialBootstrapControlledPreparationMetadataScanCostTracker/);
  assert.match(runtime, /metadataScanCostEvidence: 'UNOBSERVED' as const/);
  assert.match(runtime, /REVISION_METADATA_SCAN/);
  assert.match(runtime, /prepareInitialControlledRebuildContinuation/);
  assert.match(runtime, /node:diagnostics_channel/);
  assert.match(runtime, /ydb:retry\.attempt\.completed/);
  assert.match(runtime, /ydb:retry\.exhausted/);
  assert.match(runtime, /tracing:ydb:query\.execute/);
  assert.match(runtime, /tracingChannel\(YDB_QUERY_EXECUTE_TRACE_CHANNEL\)\.error/);
  assert.match(runtime, /queryErrorChannel\.subscribe\(onQueryError\)/);
  assert.match(runtime, /queryErrorChannel\.unsubscribe\(onQueryError\)/);
  assert.doesNotMatch(runtime, /Reflect\.get\(candidate, '(?:text|query|parameters|sessionId|nodeId|txId|driver|database|address)'\)/);
  assert.doesNotMatch(runtime, /Reflect\.get\(candidate, '(?:message|details|metadata|stack)'\)/);
  assert.match(runtime, /case 4: return 'DEADLINE_EXCEEDED'/);
  assert.match(runtime, /case 8: return 'RESOURCE_EXHAUSTED'/);
  assert.match(runtime, /case 14: return 'UNAVAILABLE'/);
  assert.match(runtime, /case 16: return 'UNAUTHENTICATED'/);
  assert.match(runtime, /createInitialBootstrapControlledPreparationPhaseTracker/);
  assert.match(runtime, /observePhase\(nextPhase: InitialBootstrapApplicationPhase\)/);
  assert.match(runtime, /phaseTracker\?\.observePhase\(nextPhase\)/);
  assert.match(runtime, /INITIAL_BOOTSTRAP_APPLICATION_PHASES/);
  assert.match(runtime, /\.subscribe\(onAttemptCompleted\)/);
  assert.match(runtime, /\.unsubscribe\(onAttemptCompleted\)/);
  assert.match(runtime, /\.subscribe\(onExhausted\)/);
  assert.match(runtime, /\.unsubscribe\(onExhausted\)/);
  assert.doesNotMatch(runtime, /lastError/);
  assert.doesNotMatch(runtime, /@ydbjs\/retry/);
  assert.doesNotMatch(runtime, /runInitialControlledRebuildApplication/);
  assert.doesNotMatch(runtime, /executeMigrationRunLifecycleWrite/);
  assert.doesNotMatch(runtime, /executeInitialControlledRebuildSetup/);
  assert.doesNotMatch(runtime, /executeControlledInitialSwap/);
  assert.doesNotMatch(workflow, /initial-controlled-rebuild:invoke/);
});

test('revision-cardinality diagnostic is one coarse metadata-only read without Google or payload', async () => {
  const diagnostic = await readFile('src/migration/initialBootstrapStagingRevisionDiagnostic.ts', 'utf8');
  const recoveryJob = await readFile('src/runtime/initialBootstrapRecoveryJob.ts', 'utf8');
  assert.match(diagnostic, /stagingManifestCardinalityStatement/);
  assert.match(diagnostic, /m\.binding_count AS binding_count/);
  assert.match(diagnostic, /LT_5000_RU/);
  assert.match(diagnostic, /GE_5000_LT_5500_RU/);
  assert.match(diagnostic, /GE_5500_LT_6000_RU/);
  assert.match(diagnostic, /GE_6000_RU/);
  assert.match(diagnostic, /bindingCount \+ Math\.floor\(bindingCount \/ 9\) \+ 2/);
  assert.doesNotMatch(diagnostic, /stagingManifestCardinalityStatement\(\)[\s\S]{0,500}m\.bindings/);
  assert.match(recoveryJob, /if \(revisionCardinalityOnly\)[\s\S]*diagnoseStagingRevisionCardinality/);
  assert.match(workflow, /recovery_execution_timeout='150s'/);
  assert.match(workflow, /if \[ "\$RECOVERY_CONTROLLED_PREPARATION_ONLY" = '1' \]/);
  assert.match(workflow, /recovery_mode_count=\$\(\(RECOVERY_SURFACE_ONLY \+ RECOVERY_CONTROLLED_PREPARATION_ONLY \+ RECOVERY_REVISION_CARDINALITY_ONLY\)\)/);
});
