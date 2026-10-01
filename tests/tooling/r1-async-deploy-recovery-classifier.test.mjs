import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { classifyAsyncDeployRecovery } from '../../scripts/classify-r1-async-deploy-recovery.mjs';

const functionId = 'synthetic-function';
const runtimeSa = 'synthetic-runtime-sa';
const wifSa = 'synthetic-wif-sa';
const lockboxId = 'synthetic-lockbox';
const lockboxVersionId = 'synthetic-lockbox-version';
const versionId = 'synthetic-async-version';
const deployStartedAt = '2026-09-30T22:10:31Z';
const deployFinishedAt = '2026-09-30T22:10:34Z';
const observedAt = '2026-09-30T22:11:00Z';

function evidence(overrides = {}) {
  const asyncVersion = {
    id: versionId,
    functionId,
    status: 'ACTIVE',
    runtime: 'nodejs22',
    entrypoint: 'index.initialBootstrapHandler',
    serviceAccountId: runtimeSa,
    resources: { memory: '1073741824' },
    executionTimeout: '600s',
    tags: ['r1-initial-bootstrap-async'],
    logOptions: { disabled: true },
    metadataOptions: { gceHttpEndpoint: 'ENABLED', awsV1HttpEndpoint: 'DISABLED' },
    asyncInvocationConfig: {
      retriesCount: 0,
      serviceAccountId: wifSa,
      successTarget: {},
      failureTarget: {},
    },
    secrets: [
      ['PRIHRASH_GOOGLE_SPREADSHEET_ID', 'google_spreadsheet_id'],
      ['PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL', 'google_service_account_email'],
      ['PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'google_service_account_private_key'],
      ['PRIHRASH_YDB_CONNECTION_STRING', 'ydb_connection_string'],
      ['PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE', 'initial_bootstrap_private_historical_evidence'],
    ].map(([environmentVariable, key]) => ({
      id: lockboxId,
      versionId: lockboxVersionId,
      environmentVariable,
      key,
    })),
    createdAt: '2026-09-30T22:10:32Z',
  };
  const operation = {
    id: 'synthetic-operation',
    created_by: wifSa,
    created_at: '2026-09-30T22:10:32Z',
    done: true,
    response: {
      '@type': 'type.googleapis.com/yandex.cloud.serverless.functions.v1.Version',
      id: versionId,
    },
    metadata: {
      '@type': 'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata',
      function_version_id: versionId,
    },
  };
  return {
    versions: [{
      id: versionId,
      function_id: functionId,
      created_at: '2026-09-30T22:10:32Z',
      runtime: 'nodejs22',
      entrypoint: 'index.initialBootstrapHandler',
      service_account_id: runtimeSa,
      tags: ['r1-initial-bootstrap-async'],
    }],
    operations: [operation],
    functionBindings: [{
      role_id: 'functions.functionInvoker',
      subject: { type: 'serviceAccount', id: runtimeSa },
    }],
    taggedVersion: asyncVersion,
    tagHistory: { functionTagHistoryRecord: [{
      functionId,
      tag: 'r1-initial-bootstrap-async',
      functionVersionId: versionId,
      effectiveFrom: '2026-09-30T22:10:32Z',
      effectiveTo: '2099-12-31T23:59:59Z',
    }] },
    functionId,
    runtimeServiceAccountId: runtimeSa,
    invokerServiceAccountId: wifSa,
    lockboxSecretId: lockboxId,
    lockboxVersionId,
    deployStartedAt,
    deployFinishedAt,
    observedAt,
    ...overrides,
  };
}

test('only exact operation ID, full zero-retry config and active tag history permit invocation-only continuation', () => {
  assert.deepEqual(classifyAsyncDeployRecovery(evidence()), {
    status: 'PASS',
    code: 'R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED',
    verdict: 'INVOCATION_ONLY_READY',
    previousWrite: 'VERSION_PROVEN',
    runtimeInvoker: 'PRESENT',
    createFailureClass: 'NONE',
  });

  const base = evidence();
  const rejected = [
    { taggedVersion: { ...base.taggedVersion, asyncInvocationConfig: { ...base.taggedVersion.asyncInvocationConfig, retriesCount: 1 } } },
    { taggedVersion: { ...base.taggedVersion, asyncInvocationConfig: { ...base.taggedVersion.asyncInvocationConfig, serviceAccountId: 'other' } } },
    { taggedVersion: { ...base.taggedVersion, asyncInvocationConfig: { ...base.taggedVersion.asyncInvocationConfig, successTarget: { queueId: 'not-allowed' } } } },
    { taggedVersion: { ...base.taggedVersion, asyncInvocationConfig: { ...base.taggedVersion.asyncInvocationConfig, failureTarget: { queueId: 'not-allowed' } } } },
    { taggedVersion: { ...base.taggedVersion, entrypoint: 'index.otherHandler' } },
    { taggedVersion: { ...base.taggedVersion, serviceAccountId: 'other-runtime' } },
    { taggedVersion: { ...base.taggedVersion, executionTimeout: '599s' } },
    { taggedVersion: { ...base.taggedVersion, logOptions: { disabled: false } } },
    { taggedVersion: { ...base.taggedVersion, secrets: base.taggedVersion.secrets.slice(1) } },
    { tagHistory: { functionTagHistoryRecord: [] } },
  ];
  for (const override of rejected) {
    assert.equal(classifyAsyncDeployRecovery(evidence(override)).verdict, 'PREVIOUS_VERSION_UNPROVEN');
  }
});

test('exact terminal request errors have different repository-only or stop outcomes without NOT_APPLIED inference', () => {
  const rejectedCreate = (code) => evidence({
    versions: [],
    operations: [{
      ...evidence().operations[0],
      error: { code, message: 'private provider detail is never returned' },
    }],
    taggedVersion: {},
    tagHistory: { functionTagHistoryRecord: [] },
  });
  assert.equal(classifyAsyncDeployRecovery(rejectedCreate(3)).verdict, 'REQUEST_CONTRACT_INVALID');
  assert.equal(classifyAsyncDeployRecovery(rejectedCreate(9)).verdict, 'REQUEST_CONTRACT_INVALID');
  assert.equal(classifyAsyncDeployRecovery(rejectedCreate(7)).verdict, 'CREATE_PERMISSION_DENIED');
  assert.equal(classifyAsyncDeployRecovery(rejectedCreate(14)).verdict, 'CREATE_OPERATION_FAILED_UNCLASSIFIED');
  assert.equal(classifyAsyncDeployRecovery(rejectedCreate(3)).previousWrite, 'CREATE_OPERATION_FAILED');
  assert.equal(classifyAsyncDeployRecovery(rejectedCreate(3)).createFailureClass, 'INVALID_ARGUMENT');

  const ambiguousSideEffect = classifyAsyncDeployRecovery(evidence({
    operations: [{ ...evidence().operations[0], error: { code: 7 } }],
  }));
  assert.equal(ambiguousSideEffect.verdict, 'PREVIOUS_WRITE_AMBIGUOUS');
  assert.equal(ambiguousSideEffect.previousWrite, 'AMBIGUOUS');
});

test('missing operation/version proof never becomes NOT_APPLIED; in-progress and duplicate operations stop', () => {
  const noCreateProof = classifyAsyncDeployRecovery(evidence({
    versions: [], operations: [], taggedVersion: {}, tagHistory: { functionTagHistoryRecord: [] },
  }));
  assert.equal(noCreateProof.verdict, 'DEPLOYMENT_OUTCOME_UNCLASSIFIED');
  assert.equal(noCreateProof.previousWrite, 'UNCLASSIFIED');

  assert.equal(classifyAsyncDeployRecovery(evidence({
    operations: [{ ...evidence().operations[0], done: false }],
  })).verdict, 'CREATE_OPERATION_IN_PROGRESS');
  assert.equal(classifyAsyncDeployRecovery(evidence({
    operations: [evidence().operations[0], { ...evidence().operations[0], id: 'second-operation' }],
  })).verdict, 'PREVIOUS_WRITE_AMBIGUOUS');
  assert.equal(classifyAsyncDeployRecovery(evidence({
    functionBindings: [],
  })).verdict, 'IAM_BOUNDARY_MISSING');
  assert.equal(classifyAsyncDeployRecovery(evidence({
    versions: Array.from({ length: 1_000 }, () => ({})),
  })).verdict, 'EVIDENCE_INVALID');
});

test('classifier CLI publishes enums only and does not echo IDs or provider error payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'r1-async-deploy-recovery-fixture-'));
  const input = evidence();
  const names = ['versions', 'operations', 'bindings', 'tagged', 'history'];
  const values = [input.versions, input.operations, input.functionBindings, input.taggedVersion, input.tagHistory];
  const paths = names.map((name) => join(root, `${name}.json`));
  paths.forEach((path, index) => writeFileSync(path, JSON.stringify(values[index]), 'utf8'));
  const args = [
    ...paths,
    input.functionId,
    input.runtimeServiceAccountId,
    input.invokerServiceAccountId,
    input.lockboxSecretId,
    input.lockboxVersionId,
    input.deployStartedAt,
    input.deployFinishedAt,
    input.observedAt,
  ];
  try {
    const exact = spawnSync(process.execPath, ['scripts/classify-r1-async-deploy-recovery.mjs', ...args], { encoding: 'utf8' });
    assert.equal(exact.status, 0);
    assert.deepEqual(JSON.parse(exact.stdout), classifyAsyncDeployRecovery(input));
    assert.equal(exact.stderr, '');
    assert.doesNotMatch(exact.stdout, /synthetic-(?:function|runtime|wif|lockbox|async-version|operation)/);

    const deniedInput = evidence({
      versions: [],
      taggedVersion: {},
      tagHistory: { functionTagHistoryRecord: [] },
      operations: [{ ...input.operations[0], error: { code: 7, message: 'private-operation-error' } }],
    });
    const deniedValues = [deniedInput.versions, deniedInput.operations, deniedInput.functionBindings,
      deniedInput.taggedVersion, deniedInput.tagHistory];
    paths.forEach((path, index) => writeFileSync(path, JSON.stringify(deniedValues[index]), 'utf8'));
    const denied = spawnSync(process.execPath, ['scripts/classify-r1-async-deploy-recovery.mjs', ...args], { encoding: 'utf8' });
    assert.equal(denied.status, 0);
    assert.equal(JSON.parse(denied.stdout).verdict, 'CREATE_PERMISSION_DENIED');
    assert.equal(denied.stderr, '');
    assert.doesNotMatch(denied.stdout, /private-operation-error|synthetic-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
