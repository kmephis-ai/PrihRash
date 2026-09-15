import { readFile } from 'node:fs/promises';

import {
  R1_DIAGNOSTIC_KINDS,
  classifyR1Diagnostic,
} from './r1-diagnostic-contract.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const ORCHESTRATOR_CODES = new Set([
  'R1_BOOTSTRAP_ORCHESTRATOR_FAILED',
  'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED',
  'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED',
  'R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS',
  'R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED',
  'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED',
]);
const GITHUB_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'success',
  'timed_out',
]);
const BOOTSTRAP_INVOKE_STEPS = new Set([
  'NOT_REACHED',
  'UNKNOWN',
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'success',
  'timed_out',
]);

export const R1_STATUS_NEXT_ACTIONS = Object.freeze([
  'STOP_AND_RECONCILE',
  'WAIT_FOR_CANONICAL_CI',
  'FIX_CANONICAL_CI',
  'RUN_READINESS',
  'FIX_READINESS',
  'RUN_INITIAL_BOOTSTRAP_ORCHESTRATOR',
  'FIX_BOOTSTRAP_FAILURE',
  'REVIEW_RECOVERY',
  'RUN_POST_COMMIT_RECONCILIATION',
  'FIX_POST_COMMIT_RECONCILIATION',
  'RETIRE_BOOTSTRAP_AUTHORITY',
  'CLOSE_PROVIDER_ITEM',
  'NONE',
]);

const SAFE_STOP = Object.freeze({
  status: 'STOP',
  code: 'R1_STATUS_INPUT_INVALID',
  nextAction: 'STOP_AND_RECONCILE',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function positiveIntegerOrNull(value) {
  return value === null || (Number.isSafeInteger(value) && value > 0);
}

function stringMemberOrNull(value, allowed) {
  return value === null || (typeof value === 'string' && allowed.has(value));
}

function recoveryDiagnostic(verdict, reason) {
  if (verdict === null && reason === null) return null;
  if (typeof verdict !== 'string' || typeof reason !== 'string') return undefined;
  return classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP_RECOVERY, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict,
    reason,
  });
}

function classifyOrchestratorEvidence(value) {
  if (!exactKeys(value, [
    'status',
    'code',
    'sourceSha',
    'initialRecoveryVerdict',
    'initialRecoveryReason',
    'readinessRunId',
    'readinessCode',
    'bootstrapRunId',
    'bootstrapConclusion',
    'bootstrapInvokeStep',
    'postRecoveryVerdict',
    'postRecoveryReason',
    'stagingResumeAuthorized',
  ])) return null;

  if (
    !['PASS', 'STOP', 'FAIL'].includes(value.status)
    || typeof value.code !== 'string'
    || !ORCHESTRATOR_CODES.has(value.code)
    || !SHA_RE.test(value.sourceSha ?? '')
    || typeof value.stagingResumeAuthorized !== 'boolean'
    || !positiveIntegerOrNull(value.readinessRunId)
    || !positiveIntegerOrNull(value.bootstrapRunId)
    || !stringMemberOrNull(value.bootstrapConclusion, GITHUB_CONCLUSIONS)
    || !stringMemberOrNull(value.bootstrapInvokeStep, BOOTSTRAP_INVOKE_STEPS)
  ) return null;

  if (value.readinessCode !== null && value.readinessCode !== 'READINESS_READY') return null;

  const initialRecovery = recoveryDiagnostic(value.initialRecoveryVerdict, value.initialRecoveryReason);
  const postRecovery = recoveryDiagnostic(value.postRecoveryVerdict, value.postRecoveryReason);
  if (initialRecovery === undefined || postRecovery === undefined) return null;

  if (value.status === 'PASS' && value.code !== 'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED') return null;
  if (value.status === 'FAIL' && value.code !== 'R1_BOOTSTRAP_ORCHESTRATOR_FAILED') return null;
  if (
    value.status === 'STOP'
    && ![
      'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED',
      'R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS',
      'R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED',
      'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED',
    ].includes(value.code)
  ) return null;

  if (value.code === 'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED') {
    if (
      value.bootstrapConclusion !== 'success'
      || value.bootstrapInvokeStep !== 'success'
      || value.bootstrapRunId === null
      || value.readinessRunId === null
      || value.readinessCode !== 'READINESS_READY'
    ) return null;
  }

  if (value.code === 'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED') {
    if (value.bootstrapRunId === null || postRecovery === null) return null;
  }
  if (value.code === 'R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS' && value.bootstrapRunId === null) return null;
  if (value.code === 'R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED' && value.readinessRunId === null) return null;
  if (value.code === 'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED' && initialRecovery === null) return null;

  return Object.freeze({
    ...value,
    initialRecovery,
    postRecovery,
  });
}

function classifyEvidenceEnvelope(value, kind) {
  if (value === null) return null;
  if (!exactKeys(value, ['sourceSha', 'diagnostic']) || !SHA_RE.test(value.sourceSha ?? '')) return undefined;
  const diagnostic = classifyR1Diagnostic(kind, value.diagnostic);
  if (diagnostic === null) return undefined;
  return Object.freeze({ sourceSha: value.sourceSha, diagnostic });
}

function result(code, nextAction) {
  return Object.freeze({ status: 'PASS', code, nextAction });
}

function postCommitAction(snapshot) {
  if (snapshot.postCommitReconciliation === 'FAIL') {
    return result('R1_STATUS_POST_COMMIT_RECONCILIATION_FAILED', 'FIX_POST_COMMIT_RECONCILIATION');
  }
  if (snapshot.postCommitReconciliation !== 'PASS') {
    return result('R1_STATUS_COMMITTED_NEEDS_RECONCILIATION', 'RUN_POST_COMMIT_RECONCILIATION');
  }
  if (snapshot.temporaryAuthorityRetired !== true) {
    return result('R1_STATUS_COMMITTED_NEEDS_RETIREMENT', 'RETIRE_BOOTSTRAP_AUTHORITY');
  }
  return result('R1_STATUS_PROVIDER_COMPLETE', 'CLOSE_PROVIDER_ITEM');
}

