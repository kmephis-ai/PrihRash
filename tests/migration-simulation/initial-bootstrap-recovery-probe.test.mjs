import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  classifyInitialBootstrapRecoveryEvidence,
  probeInitialBootstrapRecovery,
} from '../../dist/migration/initialBootstrapRecoveryProbe.js';
import {
  executeYandexInitialBootstrapRecoveryFunction,
} from '../../dist/runtime/yandexCloudInitialBootstrapRecoveryFunction.js';

function evidence(overrides = {}) {
  return Object.freeze({
    migrationRuns: 0,
    committedRuns: 0,
    stagingRuns: 0,
    validatedRuns: 0,
    failedRuns: 0,
    committedRowsSeen: null,
    sourceSnapshots: 0,
    identityManifests: 0,
    sourceRecords: 0,
    sourceRecordRevisions: 0,
    transactions: 0,
    accounts: 0,
    categories: 0,
    familyMembers: 0,
    ...overrides,
  });
}

test('bootstrap recovery classifies exact empty durable state as NOT_APPLIED', () => {
  assert.equal(classifyInitialBootstrapRecoveryEvidence(evidence()), 'NOT_APPLIED');
});

test('bootstrap recovery classifies one internally consistent committed baseline as APPLIED', () => {
  assert.equal(classifyInitialBootstrapRecoveryEvidence(evidence({
    migrationRuns: 1,
    committedRuns: 1,
    committedRowsSeen: 3,
    sourceSnapshots: 1,
    identityManifests: 1,
    sourceRecords: 3,
    sourceRecordRevisions: 3,
    transactions: 2,
    accounts: 2,
    categories: 2,
    familyMembers: 1,
  })), 'APPLIED');
});

test('bootstrap recovery fails closed for incomplete, failed, unknown or residual durable state', () => {
  const cases = [
    evidence({ migrationRuns: 1, stagingRuns: 1, sourceSnapshots: 1, identityManifests: 1 }),
    evidence({ migrationRuns: 1, failedRuns: 1 }),
    evidence({ migrationRuns: 1 }),
    evidence({ accounts: 1 }),
    evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 2, sourceSnapshots: 1, identityManifests: 1, sourceRecords: 1, sourceRecordRevisions: 1 }),
    evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 0, sourceSnapshots: 2, identityManifests: 1 }),
  ];
  for (const candidate of cases) {
    assert.equal(classifyInitialBootstrapRecoveryEvidence(candidate), 'RECOVERY_REQUIRED');
  }
});

test('bootstrap recovery probe uses read-only statements and never opens a read-write transaction', async () => {
  const statements = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      statements.push(statement);
      assert.equal(statement.kind, 'READ');
      if (statement.text.includes('SELECT rows_seen')) return { rows: [] };
      return { rows: [{ row_count: 0n }] };
    },
    async serializableReadWrite() {
      throw new Error('read-write transaction must not be used by recovery probe');
    },
  });

  assert.equal(await probeInitialBootstrapRecovery(adapter), 'NOT_APPLIED');
  assert.equal(statements.length > 0, true);
  assert.equal(statements.every((statement) => statement.kind === 'READ'), true);
});

test('bootstrap recovery probe converts read failures to RECOVERY_REQUIRED', async () => {
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('synthetic read failure');
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });

  assert.equal(await probeInitialBootstrapRecovery(adapter), 'RECOVERY_REQUIRED');
});

test('Yandex recovery handler exposes only the sanitized verdict enum', async () => {
  const applied = await executeYandexInitialBootstrapRecoveryFunction({}, async () => 'APPLIED');
  assert.deepEqual(applied, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'APPLIED',
  });

  const invalid = await executeYandexInitialBootstrapRecoveryFunction({}, async () => /** @type {any} */ ('OTHER'));
  assert.deepEqual(invalid, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
  });
});
