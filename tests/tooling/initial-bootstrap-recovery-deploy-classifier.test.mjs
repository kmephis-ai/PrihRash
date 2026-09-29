import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  classifyRecoveryAuditCreateEvents,
  classifyAuditTrailSourceDecision,
  classifyAuditTrailCloudFolderList,
  classifyAuditTrailListHttpStatus,
  classifyAuditTrailFolderListHttpStatus,
  classifyRecoveryAuditTrailCloudCoverage,
  classifyRecoveryAuditTrailSource,
  classifyRecoveryFunctionDeployOutcome,
} from '../../scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs';

const runStartedAt = '2026-09-27T18:46:30Z';
const runFinishedAt = '2026-09-27T18:46:38Z';
const serviceAccount = 'synthetic-deployer';
const runtimeServiceAccount = 'synthetic-runtime';

test('Audit Trails list authentication and authorization failures remain distinct safe enums', () => {
  assert.equal(classifyAuditTrailListHttpStatus(401), 'AUDIT_TRAIL_AUTHENTICATION_REQUIRED');
  assert.equal(classifyAuditTrailListHttpStatus(403), 'AUDIT_TRAIL_LIST_PERMISSION_DENIED');
  assert.equal(classifyAuditTrailListHttpStatus(404), 'AUDIT_TRAIL_LIST_READ_FAILED');
  assert.equal(classifyAuditTrailListHttpStatus(null), 'AUDIT_TRAIL_LIST_READ_FAILED');
});

test('cloud folder enumeration failures stay bounded and distinguish permission from other failures', () => {
  assert.equal(classifyAuditTrailFolderListHttpStatus(401), 'AUDIT_TRAIL_AUTHENTICATION_REQUIRED');
  assert.equal(classifyAuditTrailFolderListHttpStatus(403), 'AUDIT_TRAIL_FOLDER_LIST_PERMISSION_DENIED');
  assert.equal(classifyAuditTrailFolderListHttpStatus(500), 'AUDIT_TRAIL_FOLDER_LIST_READ_FAILED');
  assert.equal(classifyAuditTrailCloudFolderList(null, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_LIST_RESPONSE_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({ folders: null }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_LIST_RESPONSE_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({}, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_TARGET_FOLDER_NOT_FOUND');
  assert.equal(classifyAuditTrailCloudFolderList({ folders: [] }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_TARGET_FOLDER_NOT_FOUND');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' }],
  }, '', 'synthetic-target'), 'AUDIT_TRAIL_CLOUD_SCOPE_CONFIG_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({ folders: [] }, 'synthetic-cloud', ''), 'AUDIT_TRAIL_FOLDER_LIST_INPUT_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' }],
    nextPageToken: 'synthetic-next-page',
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_LIST_INCOMPLETE');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' }],
    nextPageToken: 1,
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_LIST_RESPONSE_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [null],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_ENTRY_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: '', cloudId: 'synthetic-cloud', status: 'ACTIVE' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_ID_INVALID');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', status: 'ACTIVE' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_CLOUD_ID_MISSING');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [
      { id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' },
      { id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' },
    ],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_LIST_AMBIGUOUS');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: Array.from({ length: 101 }, (_, index) => ({
      id: index === 0 ? 'synthetic-target' : `synthetic-folder-${index}`,
      cloudId: 'synthetic-cloud',
      status: 'ACTIVE',
    })),
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_LIST_INCOMPLETE');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'different-cloud', status: 'ACTIVE' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_CLOUD_ID_MISMATCH');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'UNRECOGNIZED' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_STATUS_UNSUPPORTED');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_STATUS_MISSING');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 1 }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_STATUS_UNSUPPORTED');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'PENDING_DELETION' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_TARGET_FOLDER_NOT_ACTIVE');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [
      { id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' },
      { id: 'synthetic-pending', cloudId: 'synthetic-cloud', status: 'PENDING_DELETION' },
      { id: 'synthetic-deleting', cloudId: 'synthetic-cloud', status: 'DELETING' },
    ],
  }, 'synthetic-cloud', 'synthetic-target'), 'FOLDER_LIST_READY');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage({ folders: [
    { id: 'synthetic-target', cloudId: 'synthetic-cloud', status: 'ACTIVE' },
    { id: 'synthetic-pending', cloudId: 'synthetic-cloud', status: 'PENDING_DELETION' },
    { id: 'synthetic-deleting', cloudId: 'synthetic-cloud', status: 'DELETING' },
  ] }, [{ trails: [] }, { trails: [] }, { trails: [] }],
  'synthetic-cloud', 'synthetic-target', runFinishedAt), 'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED');
  assert.equal(classifyAuditTrailCloudFolderList({
    folders: [{ cloudId: 'synthetic-cloud', status: 'ACTIVE' }],
  }, 'synthetic-cloud', 'synthetic-target'), 'AUDIT_TRAIL_FOLDER_ID_INVALID');
});