function postInvokeAction(orchestrator) {
  const recovery = orchestrator.postRecovery;
  if (recovery === null) return result('R1_STATUS_POST_INVOKE_RECOVERY_MISSING', 'REVIEW_RECOVERY');
  if (recovery.verdict === 'APPLIED' && recovery.reason === 'COMMITTED_DURABLE_STATE') {
    return result('R1_STATUS_POST_INVOKE_COMMITTED', 'RUN_POST_COMMIT_RECONCILIATION');
  }
  if (
    (recovery.verdict === 'NOT_APPLIED' && recovery.reason === 'EMPTY_DURABLE_STATE')
    || (
      recovery.verdict === 'RECOVERY_REQUIRED'
      && recovery.reason === 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE'
    )
  ) {
    return result('R1_STATUS_BOOTSTRAP_FAILURE_CLASSIFIED', 'FIX_BOOTSTRAP_FAILURE');
  }
  return result('R1_STATUS_RECOVERY_REVIEW_REQUIRED', 'REVIEW_RECOVERY');
}

function orchestratorAction(orchestrator, snapshot) {
  switch (orchestrator.code) {
    case 'R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED':
      return postCommitAction(snapshot);
    case 'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED':
      return postInvokeAction(orchestrator);
    case 'R1_BOOTSTRAP_ORCHESTRATOR_BOOTSTRAP_NON_SUCCESS':
      if (['NOT_REACHED', 'skipped'].includes(orchestrator.bootstrapInvokeStep)) {
        return result('R1_STATUS_BOOTSTRAP_PREINVOKE_BLOCKED', 'FIX_BOOTSTRAP_FAILURE');
      }
      return postInvokeAction(orchestrator);
    case 'R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED':
      return result('R1_STATUS_READINESS_BLOCKED', 'FIX_READINESS');
    case 'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED':
      if (
        orchestrator.initialRecovery?.verdict === 'APPLIED'
        && orchestrator.initialRecovery?.reason === 'COMMITTED_DURABLE_STATE'
      ) {
        return postCommitAction(snapshot);
      }
      return result('R1_STATUS_RECOVERY_BLOCKED', 'REVIEW_RECOVERY');
    default:
      return result('R1_STATUS_ORCHESTRATOR_UNCLASSIFIED', 'STOP_AND_RECONCILE');
  }
}

export function classifyR1Status(value) {
  if (!exactKeys(value, [
    'currentMainSha',
    'providerIssueState',
    'canonicalCi',
    'readiness',
    'orchestrator',
    'postCommitReconciliation',
    'temporaryAuthorityRetired',
  ])) return SAFE_STOP;

  if (
    !SHA_RE.test(value.currentMainSha ?? '')
    || !['open', 'closed'].includes(value.providerIssueState)
    || !exactKeys(value.canonicalCi, ['sourceSha', 'state'])
    || !SHA_RE.test(value.canonicalCi.sourceSha ?? '')
    || !['PASS', 'PENDING', 'FAIL'].includes(value.canonicalCi.state)
    || ![null, 'PASS', 'FAIL'].includes(value.postCommitReconciliation)
    || ![null, true, false].includes(value.temporaryAuthorityRetired)
  ) return SAFE_STOP;

  const readiness = classifyEvidenceEnvelope(value.readiness, R1_DIAGNOSTIC_KINDS.READINESS);
  const orchestrator = value.orchestrator === null ? null : classifyOrchestratorEvidence(value.orchestrator);
  if (readiness === undefined || (value.orchestrator !== null && orchestrator === null)) return SAFE_STOP;

  if (value.providerIssueState === 'closed') return result('R1_STATUS_PROVIDER_ITEM_CLOSED', 'NONE');

  if (value.canonicalCi.sourceSha !== value.currentMainSha) {
    return result('R1_STATUS_CANONICAL_CI_STALE', 'WAIT_FOR_CANONICAL_CI');
  }
  if (value.canonicalCi.state === 'PENDING') {
    return result('R1_STATUS_CANONICAL_CI_PENDING', 'WAIT_FOR_CANONICAL_CI');
  }
  if (value.canonicalCi.state === 'FAIL') {
    return result('R1_STATUS_CANONICAL_CI_FAILED', 'FIX_CANONICAL_CI');
  }

  if (orchestrator !== null && orchestrator.sourceSha === value.currentMainSha) {
    return orchestratorAction(orchestrator, value);
  }

  if (readiness === null || readiness.sourceSha !== value.currentMainSha) {
    return result('R1_STATUS_READINESS_REQUIRED', 'RUN_READINESS');
  }
  if (readiness.diagnostic.status !== 'PASS' || readiness.diagnostic.code !== 'READINESS_READY') {
    return result('R1_STATUS_READINESS_FAILED', 'FIX_READINESS');
  }

  return result('R1_STATUS_READY_FOR_ORCHESTRATOR', 'RUN_INITIAL_BOOTSTRAP_ORCHESTRATOR');
}

async function readInput(path) {
  if (path !== undefined && path !== '-') return readFile(path, 'utf8');
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  try {
    const raw = await readInput(process.argv[2]);
    const value = JSON.parse(raw);
    const classified = classifyR1Status(value);
    process.stdout.write(`${JSON.stringify(classified)}\n`);
    if (classified.status !== 'PASS') process.exitCode = 2;
  } catch {
    process.stdout.write(`${JSON.stringify(SAFE_STOP)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  await main();
}
