import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/r1-initial-bootstrap-recovery.yml', 'utf8');
const packageScript = await readFile('scripts/package-yandex-initial-bootstrap-recovery-function.mjs', 'utf8');
const verifier = await readFile('scripts/verify-yandex-initial-bootstrap-recovery-package.mjs', 'utf8');
const invoker = await readFile('scripts/invoke-yandex-initial-bootstrap-recovery.mjs', 'utf8');
const bootstrapWorkflow = await readFile('.github/workflows/r1-initial-shadow-bootstrap.yml', 'utf8');
const controlledWorkflow = await readFile('.github/workflows/r1-initial-controlled-rebuild.yml', 'utf8');
const swapRecoveryWorkflow = await readFile('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml', 'utf8');
const orchestratorWorkflow = await readFile('.github/workflows/r1-initial-bootstrap-orchestrator.yml', 'utf8');
const bootstrapApplication = await readFile('src/migration/initialBootstrapApplication.ts', 'utf8');
const gateCGuard = await readFile('src/migration/initialBootstrapGateCGuard.ts', 'utf8');

test('initial bootstrap recovery workflow stays manual-only and exact-main guarded', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /surface_only:/);
  assert.match(workflow, /RECOVERY_SURFACE_ONLY: \$\{\{ inputs\.surface_only/);
  assert.match(workflow, /controlled_preparation_only:/);
  assert.match(workflow, /RECOVERY_CONTROLLED_PREPARATION_ONLY: \$\{\{ inputs\.controlled_preparation_only/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_RECOVERY_MODE_CONFLICT/);
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
  assert.match(workflow, /--execution-timeout 150s/);
  assert.match(workflow, /--environment "PRIHRASH_R1_RECOVERY_SURFACE_ONLY=\$\{RECOVERY_SURFACE_ONLY\}"/);
  assert.match(workflow, /--environment "PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY=\$\{RECOVERY_CONTROLLED_PREPARATION_ONLY\}"/);
  assert.match(workflow, /--tags r1-initial-bootstrap-recovery/);
  assert.match(workflow, /environment-variable=PRIHRASH_YDB_CONNECTION_STRING/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SPREADSHEET_ID/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(workflow, /environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(workflow, /environment-variable=PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.match(workflow, /npm run initial-bootstrap-recovery:invoke/);
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
  assert.match(workflow, /controlled-preparation\.json/);
  assert.match(workflow, /retention-days: 30/);
});

test('initial bootstrap recovery invoker exposes enum-only classification evidence', () => {
  assert.match(invoker, /INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/);
  assert.match(invoker, /INVOKE_TIMEOUT_MS = 180_000/);
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
  assert.match(runtime, /prepareInitialControlledRebuildContinuation/);
  assert.doesNotMatch(runtime, /runInitialControlledRebuildApplication/);
  assert.doesNotMatch(runtime, /executeMigrationRunLifecycleWrite/);
  assert.doesNotMatch(runtime, /executeInitialControlledRebuildSetup/);
  assert.doesNotMatch(runtime, /executeControlledInitialSwap/);
  assert.doesNotMatch(workflow, /initial-controlled-rebuild:invoke/);
});