test('cloud-scope trail discovery reads only complete per-folder lists and proves exact target-folder management-event coverage', () => {
  const cloudId = 'synthetic-cloud';
  const targetFolderId = 'synthetic-target-folder';
  const otherFolderId = 'synthetic-other-folder';
  const folders = { folders: [
    { id: targetFolderId, cloudId, status: 'ACTIVE' },
    { id: otherFolderId, cloudId, status: 'ACTIVE' },
  ] };
  const baseTrail = {
    folderId: otherFolderId,
    cloudId,
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    filteringPolicy: { managementEventsFilter: { resourceScopes: [
      { resourceId: cloudId, resourceType: 'resource-manager.cloud' },
    ] } },
    destination: { cloudLogging: { logGroupId: 'synthetic-group' } },
  };

  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [baseTrail] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [{ ...baseTrail, folderId: targetFolderId, filteringPolicy: { managementEventsFilter: {
      resourceScopes: [{ resourceId: targetFolderId, resourceType: 'resource-manager.folder' }],
    } } }] },
    { trails: [] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [{ ...baseTrail, filteringPolicy: { managementEventsFilter: {
      resourceScopes: [{ resourceId: otherFolderId, resourceType: 'resource-manager.folder' }],
    } } }] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_SOURCE_NOT_COVERING_TARGET');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [{ ...baseTrail, filteringPolicy: { managementEventsFilter: {
      resourceScopes: [{ resourceId: 'synthetic-scope', resourceType: 'unknown.scope' }],
    } } }] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_COVERAGE_UNPROVEN');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [{ ...baseTrail, filteringPolicy: { managementEventsFilter: { resourceScopes: [] } } }] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_COVERAGE_UNPROVEN');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [{ ...baseTrail, updatedAt: '2026-09-28T00:00:00Z' }] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_CONFIGURATION_CHANGED_AFTER_TARGET');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [baseTrail, { ...baseTrail, folderId: otherFolderId }] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_SOURCE_AMBIGUOUS');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [] },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] },
    { trails: [baseTrail], nextPageToken: 'synthetic-next-page' },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_LIST_INCOMPLETE');
});

