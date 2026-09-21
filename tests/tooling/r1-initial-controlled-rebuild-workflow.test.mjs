import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(ROOT, path), 'utf8');

test('R1 controlled rebuild workflow is manual exact-main and explicit-authority only', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /name: R1 initial controlled rebuild/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*tracking_issue:[\s\S]*expected_main_sha:[\s\S]*recovery_run_id:[\s\S]*readiness_run_id:[\s\S]*deploy_recovery_run_id:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /\bpush:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /Provider-Authority: WU7_CONTROLLED_REBUILD/);
  assert.match(workflow, /Authority-Scope: PRODUCTION_YDB_INITIAL_SHADOW_ONLY/);
  assert.match(workflow, /Cap-Increase: FORBIDDEN/);
  assert.match(workflow, /Blind-Replay: FORBIDDEN/);
  assert.doesNotMatch(workflow, /issues\/630/);
});

test('R1 controlled rebuild binds exact recovery and readiness artifacts before provider mutation', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  const recoveryGate = workflow.indexOf('Prove exact safe resumable recovery and READINESS_READY evidence');
  const providerBoundary = workflow.indexOf('Fail closed if dedicated provider boundary is unsafe');
  const deploy = workflow.indexOf('Deploy initial-controlled-rebuild-only Function version');
  const invoke = workflow.indexOf('Invoke exact controlled rebuild tag synchronously once');
  assert.equal(recoveryGate > 0 && recoveryGate < providerBoundary && providerBoundary < deploy && deploy < invoke, true);
  assert.match(workflow, /r1-initial-bootstrap-recovery-evidence-\$\{\{ inputs\.recovery_run_id \}\}/);
  assert.match(workflow, /r1-yandex-readiness-evidence-\$\{\{ inputs\.readiness_run_id \}\}/);
  assert.match(workflow, /\.verdict == "RECOVERY_REQUIRED"/);
  assert.match(workflow, /\.reason == "STAGING_RUN_PRESENT" or \.reason == "VALIDATED_CURRENT_EMPTY_STAGING_ABSENT" or \.reason == "VALIDATED_CURRENT_EMPTY_STAGING_EMPTY"/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_DEPLOY_RECOVERY_YDB_STATE_NOT_SAFE/);
  assert.match(workflow, /\.code == "READINESS_READY"/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_WRITER_CONFLICT/);
});

test('R1 controlled rebuild deploy is private trigger-free and exposes only dedicated handler', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /--entrypoint index\.initialControlledRebuildHandler/);
  assert.match(workflow, /--source-path \.artifacts\/yandex-initial-controlled-rebuild-function/);
  assert.match(workflow, /--tags r1-initial-controlled-rebuild/);
  assert.match(workflow, /--execution-timeout 600s/);
  assert.match(workflow, /--memory 1g/);
  assert.doesNotMatch(workflow, /--async-max-retries/);
  assert.doesNotMatch(workflow, /--async-service-account-id/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_WIF_INVOKER_BINDING_MISSING/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_WIF_EDITOR_BINDING_MISSING/);
  assert.match(workflow, /functions\.editor/);
  assert.doesNotMatch(workflow, /INITIAL_CONTROLLED_REBUILD_ASYNC_RUNTIME_INVOKER_BINDING_MISSING/);
  assert.doesNotMatch(workflow, /PRIHRASH_ASYNC_INVOKER_SA_ID/);
  assert.doesNotMatch(workflow, /--async-success-ymq-arn|--async-failure-ymq-arn/);
  assert.doesNotMatch(workflow, /--no-logging/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_FUNCTION_PUBLIC/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_FUNCTION_TRIGGER_PRESENT/);
  assert.match(workflow, /PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.doesNotMatch(workflow, /PRIHRASH_INITIAL_CONTROLLED_REBUILD_PRIVATE_HISTORICAL_EVIDENCE/);
});

test('controlled rebuild selects exact provider reuse or deploy mode from deploy recovery evidence', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /deploy_recovery_run_id:/);
  assert.match(workflow, /id: prerequisites/);
  assert.match(workflow, /r1-initial-controlled-rebuild-deploy-recovery-evidence-\$\{\{ inputs\.deploy_recovery_run_id \}\}/);
  assert.match(workflow, /\.verdict == "APPLIED"/);
  assert.match(workflow, /\.reason == "EXACT_ACTIVE_TAG"/);
  assert.match(workflow, /provider_mode=reuse/);
  assert.doesNotMatch(workflow, /provider_mode=repair/);
  assert.match(workflow, /provider_mode=deploy/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_DEPLOY_RECOVERY_YDB_STATE_NOT_SAFE/);
  assert.match(workflow, /if: \$\{\{ steps\.prerequisites\.outputs\.provider_mode != 'reuse' \}\}/);
  assert.match(workflow, /provider_mode == 'reuse'.*steps\.provider-deploy\.outcome == 'success'/);
  assert.doesNotMatch(workflow, /INITIAL_CONTROLLED_REBUILD_PROVIDER_REPAIRED/);
  assert.match(workflow, /serverless function version list --function-id/);
  assert.match(workflow, /serverless function version get-by-tag/);
  assert.match(workflow, /--format json-rest/);
  assert.match(workflow, /serviceAccountId/);
  assert.doesNotMatch(workflow, /asyncInvocationConfig/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_POSTFLIGHT_TAG_READ_FAILED/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_POSTFLIGHT_TAG_NOT_EXACT_ACTIVE/);
});

