import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ENUMS = new Set([
  'DEPLOYMENT_OUTCOME_UNCLASSIFIED',
  'CREATE_OPERATION_NOT_UNIQUE',
  'CREATE_OPERATION_IN_PROGRESS',
  'CREATE_OPERATION_FAILED',
  'CREATED_VERSION_NOT_PROVEN',
  'EXACT_RECOVERY_VERSION_CREATED',
  'DIAGNOSTIC_FAILED',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readJson(path) {
  return readFile(path, 'utf8').then((text) => JSON.parse(text));
}

export function classifyRecoveryFunctionDeployOutcome({
  versions,
  operations,
  taggedVersion,
  runStartedAt,
  runFinishedAt,
  deploymentServiceAccountId,
}) {
  try {
    const start = timestamp(runStartedAt);
    const finish = timestamp(runFinishedAt);
    if (
      start === null
      || finish === null
      || finish < start
      || typeof deploymentServiceAccountId !== 'string'
      || deploymentServiceAccountId.length === 0
      || !Array.isArray(versions)
      || !Array.isArray(operations)
    ) return 'DIAGNOSTIC_FAILED';

    const lowerBound = start - 5_000;
    const upperBound = finish + 5_000;
    const matchingOperations = operations.filter((operation) => {
      if (!object(operation)) return false;
      const createdAt = timestamp(operation.created_at);
      return operation.created_by === deploymentServiceAccountId
        && createdAt !== null
        && createdAt >= lowerBound
        && createdAt <= upperBound;
    });
    if (matchingOperations.length !== 1) return 'CREATE_OPERATION_NOT_UNIQUE';

    const [operation] = matchingOperations;
    if (operation.done === false) return 'CREATE_OPERATION_IN_PROGRESS';
    if (object(operation.error)) return 'CREATE_OPERATION_FAILED';
    if (operation.done !== true || !object(operation.response)) return 'DEPLOYMENT_OUTCOME_UNCLASSIFIED';

    const operationVersionId = operation.response.id;
    if (typeof operationVersionId !== 'string' || operationVersionId.length === 0) {
      return 'CREATED_VERSION_NOT_PROVEN';
    }
    const versionCandidates = versions.filter((version) => {
      if (!object(version) || !Array.isArray(version.tags)) return false;
      const createdAt = timestamp(version.created_at);
      return version.tags.includes('r1-initial-bootstrap-recovery')
        && createdAt !== null
        && createdAt >= lowerBound
        && createdAt <= upperBound;
    });
    if (versionCandidates.length !== 1) return 'CREATED_VERSION_NOT_PROVEN';

    const [version] = versionCandidates;
    if (
      version.id !== operationVersionId
      || !object(taggedVersion)
      || taggedVersion.id !== operationVersionId
      || taggedVersion.status !== 'ACTIVE'
      || taggedVersion.runtime !== 'nodejs22'
      || taggedVersion.entrypoint !== 'index.initialBootstrapRecoveryHandler'
      || taggedVersion.serviceAccountId !== deploymentServiceAccountId
    ) return 'CREATED_VERSION_NOT_PROVEN';

    return 'EXACT_RECOVERY_VERSION_CREATED';
  } catch {
    return 'DIAGNOSTIC_FAILED';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [versionsPath, operationsPath, taggedVersionPath, runStartedAt, runFinishedAt, deploymentServiceAccountId] = process.argv.slice(2);
  if (!versionsPath || !operationsPath || !taggedVersionPath || !runStartedAt || !runFinishedAt || !deploymentServiceAccountId) {
    process.stdout.write('DIAGNOSTIC_FAILED\n');
    process.exitCode = 2;
  } else {
    try {
      const [versions, operations, taggedVersion] = await Promise.all([
        readJson(versionsPath),
        readJson(operationsPath),
        readJson(taggedVersionPath),
      ]);
      const result = classifyRecoveryFunctionDeployOutcome({
        versions,
        operations,
        taggedVersion,
        runStartedAt,
        runFinishedAt,
        deploymentServiceAccountId,
      });
      process.stdout.write(`${ENUMS.has(result) ? result : 'DIAGNOSTIC_FAILED'}\n`);
      if (result === 'DIAGNOSTIC_FAILED') process.exitCode = 2;
    } catch {
      process.stdout.write('DIAGNOSTIC_FAILED\n');
      process.exitCode = 2;
    }
  }
}
