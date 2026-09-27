import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRecoveryFunctionDeployOutcome } from '../../scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs';

const runStartedAt = '2026-09-27T18:46:30Z';
const runFinishedAt = '2026-09-27T18:46:38Z';
const serviceAccount = 'synthetic-deployer';

function exactEvidence(overrides = {}) {
  const version = {
    id: 'synthetic-version',
    tags: ['r1-initial-bootstrap-recovery'],
    created_at: '2026-09-27T18:46:34Z',
  };
  const operation = {
    created_by: serviceAccount,
    created_at: '2026-09-27T18:46:33Z',
    done: true,
    response: { id: 'synthetic-version' },
  };
  const taggedVersion = {
    id: 'synthetic-version',
    status: 'ACTIVE',
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapRecoveryHandler',
    serviceAccountId: serviceAccount,
  };
  return {
    versions: [version],
    operations: [operation],
    taggedVersion,
    runStartedAt,
    runFinishedAt,
    deploymentServiceAccountId: serviceAccount,
    ...overrides,
  };
}

test('recovery deploy classifier proves only a unique exact version correlated to the failed create operation', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence()),
    'EXACT_RECOVERY_VERSION_CREATED',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      taggedVersion: { ...exactEvidence().taggedVersion, serviceAccountId: 'other' },
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      versions: [{ ...exactEvidence().versions[0], created_at: '2026-09-27T18:40:00Z' }],
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      taggedVersion: { ...exactEvidence().taggedVersion, id: 'other-version' },
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
});

test('recovery deploy classifier keeps missing, ambiguous, pending, and failed operations unclassified for mutation', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ operations: [] })),
    'CREATE_OPERATION_NOT_UNIQUE',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [...exactEvidence().operations, { ...exactEvidence().operations[0] }],
    })),
    'CREATE_OPERATION_NOT_UNIQUE',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [{ ...exactEvidence().operations[0], done: false }],
    })),
    'CREATE_OPERATION_IN_PROGRESS',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [{ ...exactEvidence().operations[0], error: { code: 3 } }],
    })),
    'CREATE_OPERATION_FAILED',
  );
});

test('recovery deploy classifier fails closed on malformed provider metadata and timestamps', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ runStartedAt: 'private timestamp' })),
    'DIAGNOSTIC_FAILED',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ operations: null })),
    'DIAGNOSTIC_FAILED',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ deploymentServiceAccountId: '' })),
    'DIAGNOSTIC_FAILED',
  );
});
