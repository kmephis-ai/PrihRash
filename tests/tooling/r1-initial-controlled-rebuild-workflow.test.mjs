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
  const invoke = workflow.indexOf('Start exact controlled rebuild tag asynchronously once');
  assert.equal(recoveryGate > 0 && recoveryGate < providerBoundary && providerBoundary < deploy && deploy < invoke, true);
  assert.match(workflow, /r1-initial-bootstrap-recovery-evidence-\$\{\{ inputs\.recovery_run_id \}\}/);
  assert.match(workflow, /r1-yandex-readiness-evidence-\$\{\{ inputs\.readiness_run_id \}\}/);
  assert.match(workflow, /\.verdict == "RECOVERY_REQUIRED"/);
  assert.match(workflow, /\.reason == "STAGING_RUN_PRESENT" or \.reason == "VALIDATED_CURRENT_EMPTY_STAGING_ABSENT"/);
  assert.match(workflow, /\.code == "READINESS_READY"/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_WRITER_CONFLICT/);
});

test('R1 controlled rebuild deploy is private trigger-free and exposes only dedicated handler', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /--entrypoint index\.initialControlledRebuildHandler/);
  assert.match(workflow, /--source-path \.artifacts\/yandex-initial-controlled-rebuild-function/);
  assert.match(workflow, /--tags r1-initial-controlled-rebuild/);
  assert.match(workflow, /--execution-timeout 600s/);
  assert.match(workflow, /--async-max-retries 0/);
  assert.match(workflow, /--async-service-account-id "\$YC_WIF_SERVICE_ACCOUNT_ID"/);
  assert.doesNotMatch(workflow, /--async-success-ymq-arn|--async-failure-ymq-arn/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_FUNCTION_PUBLIC/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_FUNCTION_TRIGGER_PRESENT/);
  assert.match(workflow, /PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.doesNotMatch(workflow, /PRIHRASH_INITIAL_CONTROLLED_REBUILD_PRIVATE_HISTORICAL_EVIDENCE/);
});

test('controlled rebuild may reuse only an exact APPLIED active tag without redeploying it', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /deploy_recovery_run_id:/);
  assert.match(workflow, /r1-initial-controlled-rebuild-deploy-recovery-evidence-\$\{\{ inputs\.deploy_recovery_run_id \}\}/);
  assert.match(workflow, /\.verdict == "APPLIED"/);
  assert.match(workflow, /\.reason == "EXACT_ACTIVE_TAG"/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_DEPLOY_RECOVERY_YDB_STATE_NOT_SAFE/);
  assert.match(workflow, /if: \$\{\{ inputs\.deploy_recovery_run_id == '' \}\}[\s\S]*Deploy initial-controlled-rebuild-only Function version|Deploy initial-controlled-rebuild-only Function version[\s\S]*if: \$\{\{ inputs\.deploy_recovery_run_id == '' \}\}/);
  assert.match(workflow, /serverless function version list --function-id/);
  assert.match(workflow, /async_invocation_config\.retries_count/);
  assert.match(workflow, /async_invocation_config\.service_account_id/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_POSTFLIGHT_ASYNC_TAG_NOT_EXACT/);
});

test('controlled rebuild invocation is async-accepted only and requires later recovery', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild.yml');
  assert.match(workflow, /PRIHRASH_INITIAL_CONTROLLED_REBUILD_INVOKE_MODE=async/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_ASYNC_ACCEPTED/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_ASYNC_ACCEPTED_RECOVERY_REQUIRED/);
  assert.doesNotMatch(workflow, /Require exact COMMITTED result/);
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
});
