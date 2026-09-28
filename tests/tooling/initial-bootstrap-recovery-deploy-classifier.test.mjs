import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  classifyRecoveryAuditCreateEvents,
  classifyRecoveryAuditTrailSource,
  classifyRecoveryFunctionDeployOutcome,
} from '../../scripts/classify-yandex-initial-bootstrap-recovery-deploy.mjs';

const runStartedAt = '2026-09-27T18:46:30Z';
const runFinishedAt = '2026-09-27T18:46:38Z';
const serviceAccount = 'synthetic-deployer';
const runtimeServiceAccount = 'synthetic-runtime';

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