test('cloud trail response validation reports field-specific safe enums', () => {
  const cloudId = 'synthetic-cloud';
  const targetFolderId = 'synthetic-target-folder';
  const ownerFolderId = 'synthetic-owner-folder';
  const folders = { folders: [
    { id: targetFolderId, cloudId, status: 'ACTIVE' },
    { id: ownerFolderId, cloudId, status: 'ACTIVE' },
  ] };
  const trail = {
    folderId: ownerFolderId,
    cloudId,
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    filteringPolicy: { managementEventsFilter: { resourceScopes: [
      { resourceId: cloudId, resourceType: 'resource-manager.cloud' },
    ] } },
    destination: { cloudLogging: { logGroupId: 'synthetic-group' } },
  };
  const classify = (trailValue = trail, ownerList = { trails: [trailValue] }, targetList = { trails: [] }) => (
    classifyRecoveryAuditTrailCloudCoverage(folders, [targetList, ownerList], cloudId, targetFolderId, runFinishedAt)
  );

  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, null, cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_CLOUD_COVERAGE_INPUT_INVALID');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{ trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_TRAIL_LIST_COUNT_MISMATCH');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, ['malformed-response', { trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_TRAIL_LIST_ROOT_INVALID');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{ trails: null }, { trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_TRAIL_LIST_RESPONSE_INVALID');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{}, { trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] }, { trails: [], nextPageToken: 1 },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_TRAIL_PAGE_TOKEN_INVALID');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [
    { trails: [] }, { trails: [], nextPageToken: 'synthetic-next-page' },
  ], cloudId, targetFolderId, runFinishedAt), 'AUDIT_TRAIL_LIST_INCOMPLETE');
  assert.equal(classify(null), 'AUDIT_TRAIL_TRAIL_ENTRY_INVALID');
  assert.equal(classify({ ...trail, folderId: undefined }), 'AUDIT_TRAIL_TRAIL_FOLDER_ID_MISSING');
  assert.equal(classify({ ...trail, folderId: 'synthetic-other-folder' }), 'AUDIT_TRAIL_TRAIL_FOLDER_MISMATCH');
  assert.equal(classify({ ...trail, cloudId: undefined }), 'AUDIT_TRAIL_TRAIL_CLOUD_ID_MISSING');
  assert.equal(classify({ ...trail, cloudId: 'synthetic-other-cloud' }), 'AUDIT_TRAIL_TRAIL_CLOUD_ID_MISMATCH');
  assert.equal(classify({ ...trail, status: undefined }), 'AUDIT_TRAIL_TRAIL_STATUS_MISSING');
  assert.equal(classify({ ...trail, status: 'UNKNOWN' }), 'AUDIT_TRAIL_TRAIL_STATUS_UNSUPPORTED');
  assert.equal(classify({ ...trail, createdAt: 'invalid-time' }), 'AUDIT_TRAIL_TRAIL_TIMESTAMPS_INVALID');
  assert.equal(classify({ ...trail, destination: null }), 'AUDIT_TRAIL_TRAIL_DESTINATION_INVALID');
  assert.equal(classify({ ...trail, destination: { unknownDestination: {} } }), 'AUDIT_TRAIL_TRAIL_DESTINATION_UNPROVEN');
});

test('cloud trail metadata validation splits exact list, owner, status, timestamp, and destination failures', () => {
  const cloudId = 'synthetic-cloud';
  const targetFolderId = 'synthetic-target-folder';
  const ownerFolderId = 'synthetic-owner-folder';
  const folders = { folders: [
    { id: targetFolderId, cloudId, status: 'ACTIVE' },
    { id: ownerFolderId, cloudId, status: 'ACTIVE' },
  ] };
  const trail = {
    folderId: ownerFolderId,
    cloudId,
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    filteringPolicy: { managementEventsFilter: { resourceScopes: [
      { resourceId: cloudId, resourceType: 'resource-manager.cloud' },
    ] } },
    destination: { cloudLogging: { logGroupId: 'synthetic-group' } },
  };
  const classify = (trailValue = trail, ownerList = { trails: [trailValue] }, targetList = { trails: [] }) => (
    classifyRecoveryAuditTrailCloudCoverage(folders, [targetList, ownerList], cloudId, targetFolderId, runFinishedAt)
  );

  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{ trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_TRAIL_LIST_COUNT_MISMATCH');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{ trails: null }, { trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_TRAIL_LIST_RESPONSE_INVALID');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{}, { trails: [] }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED');
  assert.equal(classifyRecoveryAuditTrailCloudCoverage(folders, [{ trails: [] }, { trails: [], nextPageToken: 1 }], cloudId, targetFolderId, runFinishedAt),
    'AUDIT_TRAIL_TRAIL_PAGE_TOKEN_INVALID');
  assert.equal(classify(null), 'AUDIT_TRAIL_TRAIL_ENTRY_INVALID');
  assert.equal(classify({ ...trail, folderId: undefined }), 'AUDIT_TRAIL_TRAIL_FOLDER_ID_MISSING');
  assert.equal(classify({ ...trail, folderId: 'synthetic-wrong-owner' }), 'AUDIT_TRAIL_TRAIL_FOLDER_MISMATCH');
  assert.equal(classify({ ...trail, cloudId: undefined }), 'AUDIT_TRAIL_TRAIL_CLOUD_ID_MISSING');
  assert.equal(classify({ ...trail, cloudId: 'synthetic-other-cloud' }), 'AUDIT_TRAIL_TRAIL_CLOUD_ID_MISMATCH');
  assert.equal(classify({ ...trail, status: undefined }), 'AUDIT_TRAIL_TRAIL_STATUS_MISSING');
  assert.equal(classify({ ...trail, status: 'UNKNOWN_STATUS' }), 'AUDIT_TRAIL_TRAIL_STATUS_UNSUPPORTED');
  assert.equal(classify({ ...trail, createdAt: 'not-a-timestamp' }), 'AUDIT_TRAIL_TRAIL_TIMESTAMPS_INVALID');
  assert.equal(classify({ ...trail, destination: null }), 'AUDIT_TRAIL_TRAIL_DESTINATION_INVALID');
  assert.equal(classify({ ...trail, destination: { cloudLogging: {}, objectStorage: {} } }),
    'AUDIT_TRAIL_TRAIL_DESTINATION_UNPROVEN');
  assert.equal(classify({ ...trail, filter: {} }), 'AUDIT_TRAIL_COVERAGE_UNPROVEN');
  assert.equal(classify({ ...trail, filteringPolicy: undefined }), 'AUDIT_TRAIL_COVERAGE_UNPROVEN');
  assert.equal(classify({ ...trail, filteringPolicy: { managementEventsFilter: {
    resourceScopes: [{ resourceId: cloudId, resourceType: 'resource-manager.cloud' }],
    includeRules: [{ conditions: [{ field: 'synthetic', operator: 'IN', values: ['value'] }] }],
  } } }), 'AUDIT_TRAIL_COVERAGE_UNPROVEN');
  assert.equal(classify({ ...trail, filteringPolicy: { managementEventsFilter: {
    resourceScopes: [{ resourceId: cloudId, resourceType: 'resource-manager.cloud' }],
    unknownRule: true,
  } } }), 'AUDIT_TRAIL_COVERAGE_UNPROVEN');
});

