import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRecoveryCreateOperationEvidence,
  classifyRecoveryFunctionDeployAttempt,
  classifyRecoveryFunctionDeployAttemptSuccess,
  classifyRecoveryFunctionDeployAttemptWithOperationEvidence,
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

test('generic recovery failure classifies no Function operation as a pre-operation or synchronous rejection', () => {
  const result = classifyRecoveryFunctionDeployAttemptWithOperationEvidence({
    stderr: 'InvalidArgument: synthetic request rejected',
    exitCode: 1,
    operationListResponse: { operations: [] },
    operationListReadStatus: 'READY',
    createStartedAt: '2026-10-04T22:02:18Z',
    createFinishedAt: '2026-10-04T22:02:19Z',
    operationCreatorServiceAccountId: ids.wifServiceAccountId,
    resourceIds: ids,
  });
  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'RECOVERY_FUNCTION_VERSION_CREATE_FAILED',
    failureClass: 'INVALID_ARGUMENT',
    permissionBoundary: 'NOT_APPLICABLE',
    cliExit: 'NONZERO',
    createOperationEvidence: 'CREATE_OPERATION_NOT_OBSERVED',
    failureBoundary: 'PRE_OPERATION_OR_SYNC_REJECTION',
  });
  assert.doesNotMatch(JSON.stringify(result), /synthetic request rejected/);
});

test('generic recovery failure preserves accepted async create state without exposing operation ids', () => {
  const base = {
    id: 'synthetic-operation-id',
    createdAt: '2026-10-04T22:02:18.500Z',
    createdBy: ids.wifServiceAccountId,
    metadata: {
      '@type': 'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata',
      functionVersionId: 'synthetic-version-id',
    },
  };
  for (const [operation, expected] of [
    [{ ...base, done: false }, 'CREATE_OPERATION_IN_PROGRESS'],
    [{ ...base, done: true, error: { code: 13 } }, 'CREATE_OPERATION_COMPLETED_FAILED'],
    [{ ...base, done: true, response: { '@type': 'synthetic.Version' } }, 'CREATE_OPERATION_COMPLETED_SUCCESS'],
  ]) {
    const result = classifyRecoveryFunctionDeployAttemptWithOperationEvidence({
      stderr: 'Unavailable',
      exitCode: 1,
      operationListResponse: { operations: [operation] },
      operationListReadStatus: 'READY',
      createStartedAt: '2026-10-04T22:02:18Z',
      createFinishedAt: '2026-10-04T22:02:19Z',
      operationCreatorServiceAccountId: ids.wifServiceAccountId,
      resourceIds: ids,
    });
    assert.equal(result.createOperationEvidence, expected);
    assert.equal(result.failureBoundary, 'ASYNC_OPERATION_OBSERVED');
    assert.doesNotMatch(JSON.stringify(result), /synthetic-operation-id|synthetic-version-id/);
  }
});

test('generic recovery failure operation evidence fails closed on ambiguity, pagination and malformed metadata', () => {
  const op = {
    id: 'synthetic-operation-id',
    createdAt: '2026-10-04T22:02:18.500Z',
    createdBy: ids.wifServiceAccountId,
    done: true,
    metadata: {
      '@type': 'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata',
      functionVersionId: 'synthetic-version-id',
    },
    response: {},
  };
  const common = {
    createStartedAt: '2026-10-04T22:02:18Z',
    createFinishedAt: '2026-10-04T22:02:19Z',
    operationCreatorServiceAccountId: ids.wifServiceAccountId,
  };
  assert.equal(classifyRecoveryCreateOperationEvidence({
    ...common, response: { operations: [op, { ...op, id: 'another-operation' }] },
  }), 'CREATE_OPERATION_AMBIGUOUS');
  assert.equal(classifyRecoveryCreateOperationEvidence({
    ...common, response: { operations: [op], nextPageToken: 'next-page' },
  }), 'CREATE_OPERATION_READ_INCOMPLETE');
  assert.equal(classifyRecoveryCreateOperationEvidence({
    ...common, response: { operations: [{ ...op, metadata: {} }] },
  }), 'CREATE_OPERATION_EVIDENCE_INVALID');
  assert.equal(classifyRecoveryCreateOperationEvidence({
    ...common, response: {}, readStatus: 'READ_FAILED',
  }), 'CREATE_OPERATION_READ_FAILED');
});

test('generic recovery failure ignores unrelated actor/time operations but does not accept zero exit as causal evidence', () => {
  const unrelated = {
    id: 'unrelated',
    createdAt: '2026-10-04T21:00:00Z',
    createdBy: 'another-service-account',
    done: true,
    metadata: {
      '@type': 'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata',
      functionVersionId: 'other-version',
    },
    response: {},
  };
  const result = classifyRecoveryFunctionDeployAttemptWithOperationEvidence({
    stderr: 'provider response',
    exitCode: 0,
    operationListResponse: { operations: [unrelated] },
    operationListReadStatus: 'READY',
    createStartedAt: '2026-10-04T22:02:18Z',
    createFinishedAt: '2026-10-04T22:02:19Z',
    operationCreatorServiceAccountId: ids.wifServiceAccountId,
    resourceIds: ids,
  });
  assert.equal(result.cliExit, 'UNCLASSIFIED');
  assert.equal(result.createOperationEvidence, 'CREATE_OPERATION_NOT_OBSERVED');
  assert.equal(result.failureBoundary, 'UNCLASSIFIED');
});