test('controlled rebuild timeout telemetry exposes only allowlisted phase enums and never raw provider logs', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  const runtime = await read('src/runtime/initialControlledRebuildJob.ts');
  const fn = await read('src/runtime/yandexCloudInitialControlledRebuildFunction.ts');
  assert.match(runtime, /InitialControlledRebuildRuntimePhase/);
  assert.match(runtime, /BOOTSTRAP_\$\{InitialBootstrapApplicationPhase\}/);
  assert.match(runtime, /CONTROLLED_\$\{InitialControlledRebuildApplicationPhase\}/);
  assert.match(runtime, /Diagnostics must never change controlled rebuild behavior or authority/);
  assert.match(fn, /R1_CONTROLLED_PHASE:/);
  assert.match(fn, /formatInitialControlledRebuildPhaseMarker/);
  assert.match(workflow, /Classify enum-only controlled runtime phase/);
  assert.match(workflow, /serverless function logs/);
  assert.match(workflow, /--tag r1-initial-controlled-rebuild/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_PHASE_CLASSIFIED/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE/);
  assert.match(workflow, /LOG_READ_FAILED/);
  assert.match(workflow, /MARKER_MISSING/);
  assert.match(workflow, /r1-initial-controlled-rebuild-phase-\$\{\{ github\.run_id \}\}/);
  assert.doesNotMatch(workflow, /path:.*r1-initial-controlled-rebuild-provider-logs\.raw/);
});

test('controlled rebuild invokes synchronously once and requires exact COMMITTED result', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /Invoke exact controlled rebuild tag synchronously once/);
  assert.match(workflow, /PRIHRASH_INITIAL_CONTROLLED_REBUILD_INVOKE_MODE=sync/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_COMMITTED/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_NONCOMMITTED_RECOVERY_REQUIRED/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_INVOKE_FUNCTION_TIMEOUT/);
  assert.match(workflow, /functionError/);
  assert.match(workflow, /PRESENT/);
  assert.match(workflow, /ABSENT/);
  assert.match(workflow, /bootstrapPhase/);
  assert.match(workflow, /ydbDataFailureCode/);
  assert.match(workflow, /QUERY_EXECUTION_YDB_UNAVAILABLE/);
  assert.match(workflow, /QUERY_EXECUTION_YDB_TIMEOUT/);
  const ydbSubtypeGuards = workflow.match(/ydbDataFailureCode/g) ?? [];
  assert.equal(ydbSubtypeGuards.length >= 4, true);
  assert.match(await read('src/runtime/initialControlledRebuildJob.ts'), /error instanceof YdbJsV6DataTransportError \? error\.code : null/);
  assert.match(workflow, /ADMISSION_READ[\s\S]*RESUME_CONTEXT_READ[\s\S]*RESUME_IDENTITY_MANIFEST_READ[\s\S]*RESUME_SNAPSHOT_READ[\s\S]*CURRENT_WRITE_PREPARATION/);
  const reconciliationGuards = workflow.match(/\.bootstrapPhase \| IN\([^)]*"RECONCILIATION_READ"/g) ?? [];
  assert.equal(reconciliationGuards.length, 2);
  assert.match(workflow, /MODULE_LOAD_FAILED[\s\S]*HANDLER_UNCAUGHT/);
  assert.doesNotMatch(workflow, /INITIAL_CONTROLLED_REBUILD_ASYNC_ACCEPTED/);
  assert.doesNotMatch(workflow, /Record provider repair-only evidence/);
});


test('provider deploy failure is preserved as privacy-safe enum evidence without blind continuation', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /id: provider-deploy/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_PROVIDER_DEPLOY_FAILED/);
  assert.match(workflow, /SERVICE_ACCOUNT_NOT_AVAILABLE/);
  assert.match(workflow, /PERMISSION_DENIED/);
  assert.match(workflow, /permissionBoundary/);
  assert.match(workflow, /\["code","failureClass","permissionBoundary","status"\]/);
  assert.match(workflow, /WIF_SERVICE_ACCOUNT_RESOURCE/);
  assert.match(workflow, /RUNTIME_SERVICE_ACCOUNT_RESOURCE/);
  assert.match(workflow, /FUNCTION_RESOURCE/);
  assert.match(workflow, /ACCESS_POLICY/);
  assert.match(workflow, /UNRESOLVED/);
  assert.match(workflow, /INVALID_ARGUMENT/);
  assert.match(workflow, /SOURCE_PACKAGE_FAILED/);
  assert.match(workflow, /TRANSPORT_FAILED/);
  assert.match(workflow, /steps\.provider-deploy\.outcome == 'failure'/);
  assert.match(workflow, /steps\.provider-deploy\.outcome == 'success'/);
  assert.match(workflow, /provider_mode == 'reuse' \|\| steps\.provider-deploy\.outcome == 'success'/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/version\.err"/);
  assert.doesNotMatch(workflow, /tee "\$tmp\/version\.err"/);
});