test('Audit Trails source branch reaches a terminal decision instead of another discriminator cycle', () => {
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT', 'EXACT_RECOVERY_VERSION_CREATED',
  ), 'EXISTING_APPLICABLE_AUDIT_SOURCE');
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT', 'AUDIT_CREATE_EVENT_FAILED',
  ), 'EXISTING_APPLICABLE_AUDIT_SOURCE');
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED', 'AUDIT_EVENT_READ_NOT_ATTEMPTED',
  ), 'NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE');
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_SOURCE_NOT_COVERING_TARGET', 'AUDIT_EVENT_READ_NOT_ATTEMPTED',
  ), 'NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE');
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_SOURCE_AMBIGUOUS', 'AUDIT_EVENT_READ_NOT_ATTEMPTED',
  ), 'SOURCE_EVIDENCE_AMBIGUOUS');
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_OBJECT_STORAGE_SOURCE_PRESENT', 'AUDIT_EVENT_READ_NOT_ATTEMPTED',
  ), 'SOURCE_EVIDENCE_UNUSABLE');
  assert.equal(classifyAuditTrailSourceDecision(
    'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT', 'AUDIT_CREATE_EVENT_NOT_OBSERVED',
  ), 'SOURCE_EVIDENCE_UNUSABLE');
});

function exactEvidence(overrides = {}) {
  const version = {
    id: 'synthetic-version',
    tags: ['r1-initial-bootstrap-recovery'],
    created_at: '2026-09-27T18:46:34Z',
  };
  const operation = {
    created_by: serviceAccount,
    created_at: '2026-09-27T18:46:33Z',
    done: true,
    response: { id: 'synthetic-version' },
  };
  const taggedVersion = {
    id: 'synthetic-version',
    status: 'ACTIVE',
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapRecoveryHandler',
    serviceAccountId: runtimeServiceAccount,
  };
  return {
    versions: [version],
    operations: [operation],
    taggedVersion,
    tagHistory: { functionTagHistoryRecord: [] },
    runStartedAt,
    runFinishedAt,
    operationCreatorServiceAccountId: serviceAccount,
    runtimeServiceAccountId: runtimeServiceAccount,
    ...overrides,
  };
}

