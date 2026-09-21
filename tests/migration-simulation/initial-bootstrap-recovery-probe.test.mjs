import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  classifyInitialBootstrapRecoveryEvidence,
  diagnoseInitialBootstrapRecovery,
  diagnoseInitialBootstrapRecoveryEvidence,
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
    staleRetiredRuns: 0,
    staleValidatedTerminalizedRuns: 0,
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

test('bootstrap recovery preserves existing NOT_APPLIED and APPLIED verdicts', () => {
  assert.equal(classifyInitialBootstrapRecoveryEvidence(evidence()), 'NOT_APPLIED');
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

test('bootstrap recovery exposes deterministic privacy-safe reason taxonomy', () => {
  const cases = [
    [evidence(), 'NOT_APPLIED', 'EMPTY_DURABLE_STATE'],
    [evidence({ accounts: 1 }), 'RECOVERY_REQUIRED', 'RESIDUAL_STATE_WITHOUT_RUN'],
    [evidence({ migrationRuns: 2, stagingRuns: 2 }), 'RECOVERY_REQUIRED', 'MULTIPLE_MIGRATION_RUNS'],
    [evidence({ migrationRuns: 1, stagingRuns: 1 }), 'RECOVERY_REQUIRED', 'STAGING_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, validatedRuns: 1 }), 'RECOVERY_REQUIRED', 'VALIDATED_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, failedRuns: 1 }), 'RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, failedRuns: 1, staleRetiredRuns: 1, sourceSnapshots: 1, identityManifests: 1, sourceRecordRevisions: 1 }), 'RECOVERY_REQUIRED', 'STALE_STAGING_RETIRED'],
    [evidence({ migrationRuns: 1, failedRuns: 1, staleRetiredRuns: 1, sourceSnapshots: 2, identityManifests: 1 }), 'RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, failedRuns: 1, staleRetiredRuns: 1, sourceSnapshots: 1, identityManifests: 2 }), 'RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, failedRuns: 1, staleRetiredRuns: 1, sourceRecords: 1 }), 'RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, failedRuns: 1, staleRetiredRuns: 2 }), 'RECOVERY_REQUIRED', 'RUN_STATE_COUNT_INCONSISTENT'],
    [evidence({ migrationRuns: 2, stagingRuns: 1, failedRuns: 1, staleRetiredRuns: 1 }), 'RECOVERY_REQUIRED', 'STAGING_RUN_PRESENT'],
    [evidence({ migrationRuns: 2, stagingRuns: 1, failedRuns: 1, staleValidatedTerminalizedRuns: 1 }), 'RECOVERY_REQUIRED', 'STAGING_RUN_PRESENT'],
    [evidence({ migrationRuns: 1, failedRuns: 1, staleValidatedTerminalizedRuns: 1 }), 'RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT'],
    [evidence({ migrationRuns: 2, stagingRuns: 1, failedRuns: 1, staleValidatedTerminalizedRuns: 2 }), 'RECOVERY_REQUIRED', 'RUN_STATE_COUNT_INCONSISTENT'],
    [evidence({ migrationRuns: 1 }), 'RECOVERY_REQUIRED', 'RUN_STATE_COUNT_INCONSISTENT'],
    [evidence({ migrationRuns: 1, committedRuns: 1 }), 'RECOVERY_REQUIRED', 'COMMITTED_ROWS_SEEN_MISSING'],
    [evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 0, sourceSnapshots: 2 }), 'RECOVERY_REQUIRED', 'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID'],
    [evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 0, sourceSnapshots: 1, identityManifests: 2 }), 'RECOVERY_REQUIRED', 'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID'],
    [evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 2, sourceSnapshots: 1, identityManifests: 1, sourceRecords: 1 }), 'RECOVERY_REQUIRED', 'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH'],
    [evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 2, sourceSnapshots: 1, identityManifests: 1, sourceRecords: 2, sourceRecordRevisions: 1 }), 'RECOVERY_REQUIRED', 'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH'],
    [evidence({ migrationRuns: 1, committedRuns: 1, committedRowsSeen: 2, sourceSnapshots: 1, identityManifests: 1, sourceRecords: 2, sourceRecordRevisions: 2 }), 'APPLIED', 'COMMITTED_DURABLE_STATE'],
  ];

  for (const [candidate, verdict, reason] of cases) {
    assert.deepEqual(diagnoseInitialBootstrapRecoveryEvidence(candidate), { verdict, reason });
    assert.equal(classifyInitialBootstrapRecoveryEvidence(candidate), verdict);
  }
});

test('bootstrap recovery probe remains read-only and never opens a read-write transaction', async () => {
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

  assert.deepEqual(await diagnoseInitialBootstrapRecovery(adapter), {
    verdict: 'NOT_APPLIED',
    reason: 'EMPTY_DURABLE_STATE',
  });
  assert.equal(await probeInitialBootstrapRecovery(adapter), 'NOT_APPLIED');
  assert.equal(statements.length > 0, true);
  assert.equal(statements.every((statement) => statement.kind === 'READ'), true);
});

test('bootstrap recovery converts read failures to sanitized READ_FAILED classification', async () => {
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('synthetic read failure');
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });

  assert.deepEqual(await diagnoseInitialBootstrapRecovery(adapter), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'READ_FAILED',
  });
  assert.equal(await probeInitialBootstrapRecovery(adapter), 'RECOVERY_REQUIRED');
});

