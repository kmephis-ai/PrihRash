import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRecoveryFunctionDeployAttempt,
  classifyRecoveryFunctionDeployAttemptSuccess,
} from '../../scripts/classify-yandex-initial-bootstrap-recovery-deploy-attempt.mjs';

const ids = Object.freeze({
  functionId: 'synthetic-function-id',
  runtimeServiceAccountId: 'synthetic-runtime-sa',
  wifServiceAccountId: 'synthetic-wif-sa',
  lockboxSecretId: 'synthetic-lockbox-secret',
});

test('recovery deploy attempt classifies only allowlisted failure category and exact resource boundary', () => {
  assert.deepEqual(classifyRecoveryFunctionDeployAttempt(
    'PermissionDenied: synthetic-function-id access denied', ids,
  ), {
    status: 'FAIL',
    code: 'RECOVERY_FUNCTION_VERSION_CREATE_FAILED',
    failureClass: 'PERMISSION_DENIED',
    permissionBoundary: 'FUNCTION_RESOURCE',
  });
  assert.equal(classifyRecoveryFunctionDeployAttempt(
    'PERMISSION_DENIED iam.serviceAccounts.user synthetic-runtime-sa', ids,
  ).permissionBoundary, 'RUNTIME_SERVICE_ACCOUNT_RESOURCE');
  assert.equal(classifyRecoveryFunctionDeployAttempt(
    'permission denied for synthetic-wif-sa', ids,
  ).permissionBoundary, 'WIF_SERVICE_ACCOUNT_RESOURCE');
  assert.equal(classifyRecoveryFunctionDeployAttempt(
    'PERMISSION_DENIED lockbox secret synthetic-lockbox-secret', ids,
  ).permissionBoundary, 'LOCKBOX_SECRET_RESOURCE');
  assert.equal(classifyRecoveryFunctionDeployAttempt(
    'Access policy denied this operation', ids,
  ).permissionBoundary, 'ACCESS_POLICY');
  assert.equal(classifyRecoveryFunctionDeployAttempt(
    'permission denied for an unknown resource', ids,
  ).permissionBoundary, 'UNRESOLVED');
});

test('recovery deploy attempt maps provider status families without returning raw stderr', () => {
  const cases = [
    ['INVALID_ARGUMENT malformed request', 'INVALID_ARGUMENT'],
    ['FAILED_PRECONDITION resource state', 'FAILED_PRECONDITION'],
    ['RESOURCE_EXHAUSTED quota', 'RESOURCE_EXHAUSTED'],
    ['UNAUTHENTICATED', 'UNAUTHENTICATED'],
    ['NOT_FOUND', 'NOT_FOUND'],
    ['ALREADY_EXISTS', 'ALREADY_EXISTS'],
    ['UNAVAILABLE', 'UNAVAILABLE'],
    ['INTERNAL', 'INTERNAL'],
    ['DEADLINE_EXCEEDED', 'DEADLINE_EXCEEDED'],
    ['unknown provider response', 'OTHER'],
  ];
  for (const [stderr, expected] of cases) {
    const result = classifyRecoveryFunctionDeployAttempt(stderr, ids);
    assert.equal(result.failureClass, expected);
    assert.equal(JSON.stringify(result).includes('synthetic-'), false);
    assert.doesNotMatch(JSON.stringify(result), /malformed request|unknown provider response/);
  }
  assert.equal(
    classifyRecoveryFunctionDeployAttempt('').failureClass,
    'PROVIDER_ERROR_DETAIL_UNAVAILABLE',
  );
  assert.equal(
    classifyRecoveryFunctionDeployAttempt('PermissionDenied and InvalidArgument', ids).failureClass,
    'OTHER',
  );
});

test('successful recovery Function version create is an accepted deploy result and never an invoke result', () => {
  assert.deepEqual(classifyRecoveryFunctionDeployAttemptSuccess(), {
    status: 'PASS',
    code: 'RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE',
    failureClass: 'NONE',
    permissionBoundary: 'NOT_APPLICABLE',
  });
});