test('recovery deploy classifier proves only a unique exact version correlated to the failed create operation', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence()),
    'EXACT_RECOVERY_VERSION_CREATED',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      taggedVersion: { ...exactEvidence().taggedVersion, serviceAccountId: 'other' },
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      versions: [{ ...exactEvidence().versions[0], created_at: '2026-09-27T18:40:00Z' }],
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      taggedVersion: { ...exactEvidence().taggedVersion, id: 'other-version' },
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
  assert.notEqual(serviceAccount, runtimeServiceAccount);
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      taggedVersion: { ...exactEvidence().taggedVersion, serviceAccountId: serviceAccount },
    })),
    'CREATED_VERSION_NOT_PROVEN',
  );
});

test('recovery deploy classifier distinguishes missing, ambiguous, pending, and failed operations', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ id: 'older-version', tags: ['r1-initial-bootstrap-recovery'], created_at: '2026-09-27T18:40:00Z' }],
      taggedVersion: { id: 'older-version' },
    })),
    'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [...exactEvidence().operations, { ...exactEvidence().operations[0] }],
    })),
    'CREATE_OPERATION_AMBIGUOUS',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [{ ...exactEvidence().operations[0], done: false }],
    })),
    'CREATE_OPERATION_IN_PROGRESS',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [{ ...exactEvidence().operations[0], error: { code: 3 } }],
    })),
    'CREATE_OPERATION_FAILED',
  );
});

test('recovery deploy classifier uses bounded version/tag evidence when no operation matches without declaring APPLIED or NOT_APPLIED', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ operations: [] })),
    'RECOVERY_TAGGED_VERSION_CANDIDATE_PRESENT',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ id: 'older-version', tags: ['r1-initial-bootstrap-recovery'], created_at: '2026-09-27T18:40:00Z' }],
      taggedVersion: { id: 'older-version' },
    })),
    'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [
        ...exactEvidence().versions,
        { ...exactEvidence().versions[0], id: 'second-version' },
      ],
    })),
    'RECOVERY_TAGGED_VERSION_AMBIGUOUS',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      taggedVersion: { ...exactEvidence().taggedVersion, id: 'different-version' },
    })),
    'RECOVERY_TAGGED_VERSION_METADATA_UNPROVEN',
  );
});

test('recovery deploy classifier accepts only the already-proven snake_case and camelCase Yandex operation metadata fields', () => {
  const operation = exactEvidence().operations[0];
  const camelCaseOperation = {
    createdBy: operation.created_by,
    createdAt: operation.created_at,
    done: operation.done,
    response: operation.response,
  };
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ operations: [camelCaseOperation] })),
    'EXACT_RECOVERY_VERSION_CREATED',
  );
});

test('recovery deploy classifier fails closed on malformed provider metadata and timestamps', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ runStartedAt: 'private timestamp' })),
    'RECOVERY_DEPLOY_INPUT_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ operations: null })),
    'RECOVERY_DEPLOY_INPUT_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ operationCreatorServiceAccountId: '' })),
    'RECOVERY_DEPLOY_INPUT_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ runtimeServiceAccountId: '' })),
    'RECOVERY_DEPLOY_INPUT_INVALID',
  );
});

test('recovery deploy classifier distinguishes malformed version entry, tags, and timestamp without echo', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{
        id: 'synthetic-recovery-version',
        tags: ['r1-initial-bootstrap-recovery'],
      }],
    })),
    'RECOVERY_VERSION_TIMESTAMP_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [null],
    })),
    'RECOVERY_VERSION_ENTRY_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({ versions: { items: [] } })),
    'RECOVERY_DEPLOY_INPUT_INVALID',
  );
});

test('recovery deploy classifier treats omitted repeated tags as empty and keeps window proof strict', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ id: 'synthetic-untagged-version' }],
    })),
    'RECOVERY_VERSION_TIMESTAMP_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ id: 'synthetic-untagged-version', tags: [], created_at: '2026-09-27T18:40:00Z' }],
    })),
    'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ id: 'synthetic-version', tags: null }],
    })),
    'RECOVERY_VERSION_TAGS_INVALID',
  );
});

