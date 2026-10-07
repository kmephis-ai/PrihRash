import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ERROR_CLASSES = new Set([
  'PERMISSION_DENIED',
  'INVALID_ARGUMENT',
  'FAILED_PRECONDITION',
  'RESOURCE_EXHAUSTED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'UNAVAILABLE',
  'INTERNAL',
  'DEADLINE_EXCEEDED',
  'OTHER',
  'PROVIDER_ERROR_DETAIL_UNAVAILABLE',
]);

const PERMISSION_BOUNDARIES = new Set([
  'FUNCTION_RESOURCE',
  'RUNTIME_SERVICE_ACCOUNT_RESOURCE',
  'WIF_SERVICE_ACCOUNT_RESOURCE',
  'LOCKBOX_SECRET_RESOURCE',
  'ACCESS_POLICY',
  'UNRESOLVED',
  'NOT_APPLICABLE',
]);

const CREATE_OPERATION_EVIDENCE = new Set([
  'CREATE_OPERATION_NOT_OBSERVED',
  'CREATE_OPERATION_IN_PROGRESS',
  'CREATE_OPERATION_COMPLETED_SUCCESS',
  'CREATE_OPERATION_COMPLETED_FAILED',
  'CREATE_OPERATION_AMBIGUOUS',
  'CREATE_OPERATION_READ_FAILED',
  'CREATE_OPERATION_READ_INCOMPLETE',
  'CREATE_OPERATION_EVIDENCE_INVALID',
]);

const FAILURE_BOUNDARIES = new Set([
  'PRE_OPERATION_OR_SYNC_REJECTION',
  'ASYNC_OPERATION_OBSERVED',
  'UNCLASSIFIED',
]);

const CREATE_VERSION_METADATA_TYPE =
  'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata';

const PROVIDER_ERROR_PATTERNS = Object.freeze([
  ['PERMISSION_DENIED', /permission[ _-]?denied|PermissionDenied/i],
  ['PERMISSION_DENIED', /access policy.{0,40}denied|organization policy.{0,40}denied/i],
  ['UNAUTHENTICATED', /unauthenticated|Unauthenticated/i],
  ['RESOURCE_EXHAUSTED', /resource[ _-]?exhausted|ResourceExhausted/i],
  ['FAILED_PRECONDITION', /failed[ _-]?precondition|FailedPrecondition/i],
  ['INVALID_ARGUMENT', /invalid[ _-]?argument|InvalidArgument/i],
  ['DEADLINE_EXCEEDED', /deadline[ _-]?exceeded|DeadlineExceeded/i],
  ['NOT_FOUND', /not[ _-]?found|NotFound/i],
  ['ALREADY_EXISTS', /already[ _-]?exists|AlreadyExists/i],
  ['UNAVAILABLE', /unavailable|Unavailable/i],
  ['INTERNAL', /internal(?:\s+error)?|InternalError/i],
]);

