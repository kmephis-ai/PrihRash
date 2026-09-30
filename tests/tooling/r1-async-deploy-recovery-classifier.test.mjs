import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAsyncDeployRecovery } from '../../scripts/classify-r1-async-deploy-recovery.mjs';

const functionId = 'synthetic-function';
const runtimeSa = 'synthetic-runtime-sa';
const wifSa = 'synthetic-wif-sa';

function evidence(overrides = {}) {
  return {
    versions: [],
    functionBindings: [{
      role_id: 'functions.functionInvoker',
      subject: { type: 'serviceAccount', id: runtimeSa },
    }],
    runtimeServiceAccountBindings: [{
      role_id: 'iam.serviceAccounts.user',
      subject: { type: 'serviceAccount', id: wifSa },
    }],
    functionId,
    runtimeServiceAccountId: runtimeSa,
    wifServiceAccountId: wifSa,
    deployStartedAt: '2026-09-30T22:10:31Z',
    deployFinishedAt: '2026-09-30T22:10:34Z',
    ...overrides,
  };
}

test('absent failed-window version plus existing exact IAM boundary is safe only for config correction', () => {
  assert.deepEqual(classifyAsyncDeployRecovery(evidence()), {
    status: 'PASS',
    code: 'R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED',
    verdict: 'SAFE_TO_CORRECT_CONFIG',
    previousWrite: 'NOT_APPLIED',
    runtimeInvoker: 'PRESENT',
    wifRuntimeServiceAccountUser: 'PRESENT',
  });
});

test('tagged or failed-window version blocks any blind replay', () => {
  const version = {
    id: 'synthetic-version',
    function_id: functionId,
    created_at: '2026-09-30T22:10:32Z',
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapHandler',
    service_account_id: runtimeSa,
    tags: ['r1-initial-bootstrap-async'],
  };
  assert.equal(
    classifyAsyncDeployRecovery(evidence({ versions: [version] })).verdict,
    'PREVIOUS_VERSION_PRESENT',
  );
  assert.equal(
    classifyAsyncDeployRecovery(evidence({
      versions: [{ ...version, tags: [] }],
    })).verdict,
    'PREVIOUS_VERSION_PRESENT',
  );
});

test('ambiguous provider evidence remains blocked', () => {
  const base = {
    function_id: functionId,
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapHandler',
    service_account_id: runtimeSa,
    tags: [],
  };
  const result = classifyAsyncDeployRecovery(evidence({
    versions: [
      { ...base, id: 'one', created_at: '2026-09-30T22:10:32Z' },
      { ...base, id: 'two', created_at: '2026-09-30T22:10:33Z' },
    ],
  }));
  assert.equal(result.verdict, 'PREVIOUS_WRITE_AMBIGUOUS');
});

test('missing runtime invoker or WIF user-on-runtime authority blocks correction', () => {
  assert.equal(
    classifyAsyncDeployRecovery(evidence({ functionBindings: [] })).verdict,
    'IAM_BOUNDARY_MISSING',
  );
  assert.equal(
    classifyAsyncDeployRecovery(evidence({ runtimeServiceAccountBindings: [] })).verdict,
    'IAM_BOUNDARY_MISSING',
  );
});

test('unbounded or malformed evidence fails closed', () => {
  assert.equal(
    classifyAsyncDeployRecovery(evidence({ versions: Array.from({ length: 1_000 }, () => ({})) })).verdict,
    'EVIDENCE_INVALID',
  );
  assert.equal(
    classifyAsyncDeployRecovery(evidence({ deployStartedAt: 'not-a-time' })).verdict,
    'EVIDENCE_INVALID',
  );
});
