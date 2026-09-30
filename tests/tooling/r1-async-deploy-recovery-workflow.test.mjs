import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-initial-bootstrap-async-deploy-recovery.yml');

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
  assert.match(workflow, /classify-r1-async-deploy-recovery\.mjs/);
  assert.match(workflow, /SAFE_TO_CORRECT_CONFIG/);
  assert.match(workflow, /runtimeInvoker/);
  assert.match(workflow, /r1-async-deploy-recovery-evidence-/);
  assert.doesNotMatch(workflow, /serverless function version create/);
  assert.doesNotMatch(workflow, /functions\.yandexcloud\.net/);
  assert.doesNotMatch(workflow, /initial-bootstrap:invoke(?:-async)?/);
  assert.doesNotMatch(workflow, /add-access-binding|set-access-bindings|remove-access-binding/);
  assert.doesNotMatch(workflow, /yc ydb|migration_runs|source_records|source_snapshots/);
});