test('recovery deploy classifier uses bounded exact-window tag history without inferring deployment outcome', () => {
  const historicalCandidate = {
    functionVersionId: 'synthetic-version',
    tag: 'r1-initial-bootstrap-recovery',
    effectiveFrom: '2026-09-27T18:46:34Z',
  };
  const versions = [{
    id: 'synthetic-version',
    created_at: '2026-09-27T18:46:34Z',
    runtime: 'nodejs20',
    entrypoint: 'index.legacyHandler',
    service_account_id: 'synthetic-old-runtime',
    status: 'ACTIVE',
  }];

  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions,
      tagHistory: { functionTagHistoryRecord: [historicalCandidate] },
    })),
    'RECOVERY_TAG_HISTORY_VERSION_CANDIDATE_PRESENT',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions,
      tagHistory: {},
    })),
    'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions,
      tagHistory: { functionTagHistoryRecord: [
        historicalCandidate,
        { ...historicalCandidate, effectiveFrom: '2026-09-27T18:46:35Z' },
      ] },
    })),
    'RECOVERY_TAG_HISTORY_AMBIGUOUS',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions,
      tagHistory: { functionTagHistoryRecord: [historicalCandidate], nextPageToken: 'synthetic-more' },
    })),
    'RECOVERY_TAG_HISTORY_INCOMPLETE',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions,
      tagHistory: { functionTagHistoryRecord: [{ ...historicalCandidate, effectiveFrom: 'invalid' }] },
    })),
    'RECOVERY_TAG_HISTORY_METADATA_INVALID',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions,
      tagHistory: { functionTagHistoryRecord: null },
    })),
    'RECOVERY_TAG_HISTORY_METADATA_INVALID',
  );
});

test('recovery deploy classifier classifies exact-window untagged versions only with complete runtime metadata', () => {
  const untaggedVersion = {
    id: 'synthetic-untagged-version',
    created_at: '2026-09-27T18:46:34Z',
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapRecoveryHandler',
    service_account_id: runtimeServiceAccount,
    status: 'ACTIVE',
  };

  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [untaggedVersion],
    })),
    'RECOVERY_UNTAGGED_VERSION_CANDIDATE_PRESENT',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [untaggedVersion, { ...untaggedVersion, id: 'synthetic-second-version' }],
    })),
    'RECOVERY_UNTAGGED_VERSION_AMBIGUOUS',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ ...untaggedVersion, service_account_id: serviceAccount }],
    })),
    'RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      operations: [],
      versions: [{ ...untaggedVersion, status: undefined }],
    })),
    'RECOVERY_UNTAGGED_VERSION_METADATA_UNPROVEN',
  );
});

test('recovery deploy classifier refuses absence claims from a full bounded provider list', () => {
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      versions: Array.from({ length: 1_000 }, (_, index) => ({ id: `synthetic-version-${index}` })),
    })),
    'RECOVERY_VERSION_LIST_INCOMPLETE',
  );
  assert.equal(
    classifyRecoveryFunctionDeployOutcome(exactEvidence({
      versions: [],
      operations: Array.from({ length: 1_000 }, () => ({})),
    })),
    'RECOVERY_OPERATION_LIST_INCOMPLETE',
  );
});

test('audit trail source discovery accepts only one pre-existing active documented destination', () => {
  const runFinishedAt = '2026-09-27T18:46:38Z';
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [] }, runFinishedAt), 'AUDIT_TRAIL_SOURCE_NOT_CONFIGURED');
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [], nextPageToken: 'more' }, runFinishedAt), 'AUDIT_TRAIL_LIST_INCOMPLETE');
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [{
    status: 'ACTIVE',
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    destination: { cloudLogging: { logGroupId: 'synthetic-log-group' } },
  }] }, runFinishedAt), 'AUDIT_TRAIL_SOURCE_CREATED_AFTER_TARGET');
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [{
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    destination: { cloudLogging: { logGroupId: 'synthetic-log-group' } },
  }] }, runFinishedAt), 'AUDIT_TRAIL_CLOUD_LOGGING_SOURCE_PRESENT');
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [{
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    destination: { objectStorage: { bucketId: 'synthetic-bucket' } },
  }] }, runFinishedAt), 'AUDIT_TRAIL_OBJECT_STORAGE_SOURCE_PRESENT');
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [{
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    destination: { cloudLogging: { logGroupId: 'synthetic-one' } },
  }, {
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    destination: { cloudLogging: { logGroupId: 'synthetic-two' } },
  }] }, runFinishedAt), 'AUDIT_TRAIL_SOURCE_AMBIGUOUS');
  assert.equal(classifyRecoveryAuditTrailSource({ trails: [{
    status: 'ACTIVE',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    destination: { cloudLogging: { logGroupId: 'synthetic-log-group' } },
  }] }, runFinishedAt), 'AUDIT_TRAIL_CONFIGURATION_CHANGED_AFTER_TARGET');
});

