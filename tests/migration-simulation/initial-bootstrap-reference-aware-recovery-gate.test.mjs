import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isInitialBootstrapResidualReferenceRecoveryAuthorized,
} from '../../dist/runtime/initialBootstrapReferenceAwareJob.js';

const residual = Object.freeze({
  verdict: 'RECOVERY_REQUIRED',
  reason: 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN',
});
const matched = Object.freeze({
  verdict: 'RECOVERY_REQUIRED',
  reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
});

test('bounded residual-reference recovery authorizes only exact same-snapshot match with zero reference writes', () => {
  assert.equal(
    isInitialBootstrapResidualReferenceRecoveryAuthorized(residual, matched, residual, 0),
    true,
  );
});

test('bounded residual-reference recovery fails closed on mismatch, surface drift, or planned reference writes', () => {
  const mismatch = Object.freeze({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_REFERENCE_STATE_MISMATCH',
  });
  const drifted = Object.freeze({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_MIXED_STATE_WITHOUT_RUN',
  });

  assert.equal(
    isInitialBootstrapResidualReferenceRecoveryAuthorized(residual, mismatch, residual, 0),
    false,
  );
  assert.equal(
    isInitialBootstrapResidualReferenceRecoveryAuthorized(residual, matched, drifted, 0),
    false,
  );
  assert.equal(
    isInitialBootstrapResidualReferenceRecoveryAuthorized(residual, matched, residual, 1),
    false,
  );
});
