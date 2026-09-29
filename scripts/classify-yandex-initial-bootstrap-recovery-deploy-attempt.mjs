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
  if (mode !== '--error' || !errorPath || args.length !== 2) {
    return classifyRecoveryFunctionDeployAttempt('');
  }
  let stderr = '';
  try {
    stderr = await readFile(errorPath, 'utf8');
  } catch {
    return classifyRecoveryFunctionDeployAttempt('');
  }
  return classifyRecoveryFunctionDeployAttempt(stderr, {
    functionId: process.env.RECOVERY_FUNCTION_ID,
    runtimeServiceAccountId: process.env.RECOVERY_RUNTIME_SERVICE_ACCOUNT_ID,
    wifServiceAccountId: process.env.RECOVERY_WIF_SERVICE_ACCOUNT_ID,
    lockboxSecretId: process.env.RECOVERY_LOCKBOX_SECRET_ID,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