function classifyPermissionBoundary(stderr, resourceIds) {
  const matches = [];
  if (resourceIds.functionId && stderr.includes(resourceIds.functionId)) matches.push('FUNCTION_RESOURCE');
  if (resourceIds.runtimeServiceAccountId && stderr.includes(resourceIds.runtimeServiceAccountId)) {
    matches.push('RUNTIME_SERVICE_ACCOUNT_RESOURCE');
  }
  if (resourceIds.wifServiceAccountId && stderr.includes(resourceIds.wifServiceAccountId)) {
    matches.push('WIF_SERVICE_ACCOUNT_RESOURCE');
  }
  if (resourceIds.lockboxSecretId && stderr.includes(resourceIds.lockboxSecretId)) {
    matches.push('LOCKBOX_SECRET_RESOURCE');
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return 'UNRESOLVED';
  if (/organization policy|access policy|resource policy/i.test(stderr)) return 'ACCESS_POLICY';
  return 'UNRESOLVED';
}

export function classifyRecoveryFunctionDeployAttempt(stderr, resourceIds = {}) {
  if (typeof stderr !== 'string' || stderr.trim().length === 0) {
    return Object.freeze({
      status: 'FAIL',
      code: 'RECOVERY_FUNCTION_VERSION_CREATE_FAILED',
      failureClass: 'PROVIDER_ERROR_DETAIL_UNAVAILABLE',
      permissionBoundary: 'NOT_APPLICABLE',
    });
  }

  const matches = PROVIDER_ERROR_PATTERNS
    .filter(([, pattern]) => pattern.test(stderr))
    .map(([failureClass]) => failureClass);
  const uniqueMatches = [...new Set(matches)];
  const failureClass = uniqueMatches.length === 1 ? uniqueMatches[0] : 'OTHER';
  const permissionBoundary = failureClass === 'PERMISSION_DENIED'
    ? classifyPermissionBoundary(stderr, resourceIds)
    : 'NOT_APPLICABLE';
  return Object.freeze({
    status: 'FAIL',
    code: 'RECOVERY_FUNCTION_VERSION_CREATE_FAILED',
    failureClass: ERROR_CLASSES.has(failureClass) ? failureClass : 'OTHER',
    permissionBoundary: PERMISSION_BOUNDARIES.has(permissionBoundary) ? permissionBoundary : 'UNRESOLVED',
  });
}

export function classifyRecoveryCreateOperationEvidence({
  response,
  createStartedAt,
  createFinishedAt,
  operationCreatorServiceAccountId,
  readStatus = 'READY',
}) {
  if (readStatus !== 'READY') return 'CREATE_OPERATION_READ_FAILED';
  const start = Date.parse(createStartedAt);
  const finish = Date.parse(createFinishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start
    || typeof operationCreatorServiceAccountId !== 'string'
    || operationCreatorServiceAccountId.length === 0
    || !response || typeof response !== 'object' || Array.isArray(response)) {
    return 'CREATE_OPERATION_EVIDENCE_INVALID';
  }

  const operations = response.operations === undefined ? [] : response.operations;
  if (!Array.isArray(operations)) return 'CREATE_OPERATION_EVIDENCE_INVALID';
  if (typeof response.nextPageToken !== 'undefined' && typeof response.nextPageToken !== 'string') {
    return 'CREATE_OPERATION_EVIDENCE_INVALID';
  }
  if ((response.nextPageToken ?? '').length > 0 || operations.length >= 1_000) {
    return 'CREATE_OPERATION_READ_INCOMPLETE';
  }

  const lowerBound = start - 5_000;
  const upperBound = finish + 5_000;
  const matching = [];
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      return 'CREATE_OPERATION_EVIDENCE_INVALID';
    }
    const createdAtRaw = operation.createdAt ?? operation.created_at;
    const createdBy = operation.createdBy ?? operation.created_by;
    const createdAt = Date.parse(createdAtRaw);
    if (!Number.isFinite(createdAt) || typeof createdBy !== 'string' || createdBy.length === 0) {
      return 'CREATE_OPERATION_EVIDENCE_INVALID';
    }
    if (createdBy !== operationCreatorServiceAccountId
      || createdAt < lowerBound || createdAt > upperBound) continue;

    const metadata = operation.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || typeof metadata['@type'] !== 'string' || metadata['@type'].length === 0) {
      return 'CREATE_OPERATION_EVIDENCE_INVALID';
    }
    if (metadata['@type'] !== CREATE_VERSION_METADATA_TYPE) continue;
    const versionId = metadata.functionVersionId ?? metadata.function_version_id;
    if (typeof versionId !== 'string' || versionId.length === 0) {
      return 'CREATE_OPERATION_EVIDENCE_INVALID';
    }
    matching.push(operation);
  }

  if (matching.length === 0) return 'CREATE_OPERATION_NOT_OBSERVED';
  if (matching.length > 1) return 'CREATE_OPERATION_AMBIGUOUS';

  const [operation] = matching;
  if (operation.done === false) return 'CREATE_OPERATION_IN_PROGRESS';
  if (operation.done !== true) return 'CREATE_OPERATION_EVIDENCE_INVALID';
  if (operation.error && typeof operation.error === 'object' && !Array.isArray(operation.error)) {
    return 'CREATE_OPERATION_COMPLETED_FAILED';
  }
  if (!operation.response || typeof operation.response !== 'object' || Array.isArray(operation.response)) {
    return 'CREATE_OPERATION_EVIDENCE_INVALID';
  }
  return 'CREATE_OPERATION_COMPLETED_SUCCESS';
}

