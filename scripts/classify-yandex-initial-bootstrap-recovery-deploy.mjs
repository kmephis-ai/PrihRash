import { readFile, writeFile } from 'node:fs/promises';
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
  'RECOVERY_UNTAGGED_VERSION_CANDIDATE_PRESENT',
  'RECOVERY_UNTAGGED_VERSION_AMBIGUOUS',
  'RECOVERY_UNTAGGED_VERSION_METADATA_UNPROVEN',
  'RECOVERY_VERSION_LIST_INCOMPLETE',
  'RECOVERY_OPERATION_LIST_INCOMPLETE',
  'AUDIT_TRAIL_METADATA_INVALID',
  'AUDIT_TRAIL_LIST_INCOMPLETE',
  'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED',
  'AUDIT_TRAIL_SOURCE_NOT_ACTIVE',
  'AUDIT_TRAIL_SOURCE_AMBIGUOUS',
  'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT',
  'AUDIT_TRAIL_OBJECT_STORAGE_SOURCE_PRESENT',
  'AUDIT_TRAIL_SOURCE_UNSUPPORTED',
  'AUDIT_TRAIL_SOURCE_CREATED_AFTER_TARGET',
  'AUDIT_TRAIL_CONFIGURATION_CHANGED_AFTER_TARGET',
  'AUDIT_TRAIL_SOURCE_OPEN_FAILED',
  'AUDIT_TRAIL_LIST_READ_FAILED',
  'AUDIT_TRAIL_AUTHENTICATION_REQUIRED',
  'AUDIT_TRAIL_LIST_PERMISSION_DENIED',
  'AUDIT_TRAIL_FOLDER_LIST_READ_FAILED',
  'AUDIT_TRAIL_FOLDER_LIST_PERMISSION_DENIED',
  'AUDIT_TRAIL_FOLDER_LIST_INCOMPLETE',
  'AUDIT_TRAIL_FOLDER_METADATA_INVALID',
  'AUDIT_TRAIL_FOLDER_LIST_RESPONSE_INVALID',
  'AUDIT_TRAIL_FOLDER_LIST_JSON_INVALID',
  'AUDIT_TRAIL_FOLDER_LIST_INPUT_INVALID',
  'AUDIT_TRAIL_FOLDER_ENTRY_INVALID',
  'AUDIT_TRAIL_FOLDER_ID_INVALID',
  'AUDIT_TRAIL_FOLDER_CLOUD_ID_MISSING',
  'AUDIT_TRAIL_FOLDER_CLOUD_ID_MISMATCH',
  'AUDIT_TRAIL_FOLDER_LIST_AMBIGUOUS',
  'AUDIT_TRAIL_FOLDER_STATUS_MISSING',
  'AUDIT_TRAIL_FOLDER_STATUS_UNSUPPORTED',
  'AUDIT_TRAIL_TARGET_FOLDER_NOT_ACTIVE',
  'AUDIT_TRAIL_CLOUD_SCOPE_CONFIG_INVALID',
  'AUDIT_TRAIL_TARGET_FOLDER_NOT_FOUND',
  'AUDIT_TRAIL_SOURCE_NOT_COVERING_TARGET',
  'AUDIT_TRAIL_COVERAGE_UNPROVEN',
  'AUDIT_TRAIL_CLASSIFIER_FAILED',
  'AUDIT_LOG_READ_FAILED',
  'AUDIT_LOG_READ_PERMISSION_DENIED',
  'AUDIT_LOG_LIST_INCOMPLETE',
  'AUDIT_LOG_METADATA_INVALID',
  'AUDIT_EVENT_READ_NOT_ATTEMPTED',
  'AUDIT_LOG_CLASSIFIER_FAILED',
  'AUDIT_CREATE_EVENT_NOT_OBSERVED',
  'AUDIT_CREATE_EVENT_AMBIGUOUS',
  'AUDIT_CREATE_EVENT_WRITER_MISMATCH',
  'AUDIT_CREATE_EVENT_IN_PROGRESS',
  'AUDIT_CREATE_EVENT_CANCELLED',
  'AUDIT_CREATE_EVENT_FAILED',
  'AUDIT_CREATE_EVENT_VERSION_NOT_OBSERVED',
  'AUDIT_CREATE_EVENT_VERSION_METADATA_UNPROVEN',
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

