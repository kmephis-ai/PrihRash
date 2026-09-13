import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  diagnoseInitialBootstrapRecoverySurface,
  diagnoseInitialBootstrapResidualSurfaceEvidence,
} from '../../dist/migration/initialBootstrapResidualSurface.js';
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

test('residual surface diagnosis refines only no-run residual state', () => {
  const cases = [
    [evidence({ accounts: 1 }), 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN'],
    [evidence({ categories: 1, familyMembers: 1 }), 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN'],
    [evidence({ sourceSnapshots: 1 }), 'RESIDUAL_METADATA_STATE_WITHOUT_RUN'],
    [evidence({ identityManifests: 1 }), 'RESIDUAL_METADATA_STATE_WITHOUT_RUN'],
    [evidence({ sourceRecords: 1 }), 'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN'],
    [evidence({ sourceRecordRevisions: 1, transactions: 1 }), 'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN'],
    [evidence({ accounts: 1, sourceSnapshots: 1 }), 'RESIDUAL_MIXED_STATE_WITHOUT_RUN'],
    [evidence({ sourceSnapshots: 1, sourceRecords: 1 }), 'RESIDUAL_MIXED_STATE_WITHOUT_RUN'],
  ];

  for (const [candidate, reason] of cases) {
    assert.deepEqual(diagnoseInitialBootstrapResidualSurfaceEvidence(candidate), {
      verdict: 'RECOVERY_REQUIRED',
      reason,
    });
  }

  assert.deepEqual(diagnoseInitialBootstrapResidualSurfaceEvidence(evidence()), {
    verdict: 'NOT_APPLIED',
    reason: 'EMPTY_DURABLE_STATE',
  });
  assert.deepEqual(diagnoseInitialBootstrapResidualSurfaceEvidence(evidence({
    migrationRuns: 1,
    stagingRuns: 1,
  })), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });
});

test('residual surface diagnosis stays read-only and exposes no counts', async () => {
  const statements = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      statements.push(statement);
      assert.equal(statement.kind, 'READ');
      if (statement.text.includes('SELECT rows_seen')) return { rows: [] };
      const rowCount = statement.text.includes('FROM accounts') ? 1n : 0n;
      return { rows: [{ row_count: rowCount }] };
    },
    async serializableReadWrite() {
      throw new Error('read-write transaction must not be used by residual diagnosis');
    },
  });

  assert.deepEqual(await diagnoseInitialBootstrapRecoverySurface(adapter), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN',
  });
  assert.equal(statements.every((statement) => statement.kind === 'READ'), true);
});

test('Yandex recovery handler accepts only allowlisted residual surface reason', async () => {
  const result = await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_METADATA_STATE_WITHOUT_RUN',
  }));
  assert.deepEqual(result, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_METADATA_STATE_WITHOUT_RUN',
  });

  const authoritativeMatch = await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  }));
  assert.deepEqual(authoritativeMatch, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  });

  const invalid = await executeYandexInitialBootstrapRecoveryFunction({}, async () => /** @type {any} */ ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'PRIVATE_TABLE_NAME',
  }));
  assert.deepEqual(invalid, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
  });
});