test('audit log classifier identifies only an exact actor/function/time CreateFunctionVersion event', () => {
  const version = {
    id: 'synthetic-version',
    created_at: '2026-09-27T18:46:34Z',
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapRecoveryHandler',
    service_account_id: runtimeServiceAccount,
    tags: ['r1-initial-bootstrap-recovery'],
    status: 'ACTIVE',
  };
  const event = {
    eventId: 'synthetic-event',
    eventType: 'yandex.cloud.audit.serverless.functions.CreateFunctionVersion',
    eventTime: '2026-09-27T18:46:34Z',
    eventStatus: 'DONE',
    authentication: { subjectId: serviceAccount },
    details: {
      functionId: 'synthetic-function',
      functionVersionId: version.id,
      runtime: version.runtime,
      functionVersionEntrypoint: version.entrypoint,
      serviceAccountId: runtimeServiceAccount,
      functionVersionTags: version.tags,
    },
  };
  const context = {
    entries: [{ json_payload: event }],
    versions: [version],
    functionId: 'synthetic-function',
    operationCreatorServiceAccountId: serviceAccount,
    runtimeServiceAccountId: runtimeServiceAccount,
    runStartedAt,
    runFinishedAt,
  };
  assert.equal(classifyRecoveryAuditCreateEvents(context), 'EXACT_RECOVERY_VERSION_CREATED');
  assert.equal(classifyRecoveryAuditCreateEvents({ ...context, entries: [] }), 'AUDIT_CREATE_EVENT_NOT_OBSERVED');
  assert.equal(classifyRecoveryAuditCreateEvents({
    ...context,
    entries: [{ json_payload: { ...event, eventStatus: 'ERROR' } }],
  }), 'AUDIT_CREATE_EVENT_FAILED');
  assert.equal(classifyRecoveryAuditCreateEvents({
    ...context,
    entries: [{ json_payload: { ...event, authentication: { subjectId: runtimeServiceAccount } } }],
  }), 'AUDIT_CREATE_EVENT_WRITER_MISMATCH');
  assert.equal(classifyRecoveryAuditCreateEvents({
    ...context,
    entries: Array.from({ length: 1_000 }, () => ({ json_payload: event })),
  }), 'AUDIT_LOG_LIST_INCOMPLETE');
});

test('recovery deploy CLI reports invalid metadata JSON without echoing parser details', () => {
  const result = spawnSync(process.execPath, [
    'scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs',
    'missing-versions.json',
    'missing-operations.json',
    'missing-tag.json',
    'missing-tag-history.json',
    runStartedAt,
    runFinishedAt,
    serviceAccount,
    runtimeServiceAccount,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'RECOVERY_METADATA_JSON_INVALID\n');
  assert.equal(result.stderr, '');
});

test('cloud folder CLI maps unreadable inventory JSON to one safe enum', () => {
  const result = spawnSync(process.execPath, [
    'scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs',
    '--audit-cloud-folder-ids',
    'missing-cloud-folders.json',
    'synthetic-cloud',
    'synthetic-target-folder',
    'unused-folder-ids.json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'AUDIT_TRAIL_FOLDER_LIST_JSON_INVALID\n');
  assert.equal(result.stderr, '');
});

test('cloud trail CLI maps unreadable trail JSON to one safe enum', () => {
  const result = spawnSync(process.execPath, [
    'scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs',
    '--audit-cloud-trails',
    'package.json',
    'synthetic-cloud',
    'synthetic-target-folder',
    runFinishedAt,
    'unused-locator.txt',
    'missing-trail-list.json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'AUDIT_TRAIL_TRAIL_JSON_INVALID\n');
  assert.equal(result.stderr, '');
});
