import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-bootstrap-gate-c.yml');
const REFERENCE_RUNTIME = resolve(ROOT, 'src/runtime/initialBootstrapReferenceAwareJob.ts');
const FUNCTION_RUNTIME = resolve(ROOT, 'src/runtime/yandexCloudInitialBootstrapFunction.ts');
const PACKAGE_SCRIPT = resolve(ROOT, 'scripts/package-yandex-initial-bootstrap-function.mjs');
const PACKAGE_VERIFY = resolve(ROOT, 'scripts/verify-yandex-initial-bootstrap-package.mjs');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap.mjs');
const CHILD_WORKFLOW = resolve(ROOT, 'scripts/r1-bootstrap-orchestrator-child-workflow.mjs');
const RUNBOOK = resolve(ROOT, 'docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md');

async function text(path) {
  return readFile(path, 'utf8');
}

test('Gate C runs only after successful main CI and shares the single initial-bootstrap writer boundary', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\n\s*- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /group:\s*r1-initial-bootstrap-writer/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT.*'1'/);
  assert.match(workflow, /GATE_C_ALREADY_ATTEMPTED_FOR_SHA/);
});

test('Gate C authority is derived from the merged PR and active tracking issues rather than a hardcoded issue number', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /commits\/\$\{SOURCE_SHA\}\/pulls/);
  assert.match(workflow, /Provider-Attempt: GATE_C_READY/);
  assert.match(workflow, /Provider-Authority: R1_GATE_C_FRESH_BOOTSTRAP_ONCE/);
  assert.match(workflow, /Expected-Transition: STALE_VALIDATED_GATE_C\/FRESH_BOOTSTRAP/);
  assert.match(workflow, /Tracking-Issue: #/);
  assert.match(workflow, /Parent-R1-Issue:/);
  assert.match(workflow, /Blind-Replay: FORBIDDEN/);
  assert.doesNotMatch(workflow, /issues\/699\b/);
  assert.doesNotMatch(workflow, /issues\/630\b/);
});

test('Gate C requires fresh exact-main readiness before provider deployment and rechecks exact main before deploy and invoke', async () => {
  const workflow = await text(WORKFLOW);
  const child = await text(CHILD_WORKFLOW);

  assert.match(workflow, /r1-bootstrap-orchestrator-child-workflow\.mjs readiness/);
  assert.match(workflow, /PRIHRASH_R1_EXPECTED_MAIN_SHA/);
  assert.match(child, /PRIHRASH_R1_EXPECTED_MAIN_SHA \?\? process\.env\.GITHUB_SHA/);
  assert.match(workflow, /READINESS_READY/);
  assert.match(workflow, /GATE_C_MAIN_MOVED_BEFORE_PROVIDER/);
  assert.match(workflow, /GATE_C_MAIN_MOVED_BEFORE_DEPLOY/);
  assert.match(workflow, /GATE_C_MAIN_MOVED_BEFORE_INVOKE/);
  assert.match(workflow, /serverless function list-access-bindings/);
  assert.match(workflow, /serverless trigger list/);
  assert.match(workflow, /GATE_C_WIF_INVOKER_MISSING/);
  assert.match(workflow, /GATE_C_LOCKBOX_METADATA_INVALID/);
});

test('Gate C deploys the dedicated handler on the existing private bootstrap Function and invokes exactly once', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /FUNCTION_NAME:\s*prihrash-r1-initial-bootstrap/);
  assert.match(workflow, /FUNCTION_TAG:\s*r1-initial-bootstrap/);
  assert.match(workflow, /--entrypoint index\.initialBootstrapGateCHandler/);
  assert.match(workflow, /--memory 256m/);
  assert.match(workflow, /--execution-timeout 600s/);
  assert.match(workflow, /--retry 0/);
  assert.match(workflow, /--no-logging/);
  assert.match(workflow, /PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID/);
  assert.equal((workflow.match(/npm --silent run initial-bootstrap:invoke/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /index\.initialBootstrapStaleStagingRetirement|r1-initial-controlled-rebuild\.yml\/dispatches|scheduled-sync.*dispatches/i);
});

test('Gate C publishes only allowlisted enum-shaped invoke evidence and has no automatic second write path', async () => {
  const workflow = await text(WORKFLOW);

  assert.match(workflow, /r1-initial-bootstrap-gate-c-evidence-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /retention-days:\s*30/);
  assert.match(workflow, /\[keys\[\]\] - \[/);
  assert.match(workflow, /"status","code","recoveryReason","blockers","runtimeCode","applicationPhase"/);
  assert.doesNotMatch(workflow, /raw_payload|description|amount|snapshot_digest|source_record_id|transaction_id/i);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml.*dispatches|r1-initial-controlled-rebuild.*dispatches/s);
});

test('Gate C handler selects the dedicated admission while ordinary handler keeps its previous stale-retirement behavior', async () => {
  const referenceRuntime = await text(REFERENCE_RUNTIME);
  const functionRuntime = await text(FUNCTION_RUNTIME);

  assert.match(referenceRuntime, /runInitialBootstrapGateCApplication/);
  assert.match(referenceRuntime, /runInitialBootstrapGateCReferenceAwareJob/);
  assert.match(
    referenceRuntime,
    /createReferenceAwareRuntime\(runInitialBootstrapGateCApplication\)/,
  );
  assert.match(functionRuntime, /export async function initialBootstrapGateCHandler/);
  assert.match(
    functionRuntime,
    /initialBootstrapGateCHandler[\s\S]*?runInitialBootstrapGateCReferenceAwareJobFromEnvironment/,
  );
  assert.match(
    functionRuntime,
    /initialBootstrapHandler[\s\S]*?runInitialBootstrapJobWithOneStaleStagingRetirement/,
  );
  const gateCBody = functionRuntime.match(/export async function initialBootstrapGateCHandler[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(gateCBody, /StaleStagingRetirement/);
});

test('bootstrap package and invoker expose Gate C without widening to non-bootstrap runtime surfaces', async () => {
  const packageScript = await text(PACKAGE_SCRIPT);
  const verifier = await text(PACKAGE_VERIFY);
  const invoker = await text(INVOKER);

  assert.match(packageScript, /export async function initialBootstrapGateCHandler/);
  assert.match(verifier, /Gate C bootstrap runtime handler export is missing/);
  assert.match(invoker, /GATE_C_TERMINALIZATION_EVIDENCE_INVALID/);
  assert.match(invoker, /GATE_C_INCOMPLETE_RUN_PRESENT/);
  assert.match(verifier, /runtime surface is not bootstrap-only/);
  assert.match(verifier, /yandexCloudScheduledSyncFunction\.js/);
});


test('runbook records the bounded one-shot Gate C authority without authorizing cutover or cleanup', async () => {
  const runbook = await text(RUNBOOK);

  assert.match(runbook, /Production Gate C one-shot authority/);
  assert.match(runbook, /R1_GATE_C_FRESH_BOOTSTRAP_ONCE/);
  assert.match(runbook, /initialBootstrapGateCHandler/);
  assert.match(runbook, /r1-initial-bootstrap-writer/);
  assert.match(runbook, /PASS \/ INITIAL_BOOTSTRAP_COMMITTED/);
  assert.match(runbook, /does \*\*not\*\* authorize timer\/scheduled sync activation/);
  assert.match(runbook, /new explicit authority decision/);
});
