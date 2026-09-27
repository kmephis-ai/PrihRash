import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ENUMS = new Set([
  'DEPLOYMENT_OUTCOME_UNCLASSIFIED',
  'CREATE_OPERATION_AMBIGUOUS',
  'CREATE_OPERATION_IN_PROGRESS',
  'CREATE_OPERATION_FAILED',
  'CREATED_VERSION_NOT_PROVEN',
  'EXACT_RECOVERY_VERSION_CREATED',
  'RECOVERY_TAGGED_VERSION_CANDIDATE_PRESENT',
  'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW',
  'RECOVERY_TAGGED_VERSION_AMBIGUOUS',
  'RECOVERY_TAGGED_VERSION_METADATA_UNPROVEN',
  'DIAGNOSTIC_FAILED',
  'RECOVERY_DEPLOY_INPUT_INVALID',
  'RECOVERY_VERSION_ENTRY_INVALID',
  'RECOVERY_VERSION_TAGS_INVALID',
  'RECOVERY_VERSION_TIMESTAMP_INVALID',
  'RECOVERY_METADATA_JSON_INVALID',
  'RECOVERY_CLASSIFIER_INTERNAL_ERROR',
  'RECOVERY_TAG_HISTORY_METADATA_INVALID',
  'RECOVERY_TAG_HISTORY_INCOMPLETE',
  'RECOVERY_TAG_HISTORY_AMBIGUOUS',
  'RECOVERY_TAG_HISTORY_VERSION_NOT_OBSERVED',
  'RECOVERY_TAG_HISTORY_VERSION_CANDIDATE_PRESENT',
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
  tagHistory,
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
    ) return 'RECOVERY_DEPLOY_INPUT_INVALID';

    const lowerBound = start - 5_000;
    const upperBound = finish + 5_000;
    const matchingOperations = operations.filter((operation) => {
      if (!object(operation)) return false;
      const createdAt = timestamp(operation.created_at ?? operation.createdAt);
      const createdBy = operation.created_by ?? operation.createdBy;
      return createdBy === deploymentServiceAccountId
        && createdAt !== null
        && createdAt >= lowerBound
        && createdAt <= upperBound;
    });
    if (matchingOperations.length === 0) {
      const taggedCandidates = [];
      for (const version of versions) {
        if (!object(version)) return 'RECOVERY_VERSION_ENTRY_INVALID';
        const tags = version.tags === undefined ? [] : version.tags;
        if (!Array.isArray(tags)) return 'RECOVERY_VERSION_TAGS_INVALID';
        if (!tags.includes('r1-initial-bootstrap-recovery')) continue;
        const createdAt = timestamp(version.created_at);
        if (createdAt === null) return 'RECOVERY_VERSION_TIMESTAMP_INVALID';
        if (createdAt >= lowerBound && createdAt <= upperBound) taggedCandidates.push(version);
      }
      if (taggedCandidates.length === 0) {
        if (!object(tagHistory)) {
          return 'RECOVERY_TAG_HISTORY_METADATA_INVALID';
        }
        const historyRecords = tagHistory.functionTagHistoryRecord === undefined
          ? []
          : tagHistory.functionTagHistoryRecord;
        if (!Array.isArray(historyRecords)) return 'RECOVERY_TAG_HISTORY_METADATA_INVALID';
        if (tagHistory.nextPageToken !== undefined) {
          if (typeof tagHistory.nextPageToken !== 'string') return 'RECOVERY_TAG_HISTORY_METADATA_INVALID';
          if (tagHistory.nextPageToken.length > 0) return 'RECOVERY_TAG_HISTORY_INCOMPLETE';
        }

        const matchingHistory = [];
        for (const record of historyRecords) {
          if (!object(record) || typeof record.tag !== 'string') return 'RECOVERY_TAG_HISTORY_METADATA_INVALID';
          const versionId = record.functionVersionId;
          const effectiveFrom = timestamp(record.effectiveFrom);
          if (typeof versionId !== 'string' || versionId.length === 0 || effectiveFrom === null) {
            return 'RECOVERY_TAG_HISTORY_METADATA_INVALID';
          }
          if (record.effectiveTo !== undefined && timestamp(record.effectiveTo) === null) {
            return 'RECOVERY_TAG_HISTORY_METADATA_INVALID';
          }
          if (
            record.tag === 'r1-initial-bootstrap-recovery'
            && effectiveFrom >= lowerBound
            && effectiveFrom <= upperBound
          ) matchingHistory.push(record);
        }
        if (matchingHistory.length === 0) return 'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW';
        if (matchingHistory.length > 1) return 'RECOVERY_TAG_HISTORY_AMBIGUOUS';

        const matchingVersionId = matchingHistory[0].functionVersionId;
        const historyVersions = versions.filter((version) => object(version) && version.id === matchingVersionId);
        if (historyVersions.length === 0) return 'RECOVERY_TAG_HISTORY_VERSION_NOT_OBSERVED';
        if (historyVersions.length > 1) return 'RECOVERY_TAG_HISTORY_AMBIGUOUS';
        const versionCreatedAt = timestamp(historyVersions[0].created_at);
        if (versionCreatedAt === null) return 'RECOVERY_VERSION_TIMESTAMP_INVALID';
        if (versionCreatedAt < lowerBound || versionCreatedAt > upperBound) {
          return 'RECOVERY_TAG_HISTORY_VERSION_NOT_OBSERVED';
        }
        return 'RECOVERY_TAG_HISTORY_VERSION_CANDIDATE_PRESENT';
      }
      if (taggedCandidates.length > 1) return 'RECOVERY_TAGGED_VERSION_AMBIGUOUS';

      const [candidate] = taggedCandidates;
      if (
        !object(taggedVersion)
        || candidate.id !== taggedVersion.id
        || taggedVersion.status !== 'ACTIVE'
        || taggedVersion.runtime !== 'nodejs22'
        || taggedVersion.entrypoint !== 'index.initialBootstrapRecoveryHandler'
        || taggedVersion.serviceAccountId !== deploymentServiceAccountId
      ) return 'RECOVERY_TAGGED_VERSION_METADATA_UNPROVEN';
      return 'RECOVERY_TAGGED_VERSION_CANDIDATE_PRESENT';
    }
    if (matchingOperations.length > 1) return 'CREATE_OPERATION_AMBIGUOUS';

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
    return 'RECOVERY_CLASSIFIER_INTERNAL_ERROR';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [versionsPath, operationsPath, taggedVersionPath, tagHistoryPath, runStartedAt, runFinishedAt, deploymentServiceAccountId] = process.argv.slice(2);
  if (!versionsPath || !operationsPath || !taggedVersionPath || !tagHistoryPath || !runStartedAt || !runFinishedAt || !deploymentServiceAccountId) {
    process.stdout.write('RECOVERY_DEPLOY_INPUT_INVALID\n');
    process.exitCode = 2;
  } else {
    let inputs;
    try {
      inputs = await Promise.all([
        readJson(versionsPath),
        readJson(operationsPath),
        readJson(taggedVersionPath),
        readJson(tagHistoryPath),
      ]);
    } catch {
      process.stdout.write('RECOVERY_METADATA_JSON_INVALID\n');
    }
    if (inputs) {
      const [versions, operations, taggedVersion, tagHistory] = inputs;
      const result = classifyRecoveryFunctionDeployOutcome({
        versions,
        operations,
        taggedVersion,
        tagHistory,
        runStartedAt,
        runFinishedAt,
        deploymentServiceAccountId,
      });
      process.stdout.write(`${ENUMS.has(result) ? result : 'DIAGNOSTIC_FAILED'}\n`);
      if (result === 'DIAGNOSTIC_FAILED') process.exitCode = 2;
    }
  }
}
