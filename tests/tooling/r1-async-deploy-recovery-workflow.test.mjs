import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-bootstrap-async-deploy-recovery.yml');
const RUNBOOK = resolve(ROOT, 'docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md');
const AGENTS = resolve(ROOT, 'AGENTS.md');
const COMPLETION_SPRINT = resolve(ROOT, 'docs/R1_COMPLETION_SPRINT.md');

test('async deploy recovery is exact-main CI-triggered and read-only', async () => {
  const workflow = await readFile(WORKFLOW, 'utf8');

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\n\s*- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Async-Deploy-Recovery: READY/);
  assert.match(workflow, /Failed-Async-Deploy-Run-ID: 36783942040/);
  assert.match(workflow, /Failed-Async-Deploy-SHA: c8c45e88e1e3c58f7b168c56ae4f1edc1d850c16/);
  assert.match(workflow, /Deploy initial-bootstrap-only Function version/);
  assert.match(workflow, /yc serverless function version list --function-id/);
  assert.match(workflow, /yc serverless function list-access-bindings/);
  assert.doesNotMatch(workflow, /yc iam service-account list-access-bindings/);
  assert.match(workflow, /yc serverless function list-operations/);
  assert.match(workflow, /version get-by-tag/);
  assert.match(workflow, /functions\/\$\{function_id\}:tagHistory/);
  assert.match(workflow, /YC_LOCKBOX_SECRET_ID/);
  assert.match(workflow, /classify-r1-async-deploy-recovery\.mjs/);
  assert.match(workflow, /INVOCATION_ONLY_READY/);
  assert.match(workflow, /REQUEST_CONTRACT_INVALID/);
  assert.match(workflow, /CREATE_PERMISSION_DENIED/);
  assert.doesNotMatch(workflow, /NOT_APPLIED/);
  assert.doesNotMatch(workflow, /SAFE_TO_CORRECT_CONFIG/);
  assert.match(workflow, /runtimeInvoker/);
  assert.match(workflow, /r1-async-deploy-recovery-evidence-/);
  assert.doesNotMatch(workflow, /serverless function version create/);
  assert.doesNotMatch(workflow, /functions\.yandexcloud\.net/);
  assert.doesNotMatch(workflow, /initial-bootstrap:invoke(?:-async)?/);
  assert.doesNotMatch(workflow, /add-access-binding|set-access-bindings|remove-access-binding/);
  assert.doesNotMatch(workflow, /yc ydb|migration_runs|source_records|source_snapshots/);
});

test('async deploy decision and anti-S-unit process rules are synchronized with terminal next actions', async () => {
  const [runbook, agents, completionSprint] = await Promise.all([
    readFile(RUNBOOK, 'utf8'),
    readFile(AGENTS, 'utf8'),
    readFile(COMPLETION_SPRINT, 'utf8'),
  ]);
  const evidence = runbook.match(
    /### Readable-surface correction after diagnostic `36785159882`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the diagnostic outcome must lead to state-specific engineering actions');
  assert.match(evidence, /INVOCATION_ONLY_READY \/ VERSION_PROVEN/);
  assert.match(evidence, /REQUEST_CONTRACT_INVALID/);
  assert.match(evidence, /CREATE_PERMISSION_DENIED/);
  assert.match(evidence, /does not infer that a missing list candidate means `NOT_APPLIED`/);
  assert.match(evidence, /invocation-only.*marker/);
  for (const source of [agents, completionSprint]) {
    assert.match(source, /INITIAL_BOOTSTRAP_ASYNC_DEPLOY_FAILED/);
    assert.match(source, /invocation-only marker/);
    assert.match(source, /anti-S-unit/i);
  }
});
