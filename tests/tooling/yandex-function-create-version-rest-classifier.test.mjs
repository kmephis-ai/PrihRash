import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyDirectRestCreateVersion } from '../../scripts/classify-yandex-function-create-version-rest.mjs';

const actor = 'synthetic-service-account';
const started = '2026-10-08T04:30:00Z';
const finished = '2026-10-08T04:30:02Z';

function op(id = 'op-1', done = false, extra = {}) {
  return {
    id,
    createdAt: '2026-10-08T04:30:01Z',
    createdBy: actor,
    done,
    ...extra,
  };
}

function listOp(done = false, extra = {}) {
  return {
    id: 'list-op-1',
    createdAt: '2026-10-08T04:30:01Z',
    createdBy: actor,
    done,
    metadata: {
      '@type': 'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata',
      functionVersionId: 'synthetic-version-id',
    },
    ...extra,
  };
}

test('direct REST 200 Operation response is accepted without leaking identifiers', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 0,
    httpStatus: '200',
    response: op(),
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [listOp()] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
    operationReadStatus: 'READY',
    operationResponse: op('op-1', true, { response: { '@type': 'synthetic.FunctionVersion' } }),
  });
  assert.deepEqual(result, {
    status: 'ACCEPTED',
    code: 'RECOVERY_FUNCTION_VERSION_REST_CREATE_ACCEPTED',
    transportClass: 'CURL_OK',
    httpClass: 'HTTP_2XX',
    failureClass: 'NOT_APPLICABLE',
    responseOperationEvidence: 'REST_OPERATION_ACCEPTED',
    createOperationEvidence: 'CREATE_OPERATION_IN_PROGRESS',
    failureBoundary: 'ASYNC_OPERATION_OBSERVED',
    operationState: 'OPERATION_SUCCEEDED',
    operationFailureClass: 'NOT_APPLICABLE',
    operationFailureDetailClass: 'NOT_APPLICABLE',
  });
  assert.doesNotMatch(JSON.stringify(result), /op-1|synthetic-version-id|synthetic-service-account/);
});

test('direct REST 404 with no operation is a pre-operation NOT_FOUND', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 0,
    httpStatus: '404',
    response: { error: { code: 5, message: 'synthetic not found' } },
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.code, 'RECOVERY_FUNCTION_VERSION_REST_CREATE_FAILED');
  assert.equal(result.failureClass, 'NOT_FOUND');
  assert.equal(result.responseOperationEvidence, 'REST_OPERATION_NOT_RETURNED');
  assert.equal(result.createOperationEvidence, 'CREATE_OPERATION_NOT_OBSERVED');
  assert.equal(result.failureBoundary, 'PRE_OPERATION_OR_SYNC_REJECTION');
  assert.equal(result.operationState, 'NOT_APPLICABLE');
  assert.doesNotMatch(JSON.stringify(result), /synthetic not found/);
});

test('transport failure is still accepted if independent ListOperations proves the create', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 28,
    httpStatus: '000',
    response: null,
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [listOp(true, { response: {} })] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
  });
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.transportClass, 'CURL_FAILED');
  assert.equal(result.createOperationEvidence, 'CREATE_OPERATION_COMPLETED_SUCCESS');
  assert.equal(result.failureBoundary, 'ASYNC_OPERATION_OBSERVED');
});

test('malformed 2xx response stays unclassified rather than inferred', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 0,
    httpStatus: '200',
    response: { done: false },
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
  });
  assert.equal(result.status, 'UNCLASSIFIED');
  assert.equal(result.responseOperationEvidence, 'REST_OPERATION_RESPONSE_INVALID');
  assert.equal(result.createOperationEvidence, 'CREATE_OPERATION_NOT_OBSERVED');
  assert.equal(result.failureBoundary, 'UNCLASSIFIED');
});

test('operation terminal failure is preserved after accepted REST create', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 0,
    httpStatus: '200',
    response: op(),
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [listOp()] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
    operationReadStatus: 'READY',
    operationResponse: op('op-1', true, { error: { code: 13 } }),
  });
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.operationState, 'OPERATION_FAILED');
  assert.equal(result.failureBoundary, 'ASYNC_OPERATION_OBSERVED');
});

test('operation ABORTED builder 503 is reduced to privacy-safe provider-unavailable evidence', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 0,
    httpStatus: '200',
    response: op(),
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [listOp()] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
    operationReadStatus: 'READY',
    operationResponse: op('op-1', true, {
      error: {
        code: 10,
        message: 'Builder exited unexpectedly: {"errorCode":503,"errorMessage":"Service Unavailable","errorType":"ServerError"}',
      },
    }),
  });
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.operationState, 'OPERATION_FAILED');
  assert.equal(result.operationFailureClass, 'ABORTED');
  assert.equal(result.operationFailureDetailClass, 'PROVIDER_BUILDER_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /Builder exited unexpectedly|Service Unavailable|op-1/);
});

test('operation polling timeout is accepted-but-pending and remains no-retry evidence', () => {
  const result = classifyDirectRestCreateVersion({
    curlExit: 0,
    httpStatus: '200',
    response: op(),
    operationsReadStatus: 'READY',
    operationsResponse: { operations: [listOp()] },
    createStartedAt: started,
    createFinishedAt: finished,
    actorServiceAccountId: actor,
    operationReadStatus: 'PENDING_TIMEOUT',
    operationResponse: null,
  });
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.operationState, 'OPERATION_PENDING_TIMEOUT');
});