export function classifyAuditTrailListHttpStatus(status) {
  if (status === 401) return 'AUDIT_TRAIL_AUTHENTICATION_REQUIRED';
  if (status === 403) return 'AUDIT_TRAIL_LIST_PERMISSION_DENIED';
  return 'AUDIT_TRAIL_LIST_READ_FAILED';
}

export function classifyAuditTrailFolderListHttpStatus(status) {
  if (status === 401) return 'AUDIT_TRAIL_AUTHENTICATION_REQUIRED';
  if (status === 403) return 'AUDIT_TRAIL_FOLDER_LIST_PERMISSION_DENIED';
  return 'AUDIT_TRAIL_FOLDER_LIST_READ_FAILED';
}

export function classifyRecoveryFunctionDeployOutcome({
  versions,
  operations,
  taggedVersion,
  tagHistory,
  runStartedAt,
  runFinishedAt,
  operationCreatorServiceAccountId,
  runtimeServiceAccountId,
}) {
  try {
    const start = timestamp(runStartedAt);
    const finish = timestamp(runFinishedAt);
    if (
      start === null
      || finish === null
      || finish < start
      || typeof operationCreatorServiceAccountId !== 'string'
      || operationCreatorServiceAccountId.length === 0
      || typeof runtimeServiceAccountId !== 'string'
      || runtimeServiceAccountId.length === 0
      || !Array.isArray(versions)
      || !Array.isArray(operations)
    ) return 'RECOVERY_DEPLOY_INPUT_INVALID';

    const lowerBound = start - 5_000;
    const upperBound = finish + 5_000;
    if (versions.length >= 1_000) return 'RECOVERY_VERSION_LIST_INCOMPLETE';
    if (operations.length >= 1_000) return 'RECOVERY_OPERATION_LIST_INCOMPLETE';
    const matchingOperations = operations.filter((operation) => {
      if (!object(operation)) return false;
      const createdAt = timestamp(operation.created_at ?? operation.createdAt);
      const createdBy = operation.created_by ?? operation.createdBy;
      return createdBy === operationCreatorServiceAccountId
        && createdAt !== null
        && createdAt >= lowerBound
        && createdAt <= upperBound;
    });
    if (matchingOperations.length === 0) {
      const taggedCandidates = [];
      const untaggedVersions = [];
      for (const version of versions) {
        if (!object(version)) return 'RECOVERY_VERSION_ENTRY_INVALID';
        const tags = version.tags === undefined ? [] : version.tags;
        if (!Array.isArray(tags)) return 'RECOVERY_VERSION_TAGS_INVALID';
        if (!tags.includes('r1-initial-bootstrap-recovery')) {
          untaggedVersions.push(version);
          continue;
        }
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
        if (matchingHistory.length === 0) {
          const untaggedCandidates = [];
          const versionStatuses = new Set(['CREATING', 'ACTIVE', 'OBSOLETE', 'DELETING']);
          for (const version of untaggedVersions) {
            const createdAt = timestamp(version.created_at);
            if (createdAt === null) return 'RECOVERY_VERSION_TIMESTAMP_INVALID';
            if (createdAt < lowerBound || createdAt > upperBound) continue;
            if (
              typeof version.runtime !== 'string'
              || typeof version.entrypoint !== 'string'
              || typeof version.service_account_id !== 'string'
              || typeof version.status !== 'string'
              || !versionStatuses.has(version.status)
            ) return 'RECOVERY_UNTAGGED_VERSION_METADATA_UNPROVEN';
            if (
              version.runtime === 'nodejs22'
              && version.entrypoint === 'index.initialBootstrapRecoveryHandler'
              && version.service_account_id === runtimeServiceAccountId
            ) untaggedCandidates.push(version);
          }
          if (untaggedCandidates.length > 1) return 'RECOVERY_UNTAGGED_VERSION_AMBIGUOUS';
          if (untaggedCandidates.length === 1) return 'RECOVERY_UNTAGGED_VERSION_CANDIDATE_PRESENT';
          return 'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW';
        }
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
        || taggedVersion.serviceAccountId !== runtimeServiceAccountId
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
      || taggedVersion.serviceAccountId !== runtimeServiceAccountId
    ) return 'CREATED_VERSION_NOT_PROVEN';

    return 'EXACT_RECOVERY_VERSION_CREATED';
  } catch {
    return 'RECOVERY_CLASSIFIER_INTERNAL_ERROR';
  }
}

function inspectRecoveryAuditTrailSource(response, runFinishedAt) {
  try {
    const targetFinishedAt = timestamp(runFinishedAt);
    if (targetFinishedAt === null) return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
    if (!object(response)) return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
    const trails = response.trails === undefined ? [] : response.trails;
    if (!Array.isArray(trails)) return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
    if (response.nextPageToken !== undefined) {
      if (typeof response.nextPageToken !== 'string') return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
      if (response.nextPageToken.length > 0 || trails.length >= 1_000) {
        return { evidence: 'AUDIT_TRAIL_LIST_INCOMPLETE' };
      }
    } else if (trails.length >= 1_000) {
      return { evidence: 'AUDIT_TRAIL_LIST_INCOMPLETE' };
    }
    if (trails.length === 0) return { evidence: 'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED' };

    const activeTrails = [];
    let trailsCreatedAfterTarget = 0;
    let trailsChangedAfterTarget = 0;
    for (const trail of trails) {
      if (!object(trail) || typeof trail.status !== 'string' || !object(trail.destination)) {
        return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
      }
      const trailCreatedAt = timestamp(trail.createdAt);
      const trailUpdatedAt = timestamp(trail.updatedAt);
      if (trailCreatedAt === null || trailUpdatedAt === null) {
        return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
      }
      if (trailCreatedAt > targetFinishedAt) {
        trailsCreatedAfterTarget += 1;
        continue;
      }
      if (trailUpdatedAt > targetFinishedAt) {
        trailsChangedAfterTarget += 1;
        continue;
      }
      if (trail.status !== 'ACTIVE') continue;

      const destination = trail.destination;
      const destinationKeys = ['cloudLogging', 'objectStorage', 'dataStream', 'eventrouter', 'monium'];
      const selectedDestinations = destinationKeys.filter((key) => destination[key] !== undefined);
      const unknownDestinations = Object.keys(destination).some((key) => !destinationKeys.includes(key));
      if (unknownDestinations || selectedDestinations.length !== 1) {
        return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
      }
      activeTrails.push(destination);
    }
    if (activeTrails.length === 0) {
      return {
        evidence: trailsCreatedAfterTarget === trails.length
          ? 'AUDIT_TRAIL_SOURCE_CREATED_AFTER_TARGET'
          : trailsChangedAfterTarget > 0
            ? 'AUDIT_TRAIL_CONFIGURATION_CHANGED_AFTER_TARGET'
            : 'AUDIT_TRAIL_SOURCE_NOT_ACTIVE',
      };
    }
    if (activeTrails.length > 1) return { evidence: 'AUDIT_TRAIL_SOURCE_AMBIGUOUS' };

    const [destination] = activeTrails;
    if (object(destination.cloudLogging) && typeof destination.cloudLogging.logGroupId === 'string'
      && destination.cloudLogging.logGroupId.length > 0) {
      return { evidence: 'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT', logGroupId: destination.cloudLogging.logGroupId };
    }
    if (object(destination.objectStorage) && typeof destination.objectStorage.bucketId === 'string'
      && destination.objectStorage.bucketId.length > 0) {
      return { evidence: 'AUDIT_TRAIL_OBJECT_STORAGE_SOURCE_PRESENT' };
    }
    return { evidence: 'AUDIT_TRAIL_SOURCE_UNSUPPORTED' };
  } catch {
    return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
  }
}

export function classifyRecoveryAuditTrailSource(response, runFinishedAt) {
  return inspectRecoveryAuditTrailSource(response, runFinishedAt).evidence;
}

function inspectRecoveryAuditTrailCloudCoverage(folderResponse, trailResponses, cloudId, targetFolderId, runFinishedAt) {
  try {
    const targetFinishedAt = timestamp(runFinishedAt);
    if (targetFinishedAt === null || typeof cloudId !== 'string' || cloudId.length === 0
      || typeof targetFolderId !== 'string' || targetFolderId.length === 0
      || !Array.isArray(trailResponses)) {
      return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
    }
    const inventory = inspectAuditTrailCloudFolderInventory(folderResponse, cloudId, targetFolderId);
    if (inventory.evidence !== 'FOLDER_LIST_READY') return { evidence: inventory.evidence };
    const { folderIds } = inventory;
    if (trailResponses.length !== folderIds.length) {
      return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_INCOMPLETE' };
    }

    const coveredTrails = [];
    let coverageUnproven = false;
    let createdAfterTarget = 0;
    let changedAfterTarget = 0;
    let inactive = 0;
    let matchingScopeCount = 0;
    let totalTrails = 0;
    for (let folderIndex = 0; folderIndex < folderIds.length; folderIndex += 1) {
      const response = trailResponses[folderIndex];
      if (!object(response) || !Array.isArray(response.trails)) {
        return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
      }
      if (response.nextPageToken !== undefined
        && (typeof response.nextPageToken !== 'string' || response.nextPageToken.length > 0)) {
        return { evidence: 'AUDIT_TRAIL_LIST_INCOMPLETE' };
      }
      if (response.trails.length >= 1_000) return { evidence: 'AUDIT_TRAIL_LIST_INCOMPLETE' };
      totalTrails += response.trails.length;
      for (const trail of response.trails) {
        if (!object(trail) || trail.folderId !== folderIds[folderIndex] || trail.cloudId !== cloudId
          || typeof trail.status !== 'string') {
          return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
        }
        const managementFilter = trail.filteringPolicy?.managementEventsFilter;
        if (managementFilter === undefined) continue;
        if (!object(managementFilter) || !Array.isArray(managementFilter.resourceScopes)
          || managementFilter.resourceScopes.length === 0) {
          coverageUnproven = true;
          continue;
        }
        let coversTarget = false;
        let hasUnknownScope = false;
        for (const scope of managementFilter.resourceScopes) {
          if (!object(scope) || typeof scope.resourceId !== 'string' || typeof scope.resourceType !== 'string') {
            coverageUnproven = true;
            continue;
          }
          if (scope.resourceType === 'resource-manager.cloud' && scope.resourceId === cloudId) {
            coversTarget = true;
          } else if (scope.resourceType === 'resource-manager.folder' && scope.resourceId === targetFolderId) {
            coversTarget = true;
          } else if (!['resource-manager.cloud', 'resource-manager.folder'].includes(scope.resourceType)) {
            hasUnknownScope = true;
          }
        }
        if (coversTarget) {
          matchingScopeCount += 1;
          const trailCreatedAt = timestamp(trail.createdAt);
          const trailUpdatedAt = timestamp(trail.updatedAt);
          if (trailCreatedAt === null || trailUpdatedAt === null || !object(trail.destination)) {
            return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
          }
          if (trailCreatedAt > targetFinishedAt) {
            createdAfterTarget += 1;
            continue;
          }
          if (trailUpdatedAt > targetFinishedAt) {
            changedAfterTarget += 1;
            continue;
          }
          if (trail.status !== 'ACTIVE') {
            inactive += 1;
            continue;
          }
          coveredTrails.push(trail.destination);
        } else if (hasUnknownScope) {
          coverageUnproven = true;
        }
      }
    }
    if (coverageUnproven) return { evidence: 'AUDIT_TRAIL_COVERAGE_UNPROVEN' };
    if (coveredTrails.length === 0) {
      if (createdAfterTarget > 0 && createdAfterTarget === matchingScopeCount) {
        return { evidence: 'AUDIT_TRAIL_SOURCE_CREATED_AFTER_TARGET' };
      }
      if (changedAfterTarget > 0) return { evidence: 'AUDIT_TRAIL_CONFIGURATION_CHANGED_AFTER_TARGET' };
      if (inactive > 0) return { evidence: 'AUDIT_TRAIL_SOURCE_NOT_ACTIVE' };
      return { evidence: totalTrails === 0
        ? 'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED'
        : 'AUDIT_TRAIL_SOURCE_NOT_COVERING_TARGET' };
    }
    if (coveredTrails.length > 1) return { evidence: 'AUDIT_TRAIL_SOURCE_AMBIGUOUS' };
    const [destination] = coveredTrails;
    const destinationKeys = ['cloudLogging', 'objectStorage', 'dataStream', 'eventrouter', 'monium'];
    const selectedDestinations = destinationKeys.filter((key) => destination[key] !== undefined);
    const unknownDestinations = Object.keys(destination).some((key) => !destinationKeys.includes(key));
    if (unknownDestinations || selectedDestinations.length !== 1) {
      return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
    }
    if (object(destination.cloudLogging) && typeof destination.cloudLogging.logGroupId === 'string'
      && destination.cloudLogging.logGroupId.length > 0) {
      return { evidence: 'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT', logGroupId: destination.cloudLogging.logGroupId };
    }
    if (object(destination.objectStorage) && typeof destination.objectStorage.bucketId === 'string'
      && destination.objectStorage.bucketId.length > 0) {
      return { evidence: 'AUDIT_TRAIL_OBJECT_STORAGE_SOURCE_PRESENT' };
    }
    return { evidence: 'AUDIT_TRAIL_SOURCE_UNSUPPORTED' };
  } catch {
    return { evidence: 'AUDIT_TRAIL_METADATA_INVALID' };
  }
}

function inspectAuditTrailCloudFolderInventory(response, cloudId, targetFolderId) {
  if (typeof cloudId !== 'string' || cloudId.length === 0) {
    return { evidence: 'AUDIT_TRAIL_CLOUD_SCOPE_CONFIG_INVALID' };
  }
  if (typeof targetFolderId !== 'string' || targetFolderId.length === 0) {
    return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_INPUT_INVALID' };
  }
  if (!object(response) || !Array.isArray(response.folders)) {
    return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_RESPONSE_INVALID' };
  }
  const folders = response.folders;
  if (response.nextPageToken !== undefined && typeof response.nextPageToken !== 'string') {
    return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_RESPONSE_INVALID' };
  }
  if (typeof response.nextPageToken === 'string' && response.nextPageToken.length > 0) {
    return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_INCOMPLETE' };
  }
  if (folders.length >= 1_000 || folders.length > 100) {
    return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_INCOMPLETE' };
  }
  const folderIds = [];
  const foldersById = new Map();
  for (const folder of folders) {
    if (!object(folder)) return { evidence: 'AUDIT_TRAIL_FOLDER_ENTRY_INVALID' };
    if (typeof folder.id !== 'string' || folder.id.length === 0) {
      return { evidence: 'AUDIT_TRAIL_FOLDER_ID_INVALID' };
    }
    if (typeof folder.cloudId !== 'string' || folder.cloudId.length === 0) {
      return { evidence: 'AUDIT_TRAIL_FOLDER_CLOUD_ID_MISSING' };
    }
    if (folder.cloudId !== cloudId) return { evidence: 'AUDIT_TRAIL_FOLDER_CLOUD_ID_MISMATCH' };
    if (foldersById.has(folder.id)) return { evidence: 'AUDIT_TRAIL_FOLDER_LIST_AMBIGUOUS' };
    if (folder.status === undefined) {
      return { evidence: 'AUDIT_TRAIL_FOLDER_STATUS_MISSING' };
    }
    if (typeof folder.status !== 'string' || folder.status.length === 0) {
      return { evidence: 'AUDIT_TRAIL_FOLDER_STATUS_UNSUPPORTED' };
    }
    if (!['ACTIVE', 'PENDING_DELETION', 'DELETING'].includes(folder.status)) {
      return { evidence: 'AUDIT_TRAIL_FOLDER_STATUS_UNSUPPORTED' };
    }
    folderIds.push(folder.id);
    foldersById.set(folder.id, folder);
  }
  if (!foldersById.has(targetFolderId)) {
    return { evidence: 'AUDIT_TRAIL_TARGET_FOLDER_NOT_FOUND' };
  }
  if (foldersById.get(targetFolderId).status !== 'ACTIVE') {
    return { evidence: 'AUDIT_TRAIL_TARGET_FOLDER_NOT_ACTIVE' };
  }
  return { evidence: 'FOLDER_LIST_READY', folderIds };
}

export function classifyAuditTrailCloudFolderList(response, cloudId, targetFolderId) {
  return inspectAuditTrailCloudFolderInventory(response, cloudId, targetFolderId).evidence;
}

export function classifyRecoveryAuditTrailCloudCoverage(folderResponse, trailResponses, cloudId, targetFolderId, runFinishedAt) {
  return inspectRecoveryAuditTrailCloudCoverage(folderResponse, trailResponses, cloudId, targetFolderId, runFinishedAt).evidence;
}

export function classifyRecoveryAuditCreateEvents({
  entries,
  functionId,
  operationCreatorServiceAccountId,
  runtimeServiceAccountId,
  versions,
  runStartedAt,
  runFinishedAt,
}) {
  try {
    const start = timestamp(runStartedAt);
    const finish = timestamp(runFinishedAt);
    if (
      !Array.isArray(entries)
      || !Array.isArray(versions)
      || typeof functionId !== 'string'
      || functionId.length === 0
      || typeof operationCreatorServiceAccountId !== 'string'
      || operationCreatorServiceAccountId.length === 0
      || typeof runtimeServiceAccountId !== 'string'
      || runtimeServiceAccountId.length === 0
      || start === null
      || finish === null
      || finish < start
    ) return 'AUDIT_LOG_METADATA_INVALID';
    if (entries.length >= 1_000) return 'AUDIT_LOG_LIST_INCOMPLETE';

    const lowerBound = start - 5_000;
    const upperBound = finish + 5_000;
    const matchingEvents = [];
    for (const entry of entries) {
      if (!object(entry) || !object(entry.json_payload)) return 'AUDIT_LOG_METADATA_INVALID';
      const event = entry.json_payload;
      if (event.eventType !== 'yandex.cloud.audit.serverless.functions.CreateFunctionVersion') continue;
      const eventTime = timestamp(event.eventTime);
      if (eventTime === null || !object(event.details) || !object(event.authentication)) {
        return 'AUDIT_LOG_METADATA_INVALID';
      }
      if (event.details.functionId !== functionId) continue;
      if (eventTime < lowerBound || eventTime > upperBound) continue;
      if (event.authentication.subjectId !== operationCreatorServiceAccountId) {
        return 'AUDIT_CREATE_EVENT_WRITER_MISMATCH';
      }
      if (typeof event.eventId !== 'string' || event.eventId.length === 0
        || typeof event.eventStatus !== 'string') return 'AUDIT_LOG_METADATA_INVALID';
      matchingEvents.push({ event, eventTime });
    }
    if (matchingEvents.length === 0) return 'AUDIT_CREATE_EVENT_NOT_OBSERVED';

    const eventIds = new Set(matchingEvents.map(({ event }) => event.eventId));
    if (eventIds.size > 1) return 'AUDIT_CREATE_EVENT_AMBIGUOUS';
    matchingEvents.sort((left, right) => left.eventTime - right.eventTime);
    const latest = matchingEvents.at(-1);
    const sameTimeEvents = matchingEvents.filter(({ eventTime }) => eventTime === latest.eventTime);
    if (new Set(sameTimeEvents.map(({ event }) => event.eventStatus)).size > 1) {
      return 'AUDIT_CREATE_EVENT_AMBIGUOUS';
    }
    const { event } = latest;
    if (event.eventStatus === 'ERROR') return 'AUDIT_CREATE_EVENT_FAILED';
    if (event.eventStatus === 'CANCELLED') return 'AUDIT_CREATE_EVENT_CANCELLED';
    if (event.eventStatus === 'STARTED' || event.eventStatus === 'RUNNING') {
      return 'AUDIT_CREATE_EVENT_IN_PROGRESS';
    }
    if (event.eventStatus !== 'DONE') return 'AUDIT_LOG_METADATA_INVALID';

    const details = event.details;
    if (
      typeof details.functionVersionId !== 'string'
      || details.functionVersionId.length === 0
      || details.runtime !== 'nodejs22'
      || details.functionVersionEntrypoint !== 'index.initialBootstrapRecoveryHandler'
      || details.serviceAccountId !== runtimeServiceAccountId
      || !Array.isArray(details.functionVersionTags)
      || !details.functionVersionTags.includes('r1-initial-bootstrap-recovery')
    ) return 'AUDIT_CREATE_EVENT_VERSION_METADATA_UNPROVEN';

    const matchingVersions = versions.filter((version) => object(version) && version.id === details.functionVersionId);
    if (matchingVersions.length === 0) return 'AUDIT_CREATE_EVENT_VERSION_NOT_OBSERVED';
    if (matchingVersions.length > 1) return 'AUDIT_CREATE_EVENT_AMBIGUOUS';
    const [version] = matchingVersions;
    const versionCreatedAt = timestamp(version.created_at);
    if (
      versionCreatedAt === null
      || versionCreatedAt < lowerBound
      || versionCreatedAt > upperBound
      || version.runtime !== 'nodejs22'
      || version.entrypoint !== 'index.initialBootstrapRecoveryHandler'
      || version.service_account_id !== runtimeServiceAccountId
      || !['CREATING', 'ACTIVE', 'OBSOLETE', 'DELETING'].includes(version.status)
    ) return 'AUDIT_CREATE_EVENT_VERSION_METADATA_UNPROVEN';
    return 'EXACT_RECOVERY_VERSION_CREATED';
  } catch {
    return 'AUDIT_LOG_METADATA_INVALID';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cliArgs = process.argv.slice(2);
  if (cliArgs[0] === '--audit-folder-list-http-status') {
    const [rawStatus] = cliArgs.slice(1);
    const status = typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : null;
    process.stdout.write(`${classifyAuditTrailFolderListHttpStatus(status)}\n`);
  } else if (cliArgs[0] === '--audit-cloud-folder-ids') {
    const [folderListPath, cloudId, targetFolderId, folderIdsPath] = cliArgs.slice(1);
    if (!folderListPath || !cloudId || !targetFolderId || !folderIdsPath) {
      process.stdout.write('AUDIT_TRAIL_FOLDER_LIST_INPUT_INVALID\n');
      process.exitCode = 2;
    } else {
      try {
        const response = await readJson(folderListPath);
        const inventory = inspectAuditTrailCloudFolderInventory(response, cloudId, targetFolderId);
        if (inventory.evidence !== 'FOLDER_LIST_READY') {
          process.stdout.write(`${ENUMS.has(inventory.evidence) ? inventory.evidence : 'AUDIT_TRAIL_CLASSIFIER_FAILED'}\n`);
        } else {
          await writeFile(folderIdsPath, `${JSON.stringify(inventory.folderIds)}\n`, 'utf8');
          process.stdout.write('FOLDER_LIST_READY\n');
        }
      } catch {
        process.stdout.write('AUDIT_TRAIL_FOLDER_LIST_JSON_INVALID\n');
      }
    }
  } else if (cliArgs[0] === '--audit-cloud-trails') {
    const [folderListPath, cloudId, targetFolderId, runFinishedAt, locatorPath, ...trailPaths] = cliArgs.slice(1);
    if (!folderListPath || !cloudId || !targetFolderId || !runFinishedAt || !locatorPath) {
      process.stdout.write('AUDIT_TRAIL_METADATA_INVALID\n');
      process.exitCode = 2;
    } else {
      try {
        const [folderResponse, trailResponses] = await Promise.all([
          readJson(folderListPath),
          Promise.all(trailPaths.map((trailPath) => readJson(trailPath))),
        ]);
        const result = inspectRecoveryAuditTrailCloudCoverage(
          folderResponse, trailResponses, cloudId, targetFolderId, runFinishedAt,
        );
        if (result.logGroupId) await writeFile(locatorPath, result.logGroupId, 'utf8');
        process.stdout.write(`${ENUMS.has(result.evidence) ? result.evidence : 'AUDIT_TRAIL_CLASSIFIER_FAILED'}\n`);
      } catch {
        process.stdout.write('AUDIT_TRAIL_METADATA_INVALID\n');
      }
    }
  } else if (cliArgs[0] === '--audit-trail-http-status') {
    const [rawStatus] = cliArgs.slice(1);
    const status = typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : null;
    process.stdout.write(`${classifyAuditTrailListHttpStatus(status)}\n`);
  } else if (cliArgs[0] === '--audit-trails') {
    const [auditTrailPath, locatorPath, runFinishedAt] = cliArgs.slice(1);
    if (!auditTrailPath || !locatorPath || !runFinishedAt) {
      process.stdout.write('AUDIT_TRAIL_METADATA_INVALID\n');
      process.exitCode = 2;
    } else {
      try {
        const response = await readJson(auditTrailPath);
        const result = inspectRecoveryAuditTrailSource(response, runFinishedAt);
        if (result.logGroupId) await writeFile(locatorPath, result.logGroupId, 'utf8');
        process.stdout.write(`${ENUMS.has(result.evidence) ? result.evidence : 'AUDIT_TRAIL_CLASSIFIER_FAILED'}\n`);
      } catch {
        process.stdout.write('AUDIT_TRAIL_METADATA_INVALID\n');
      }
    }
  } else if (cliArgs[0] === '--audit-events') {
    const [auditEventsPath, versionsPath, functionId, operationCreatorServiceAccountId,
      runtimeServiceAccountId, runStartedAt, runFinishedAt] = cliArgs.slice(1);
    if (!auditEventsPath || !versionsPath || !functionId || !operationCreatorServiceAccountId
      || !runtimeServiceAccountId || !runStartedAt || !runFinishedAt) {
      process.stdout.write('AUDIT_LOG_METADATA_INVALID\n');
      process.exitCode = 2;
    } else {
      try {
        const [entries, versions] = await Promise.all([readJson(auditEventsPath), readJson(versionsPath)]);
        const result = classifyRecoveryAuditCreateEvents({
          entries,
          versions,
          functionId,
          operationCreatorServiceAccountId,
          runtimeServiceAccountId,
          runStartedAt,
          runFinishedAt,
        });
        process.stdout.write(`${ENUMS.has(result) ? result : 'AUDIT_LOG_CLASSIFIER_FAILED'}\n`);
      } catch {
        process.stdout.write('AUDIT_LOG_METADATA_INVALID\n');
      }
    }
  } else {
    const [versionsPath, operationsPath, taggedVersionPath, tagHistoryPath, runStartedAt, runFinishedAt, operationCreatorServiceAccountId, runtimeServiceAccountId] = cliArgs;
    if (!versionsPath || !operationsPath || !taggedVersionPath || !tagHistoryPath || !runStartedAt || !runFinishedAt || !operationCreatorServiceAccountId || !runtimeServiceAccountId) {
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
        operationCreatorServiceAccountId,
        runtimeServiceAccountId,
      });
      process.stdout.write(`${ENUMS.has(result) ? result : 'DIAGNOSTIC_FAILED'}\n`);
      if (result === 'DIAGNOSTIC_FAILED') process.exitCode = 2;
    }
    }
  }
}
