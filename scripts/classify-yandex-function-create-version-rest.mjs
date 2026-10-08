import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { classifyRecoveryCreateOperationEvidence } from './classify-yandex-initial-bootstrap-recovery-deploy-attempt.mjs';

const RPC_CODES = new Map([
  [3, 'INVALID_ARGUMENT'],
  [4, 'DEADLINE_EXCEEDED'],
  [5, 'NOT_FOUND'],
  [6, 'ALREADY_EXISTS'],
  [7, 'PERMISSION_DENIED'],
  [8, 'RESOURCE_EXHAUSTED'],
  [9, 'FAILED_PRECONDITION'],
  [10, 'ABORTED'],
  [13, 'INTERNAL'],
  [14, 'UNAVAILABLE'],
  [16, 'UNAUTHENTICATED'],
]);

function httpClass(status) {
  if (/^2\d\d$/.test(status)) return 'HTTP_2XX';
  if (status === '400') return 'HTTP_400';
  if (status === '401') return 'HTTP_401';
  if (status === '403') return 'HTTP_403';
  if (status === '404') return 'HTTP_404';
  if (status === '409') return 'HTTP_409';
  if (status === '429') return 'HTTP_429';
  if (/^5\d\d$/.test(status)) return 'HTTP_5XX';
  return 'HTTP_OTHER';
}

function httpFailureClass(status, body) {
  const code = body?.error?.code;
  if (Number.isInteger(code) && RPC_CODES.has(code)) return RPC_CODES.get(code);
  return new Map([
    ['400', 'INVALID_ARGUMENT'],
    ['401', 'UNAUTHENTICATED'],
    ['403', 'PERMISSION_DENIED'],
    ['404', 'NOT_FOUND'],
    ['409', 'FAILED_PRECONDITION'],
    ['429', 'RESOURCE_EXHAUSTED'],
  ]).get(status) ?? (/^5\d\d$/.test(status) ? 'UNAVAILABLE' : 'OTHER');
}

function operationState(readStatus, body, responseOperationId) {
  if (readStatus === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  if (readStatus === 'READ_FAILED') return 'OPERATION_READ_FAILED';
  if (readStatus === 'PENDING_TIMEOUT') return 'OPERATION_PENDING_TIMEOUT';
  if (readStatus !== 'READY' || !body || typeof body !== 'object' || Array.isArray(body)) {
    return 'OPERATION_EVIDENCE_INVALID';
  }
  if (typeof body.id !== 'string' || body.id.length === 0 || body.id !== responseOperationId) {
    return 'OPERATION_EVIDENCE_INVALID';
  }
  if (body.done === false) return 'OPERATION_IN_PROGRESS';
  if (body.done !== true) return 'OPERATION_EVIDENCE_INVALID';
  if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) return 'OPERATION_FAILED';
  if (body.response && typeof body.response === 'object' && !Array.isArray(body.response)) return 'OPERATION_SUCCEEDED';
  return 'OPERATION_EVIDENCE_INVALID';
}

function operationFailureEvidence(readStatus, body, state) {
  if (state !== 'OPERATION_FAILED') {
    return Object.freeze({
      operationFailureClass: 'NOT_APPLICABLE',
      operationFailureDetailClass: 'NOT_APPLICABLE',
    });
  }
  if (readStatus !== 'READY' || !body?.error || typeof body.error !== 'object' || Array.isArray(body.error)) {
    return Object.freeze({
      operationFailureClass: 'UNCLASSIFIED',
      operationFailureDetailClass: 'UNCLASSIFIED',
    });
  }

  const errorCode = body.error.code;
  const operationFailureClass = Number.isInteger(errorCode) && RPC_CODES.has(errorCode)
    ? RPC_CODES.get(errorCode)
    : 'OTHER';

  let operationFailureDetailClass = 'OTHER';
  const message = typeof body.error.message === 'string' ? body.error.message : '';
  const builderPrefix = 'Builder exited unexpectedly: ';
  if (message.startsWith(builderPrefix)) {
    try {
      const inner = JSON.parse(message.slice(builderPrefix.length));
      if (
        inner?.errorCode === 503
        && inner?.errorType === 'ServerError'
        && inner?.errorMessage === 'Service Unavailable'
      ) {
        operationFailureDetailClass = 'PROVIDER_BUILDER_UNAVAILABLE';
      } else {
        operationFailureDetailClass = 'PROVIDER_BUILDER_FAILED';
      }
    } catch {
      operationFailureDetailClass = 'PROVIDER_BUILDER_FAILED';
    }
  }

  return Object.freeze({ operationFailureClass, operationFailureDetailClass });
}