test('controlled rebuild bounds YDB ready, read and transaction lifetimes below HTTP transport boundary', async () => {
  const runtime = await read('src/runtime/initialControlledRebuildJob.ts');
  assert.match(runtime, /INITIAL_CONTROLLED_REBUILD_YDB_READY_TIMEOUT_MS = 10_000/);
  assert.match(runtime, /INITIAL_CONTROLLED_REBUILD_YDB_READ_TIMEOUT_MS = 21_000/);
  assert.match(runtime, /INITIAL_CONTROLLED_REBUILD_YDB_TRANSACTION_TIMEOUT_MS = 25_000/);
  assert.match(runtime, /readyTimeoutMs: INITIAL_CONTROLLED_REBUILD_YDB_READY_TIMEOUT_MS/);
  assert.match(runtime, /readTimeoutMs: INITIAL_CONTROLLED_REBUILD_YDB_READ_TIMEOUT_MS/);
  assert.match(runtime, /transactionTimeoutMs: INITIAL_CONTROLLED_REBUILD_YDB_TRANSACTION_TIMEOUT_MS/);
});

test('controlled rebuild releases Google source scope before application continuation', async () => {
  const runtime = await read('src/runtime/initialControlledRebuildJob.ts');
  const runStart = runtime.indexOf('export async function runInitialControlledRebuildJob(');
  const runBody = runtime.slice(runStart);
  assert.match(runtime, /async function readInitialControlledRebuildObservation[\s\S]*createCanonicalSourceDigest[\s\S]*new GoogleSheetsFullSnapshotReader[\s\S]*readFullSnapshotObservation[\s\S]*buildInitialBootstrapObservation/);
  assert.match(runBody, /await readInitialControlledRebuildObservation/);
  assert.doesNotMatch(runBody, /new GoogleSheetsFullSnapshotReader/);
  assert.doesNotMatch(runBody, /const digest = createCanonicalSourceDigest/);
  assert.doesNotMatch(runBody, /readFullSnapshotObservation/);
});

test('controlled rebuild runtime structurally reuses bounded WU7 recovery primitives', async () => {
  const application = await read('src/migration/initialControlledRebuildApplication.ts');
  const continuation = await read('src/migration/initialBootstrapApplication.ts');
  assert.match(application, /prepareInitialControlledRebuildContinuation/);
  assert.match(application, /planControlledInitialRebuild/);
  assert.match(application, /recoverUnknownControlledRebuildCopyOutcome/);
  assert.match(application, /recoverUnknownControlledInitialSwapOutcome/);
  assert.match(application, /executeControlledRebuildStagingBatches/);
  assert.match(application, /gateControlledInitialSwap/);
  assert.match(application, /executeControlledInitialSwap/);
  assert.match(application, /recoverControlledInitialCommitMarker/);
  assert.match(application, /POST_COMMIT_VERIFICATION/);
  assert.match(continuation, /prepared\.durableRun\.startedAt|durableRun\.startedAt/);
});

test('canonical check verifies the controlled rebuild deployment package', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.check, /package:initial-controlled-rebuild:from-build/);
  assert.equal(packageJson.scripts['initial-controlled-rebuild:invoke'], 'node scripts/invoke-yandex-initial-controlled-rebuild.mjs');
  assert.match(packageJson.scripts['package:initial-controlled-rebuild:from-build'], /verify-yandex-initial-controlled-rebuild-package\.mjs/);
});

test('controlled rebuild runbook preserves authority and forbids silent cap/replay expansion', async () => {
  const runbook = await read('docs/R1_INITIAL_CONTROLLED_REBUILD_RUNBOOK.md');
  assert.match(runbook, /Google remains authoritative and YDB remains shadow/);
  assert.match(runbook, /Cap-Increase: FORBIDDEN/);
  assert.match(runbook, /Timer-Cutover: FORBIDDEN/);
  assert.match(runbook, /Blind-Replay: FORBIDDEN/);
  assert.match(runbook, /MigrationRun\.startedAt/);
  assert.match(runbook, /APPLIED \| NOT_APPLIED \| RECOVERY_REQUIRED/);
  assert.match(runbook, /INITIAL_CONTROLLED_REBUILD_COMMITTED/);
  assert.match(runbook, /Synchronous continuation transport/);
  assert.match(runbook, /integration=raw/);
  assert.match(runbook, /invoker timeout is 630 seconds/);
  assert.match(runbook, /runtime-account `functions\.functionInvoker` \/ `functions\.viewer` bindings are retained as live provider state/);
});