export function classifyRecoveryFunctionDeployAttemptWithOperationEvidence({
  stderr,
  exitCode,
  operationListResponse,
  operationListReadStatus,
  createStartedAt,
  createFinishedAt,
  operationCreatorServiceAccountId,
  resourceIds = {},
}) {
  const base = classifyRecoveryFunctionDeployAttempt(stderr, resourceIds);
  const cliExit = Number.isInteger(exitCode) && exitCode !== 0 ? 'NONZERO' : 'UNCLASSIFIED';
  const createOperationEvidence = classifyRecoveryCreateOperationEvidence({
    response: operationListResponse,
    createStartedAt,
    createFinishedAt,
    operationCreatorServiceAccountId,
    readStatus: operationListReadStatus,
  });
  let failureBoundary = 'UNCLASSIFIED';
  if (cliExit === 'NONZERO' && createOperationEvidence === 'CREATE_OPERATION_NOT_OBSERVED') {
    failureBoundary = 'PRE_OPERATION_OR_SYNC_REJECTION';
  } else if ([
    'CREATE_OPERATION_IN_PROGRESS',
    'CREATE_OPERATION_COMPLETED_SUCCESS',
    'CREATE_OPERATION_COMPLETED_FAILED',
  ].includes(createOperationEvidence)) {
    failureBoundary = 'ASYNC_OPERATION_OBSERVED';
  }
  return Object.freeze({
    ...base,
    cliExit,
    createOperationEvidence: CREATE_OPERATION_EVIDENCE.has(createOperationEvidence)
      ? createOperationEvidence : 'CREATE_OPERATION_EVIDENCE_INVALID',
    failureBoundary: FAILURE_BOUNDARIES.has(failureBoundary) ? failureBoundary : 'UNCLASSIFIED',
  });
}

export function classifyRecoveryFunctionDeployAttemptSuccess() {
  return Object.freeze({
    status: 'PASS',
    code: 'RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE',
    failureClass: 'NONE',
    permissionBoundary: 'NOT_APPLICABLE',
  });
}

async function main(args) {
  const [mode, errorPath] = args;
  if (mode === '--success' && args.length === 1) {
    return classifyRecoveryFunctionDeployAttemptSuccess();
  }

  const resourceIds = {
    functionId: process.env.RECOVERY_FUNCTION_ID,
    runtimeServiceAccountId: process.env.RECOVERY_RUNTIME_SERVICE_ACCOUNT_ID,
    wifServiceAccountId: process.env.RECOVERY_WIF_SERVICE_ACCOUNT_ID,
    lockboxSecretId: process.env.RECOVERY_LOCKBOX_SECRET_ID,
  };

  if (mode === '--error-with-operation-evidence' && args.length === 8) {
    const [, stderrPath, exitCodeRaw, readStatus, operationsPath,
      createStartedAt, createFinishedAt, operationCreatorServiceAccountId] = args;
    let stderr = '';
    let operationListResponse = {};
    try {
      stderr = await readFile(stderrPath, 'utf8');
    } catch {
      stderr = '';
    }
    if (readStatus === 'READY') {
      try {
        operationListResponse = JSON.parse(await readFile(operationsPath, 'utf8'));
      } catch {
        operationListResponse = null;
      }
    }
    const parsedExitCode = /^-?[0-9]+$/.test(exitCodeRaw) ? Number(exitCodeRaw) : Number.NaN;
    return classifyRecoveryFunctionDeployAttemptWithOperationEvidence({
      stderr,
      exitCode: Number.isSafeInteger(parsedExitCode) ? parsedExitCode : null,
      operationListResponse,
      operationListReadStatus: readStatus,
      createStartedAt,
      createFinishedAt,
      operationCreatorServiceAccountId,
      resourceIds,
    });
  }

  if (mode !== '--error' || !errorPath || args.length !== 2) {
    return classifyRecoveryFunctionDeployAttempt('');
  }
  let stderr = '';
  try {
    stderr = await readFile(errorPath, 'utf8');
  } catch {
    return classifyRecoveryFunctionDeployAttempt('');
  }
  return classifyRecoveryFunctionDeployAttempt(stderr, resourceIds);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