export function classifyDirectRestCreateVersion({
  curlExit,
  httpStatus,
  response,
  operationsReadStatus,
  operationsResponse,
  createStartedAt,
  createFinishedAt,
  actorServiceAccountId,
  operationReadStatus = 'NOT_APPLICABLE',
  operationResponse = null,
}) {
  const transportClass = Number.isInteger(curlExit) && curlExit === 0 ? 'CURL_OK' : 'CURL_FAILED';
  const normalizedHttpClass = httpClass(httpStatus);
  const is2xx = normalizedHttpClass === 'HTTP_2XX';

  let responseOperationEvidence = 'REST_OPERATION_NOT_RETURNED';
  let responseOperationId = null;
  if (is2xx) {
    if (
      response && typeof response === 'object' && !Array.isArray(response)
      && typeof response.id === 'string' && response.id.length > 0
      && typeof response.createdAt === 'string' && Number.isFinite(Date.parse(response.createdAt))
      && typeof response.createdBy === 'string' && response.createdBy === actorServiceAccountId
    ) {
      responseOperationEvidence = 'REST_OPERATION_ACCEPTED';
      responseOperationId = response.id;
    } else {
      responseOperationEvidence = 'REST_OPERATION_RESPONSE_INVALID';
    }
  }

  const createOperationEvidence = classifyRecoveryCreateOperationEvidence({
    response: operationsResponse,
    createStartedAt,
    createFinishedAt,
    operationCreatorServiceAccountId: actorServiceAccountId,
    readStatus: operationsReadStatus,
  });
  const observedAsync = [
    'CREATE_OPERATION_IN_PROGRESS',
    'CREATE_OPERATION_COMPLETED_SUCCESS',
    'CREATE_OPERATION_COMPLETED_FAILED',
  ].includes(createOperationEvidence);

  const opState = operationState(operationReadStatus, operationResponse, responseOperationId);
  const operationFailure = operationFailureEvidence(operationReadStatus, operationResponse, opState);

  let status = 'UNCLASSIFIED';
  let code = 'RECOVERY_FUNCTION_VERSION_REST_CREATE_UNCLASSIFIED';
  let failureClass = 'NOT_APPLICABLE';
  let failureBoundary = 'UNCLASSIFIED';

  if (responseOperationEvidence === 'REST_OPERATION_ACCEPTED' || observedAsync) {
    status = 'ACCEPTED';
    code = 'RECOVERY_FUNCTION_VERSION_REST_CREATE_ACCEPTED';
    failureBoundary = 'ASYNC_OPERATION_OBSERVED';
  } else if (transportClass === 'CURL_FAILED' || !is2xx) {
    status = 'FAIL';
    code = 'RECOVERY_FUNCTION_VERSION_REST_CREATE_FAILED';
    failureClass = transportClass === 'CURL_FAILED' ? 'TRANSPORT_ERROR' : httpFailureClass(httpStatus, response);
    if (createOperationEvidence === 'CREATE_OPERATION_NOT_OBSERVED') {
      failureBoundary = 'PRE_OPERATION_OR_SYNC_REJECTION';
    }
  }

  return Object.freeze({
    status,
    code,
    transportClass,
    httpClass: normalizedHttpClass,
    failureClass,
    responseOperationEvidence,
    createOperationEvidence,
    failureBoundary,
    operationState: opState,
    operationFailureClass: operationFailure.operationFailureClass,
    operationFailureDetailClass: operationFailure.operationFailureDetailClass,
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main(args) {
  if (args.length !== 10) throw new Error('DIRECT_REST_CLASSIFIER_INPUT_INVALID');
  const [
    curlExitRaw, httpStatus, responsePath, operationsReadStatus, operationsPath,
    createStartedAt, createFinishedAt, actorServiceAccountId, operationReadStatus, operationPath,
  ] = args;
  const curlExit = /^\d+$/.test(curlExitRaw) ? Number(curlExitRaw) : -1;
  const response = await readJson(responsePath);
  const operationsResponse = operationsReadStatus === 'READY' ? await readJson(operationsPath) : {};
  const operationResponse = operationReadStatus === 'READY' ? await readJson(operationPath) : null;
  return classifyDirectRestCreateVersion({
    curlExit,
    httpStatus,
    response,
    operationsReadStatus,
    operationsResponse,
    createStartedAt,
    createFinishedAt,
    actorServiceAccountId,
    operationReadStatus,
    operationResponse,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(() => {
    process.stdout.write(JSON.stringify({
      status: 'UNCLASSIFIED',
      code: 'RECOVERY_FUNCTION_VERSION_REST_CREATE_UNCLASSIFIED',
      transportClass: 'UNCLASSIFIED',
      httpClass: 'HTTP_OTHER',
      failureClass: 'OTHER',
      responseOperationEvidence: 'REST_OPERATION_RESPONSE_INVALID',
      createOperationEvidence: 'CREATE_OPERATION_EVIDENCE_INVALID',
      failureBoundary: 'UNCLASSIFIED',
      operationState: 'OPERATION_EVIDENCE_INVALID',
      operationFailureClass: 'UNCLASSIFIED',
      operationFailureDetailClass: 'UNCLASSIFIED',
    }) + '\n');
    process.exitCode = 1;
  });
}