test('Yandex recovery handler exposes only validated verdict plus reason enums', async () => {
  const applied = await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({
    verdict: 'APPLIED',
    reason: 'COMMITTED_DURABLE_STATE',
  }));
  assert.deepEqual(applied, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'APPLIED',
    reason: 'COMMITTED_DURABLE_STATE',
  });

  const retired = await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STALE_STAGING_RETIRED',
  }));
  assert.deepEqual(retired, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STALE_STAGING_RETIRED',
  });

  const staging = await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
    stagingDurableRevisionEvidence: 'CROSS_RUN_PK_COLLISION',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
    stagingSourceDecodeEvidence: [
      { errorCode: 'INVALID_TEXT_CELL', field: 'description' },
    ],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  }));
  assert.deepEqual(staging, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
    stagingDurableRevisionEvidence: 'CROSS_RUN_PK_COLLISION',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
    stagingSourceDecodeEvidence: [
      { errorCode: 'INVALID_TEXT_CELL', field: 'description' },
    ],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  });

  const surfaceOnly = await executeYandexInitialBootstrapRecoveryFunction(
    { PRIHRASH_R1_RECOVERY_SURFACE_ONLY: '1' },
    async () => ({ verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' }),
  );
  assert.deepEqual(surfaceOnly, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });

  const invalid = await executeYandexInitialBootstrapRecoveryFunction({}, async () => /** @type {any} */ ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  }));
  assert.deepEqual(invalid, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
  });
});


test('Yandex recovery handler accepts controlled preparation evidence only in diagnostic mode', async () => {
  const base = {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingControlledPreparationEvidence: 'YDB_DATA_QUERY_EXECUTION_FAILED',
    stagingControlledPreparationRetryEvidence: 'RETRIED',
    stagingControlledPreparationQueryErrorEvidence: 'YDB_STATUS',
    stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
  };
  assert.deepEqual(
    await executeYandexInitialBootstrapRecoveryFunction(
      { PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY: '1' },
      async () => base,
    ),
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      ...base,
    },
  );
  assert.deepEqual(
    await executeYandexInitialBootstrapRecoveryFunction({}, async () => base),
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
    },
  );
  assert.deepEqual(
    await executeYandexInitialBootstrapRecoveryFunction(
      { PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY: '1' },
      async () => ({
        ...base,
        stagingControlledPreparationEvidence: 'PRIVATE_ENUM',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
      }),
    ),
    {
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
    },
  );
  for (const invalidEvidence of ['YDB_DATA_FAILURE', 'YDB_DATA_QUERY_EXECUTION_YDB_TIMEOUT']) {
    assert.deepEqual(
      await executeYandexInitialBootstrapRecoveryFunction(
        { PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY: '1' },
        async () => ({
          verdict: 'RECOVERY_REQUIRED',
          reason: 'STAGING_RUN_PRESENT',
          stagingControlledPreparationEvidence: invalidEvidence,
          stagingControlledPreparationRetryEvidence: 'NO_RETRY',
          stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
          stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        }),
      ),
      {
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
      },
    );
  }

  for (const invalidRetryEvidence of [undefined, 'PRIVATE_RETRY_ENUM']) {
    assert.deepEqual(
      await executeYandexInitialBootstrapRecoveryFunction(
        { PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY: '1' },
        async () => ({
          verdict: 'RECOVERY_REQUIRED',
          reason: 'STAGING_RUN_PRESENT',
          stagingControlledPreparationEvidence: 'READY',
          stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
          stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
          ...(invalidRetryEvidence === undefined
            ? {}
            : { stagingControlledPreparationRetryEvidence: invalidRetryEvidence }),
        }),
      ),
      {
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
      },
    );
  }

  for (const invalidQueryErrorEvidence of [undefined, 'PRIVATE_QUERY_ERROR_ENUM']) {
    assert.deepEqual(
      await executeYandexInitialBootstrapRecoveryFunction(
        { PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY: '1' },
        async () => ({
          verdict: 'RECOVERY_REQUIRED',
          reason: 'STAGING_RUN_PRESENT',
          stagingControlledPreparationEvidence: 'READY',
          stagingControlledPreparationRetryEvidence: 'NO_RETRY',
          stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
          ...(invalidQueryErrorEvidence === undefined
            ? {}
            : { stagingControlledPreparationQueryErrorEvidence: invalidQueryErrorEvidence }),
        }),
      ),
      {
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
      },
    );
  }

  for (const invalidGrpcStatusEvidence of [undefined, 'PRIVATE_GRPC_STATUS_ENUM']) {
    assert.deepEqual(
      await executeYandexInitialBootstrapRecoveryFunction(
        { PRIHRASH_R1_RECOVERY_CONTROLLED_PREPARATION_ONLY: '1' },
        async () => ({
          verdict: 'RECOVERY_REQUIRED',
          reason: 'STAGING_RUN_PRESENT',
          stagingControlledPreparationEvidence: 'READY',
          stagingControlledPreparationRetryEvidence: 'NO_RETRY',
          stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
          ...(invalidGrpcStatusEvidence === undefined
            ? {}
            : { stagingControlledPreparationGrpcStatusEvidence: invalidGrpcStatusEvidence }),
        }),
      ),
      {
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
      },
    );
  }
});
