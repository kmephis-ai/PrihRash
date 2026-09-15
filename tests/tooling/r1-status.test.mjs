import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { R1_STATUS_NEXT_ACTIONS, classifyR1Status } from '../../scripts/r1-status.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const MAIN = '753142b4e188bb287df05944d636b6e5a4c91fe8';
const OLD = '882da4707d34b17519a5ffbb4f832725f4f383db';

function readiness(sourceSha = MAIN, diagnostic = { status: 'PASS', code: 'READINESS_READY' }) {
  return { sourceSha, diagnostic };
}

function orchestrator(overrides = {}) {
  return {
    status: 'STOP',
    code: 'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED',
    sourceSha: MAIN,
    initialRecoveryVerdict: 'RECOVERY_REQUIRED',
    initialRecoveryReason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
    readinessRunId: 10,
    readinessCode: 'READINESS_READY',
    bootstrapRunId: 20,
    bootstrapConclusion: 'failure',
    bootstrapInvokeStep: 'failure',
    postRecoveryVerdict: 'RECOVERY_REQUIRED',
    postRecoveryReason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
    stagingResumeAuthorized: false,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    currentMainSha: MAIN,
    providerIssueState: 'open',
    canonicalCi: { sourceSha: MAIN, state: 'PASS' },
    readiness: null,
    orchestrator: null,
    postCommitReconciliation: null,
    temporaryAuthorityRetired: null,
    ...overrides,
  };
}

function assertOneAction(result, expected) {
  assert.equal(result.nextAction, expected);
  assert.ok(R1_STATUS_NEXT_ACTIONS.includes(result.nextAction));
  assert.deepEqual(Object.keys(result).sort(), ['code', 'nextAction', 'status']);
}

test('r1-status is fail-closed and always yields one allowlisted nextAction', () => {
  assertOneAction(classifyR1Status({}), 'STOP_AND_RECONCILE');
  assertOneAction(classifyR1Status(snapshot({ canonicalCi: { sourceSha: OLD, state: 'PASS' } })), 'WAIT_FOR_CANONICAL_CI');
  assertOneAction(classifyR1Status(snapshot({ canonicalCi: { sourceSha: MAIN, state: 'PENDING' } })), 'WAIT_FOR_CANONICAL_CI');
  assertOneAction(classifyR1Status(snapshot({ canonicalCi: { sourceSha: MAIN, state: 'FAIL' } })), 'FIX_CANONICAL_CI');
  assertOneAction(classifyR1Status(snapshot({ providerIssueState: 'closed' })), 'NONE');
});

test('r1-status requires fresh exact-main readiness before any orchestrator action', () => {
  assertOneAction(classifyR1Status(snapshot()), 'RUN_READINESS');
  assertOneAction(classifyR1Status(snapshot({ readiness: readiness(OLD) })), 'RUN_READINESS');
  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(MAIN, { status: 'FAIL', code: 'READINESS_RUNTIME_FAILED' }),
  })), 'FIX_READINESS');
  assertOneAction(classifyR1Status(snapshot({ readiness: readiness() })), 'RUN_INITIAL_BOOTSTRAP_ORCHESTRATOR');
});

test('r1-status maps current orchestrator non-success to fix/recovery without replay', () => {
  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: orchestrator(),
  })), 'FIX_BOOTSTRAP_FAILURE');

  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: orchestrator({
      postRecoveryReason: 'RESIDUAL_REFERENCE_STATE_MISMATCH',
    }),
  })), 'REVIEW_RECOVERY');

  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: orchestrator({
      status: 'STOP',
      code: 'R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS',
      bootstrapInvokeStep: 'skipped',
      postRecoveryVerdict: null,
      postRecoveryReason: null,
    }),
  })), 'FIX_BOOTSTRAP_FAILURE');

  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: orchestrator({
      status: 'STOP',
      code: 'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED',
      readinessRunId: null,
      readinessCode: null,
      bootstrapRunId: null,
      bootstrapConclusion: null,
      bootstrapInvokeStep: null,
      postRecoveryVerdict: null,
      postRecoveryReason: null,
    }),
  })), 'REVIEW_RECOVERY');
});

test('r1-status follows COMMITTED exit boundary: reconciliation, retirement, close', () => {
  const committed = orchestrator({
    status: 'PASS',
    code: 'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED',
    bootstrapConclusion: 'success',
    bootstrapInvokeStep: 'success',
    postRecoveryVerdict: null,
    postRecoveryReason: null,
  });

  assertOneAction(classifyR1Status(snapshot({ readiness: readiness(), orchestrator: committed })), 'RUN_POST_COMMIT_RECONCILIATION');
  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: committed,
    postCommitReconciliation: 'FAIL',
  })), 'FIX_POST_COMMIT_RECONCILIATION');
  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: committed,
    postCommitReconciliation: 'PASS',
    temporaryAuthorityRetired: false,
  })), 'RETIRE_BOOTSTRAP_AUTHORITY');
  assertOneAction(classifyR1Status(snapshot({
    readiness: readiness(),
    orchestrator: committed,
    postCommitReconciliation: 'PASS',
    temporaryAuthorityRetired: true,
  })), 'CLOSE_PROVIDER_ITEM');
});

test('r1-status rejects contradictory or privacy-expanding evidence', () => {
  const invalidExtra = snapshot({
    readiness: { ...readiness(), rawPayload: 'never accepted' },
  });
  assertOneAction(classifyR1Status(invalidExtra), 'STOP_AND_RECONCILE');

  const invalidCommitted = snapshot({
    readiness: readiness(),
    orchestrator: orchestrator({
      status: 'PASS',
      code: 'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED',
      bootstrapConclusion: 'failure',
      bootstrapInvokeStep: 'failure',
      postRecoveryVerdict: null,
      postRecoveryReason: null,
    }),
  });
  assertOneAction(classifyR1Status(invalidCommitted), 'STOP_AND_RECONCILE');
});

test('r1-status decision vocabulary stays aligned with canonical R1 runbook and orchestrator evidence codes', async () => {
  const [runbook, workflow, script] = await Promise.all([
    readFile(resolve(ROOT, 'docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md'), 'utf8'),
    readFile(resolve(ROOT, '.github/workflows/r1-initial-bootstrap-orchestrator.yml'), 'utf8'),
    readFile(resolve(ROOT, 'scripts/r1-status.mjs'), 'utf8'),
  ]);

  for (const code of [
    'R1_BOOTSTRAP_ORCHESTRATOR_FAILED',
    'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED',
    'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED',
    'R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS',
    'R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED',
    'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED',
  ]) {
    assert.match(workflow, new RegExp(code));
    assert.match(script, new RegExp(code));
  }

  assert.match(runbook, /fresh READINESS_READY child on exact SHA/);
  assert.match(runbook, /INITIAL_BOOTSTRAP_COMMITTED/);
  assert.match(runbook, /independent post-COMMITTED reconciliation PASS/);
  assert.match(runbook, /temporary bootstrap authority \+ stage-specific orchestration retired/);
  assert.match(runbook, /one read-only recovery classification → STOP/);
});
