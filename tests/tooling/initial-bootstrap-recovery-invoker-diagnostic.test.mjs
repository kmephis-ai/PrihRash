import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { createFakeNodeCli } from '../helpers/fake-node-cli.mjs';

const execFileAsync = promisify(execFile);

async function fakeYc(stdoutPayload) {
  return (await createFakeNodeCli(
    'prihrash-recovery-invoker-',
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(stdoutPayload)}\n`)});`,
  )).path;
}

test('recovery invoker keeps canonical stdout shape and emits only enum diagnostic to stderr', async () => {
  const yc = await fakeYc({
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
    stagingDurableRevisionEvidence: 'CROSS_RUN_PK_COLLISION',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
    stagingSourceDecodeEvidence: [
      { errorCode: 'INVALID_DATE_CELL', field: 'date' },
      { errorCode: 'INVALID_TEXT_CELL', field: 'description' },
    ],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  });

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
        PRIHRASH_YC_BIN: yc,
      },
    },
  );

  assert.deepEqual(JSON.parse(stdout), {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });
  assert.deepEqual(stderr.trim().split('\n'), [
    'R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
    'R1_STAGING_DURABLE_REVISION_EVIDENCE=CROSS_RUN_PK_COLLISION',
    'R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
    'R1_STAGING_SOURCE_DECODE_EVIDENCE=INVALID_DATE_CELL@date,INVALID_TEXT_CELL@description',
    'R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  ]);
});

test('recovery invoker rejects missing or unknown STAGING diagnostics fail-closed', async () => {
  const invalidPayloads = [
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [],
      stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_MATCH',
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'SYNTHETIC_UNKNOWN_DIAGNOSTIC',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [],
      stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_MATCH',
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
      stagingRetirementEvidence: 'SYNTHETIC_UNKNOWN_RETIREMENT_DIAGNOSTIC',
      stagingSourceDecodeEvidence: [],
      stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_MATCH',
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [
        { errorCode: 'INVALID_TEXT_CELL', field: 'synthetic_private_field' },
      ],
      stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_MATCH',
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'COMPLETE_CURRENT_RUN_ONLY',
      stagingDurableRevisionEvidence: 'COMPLETE_CURRENT_RUN_ONLY',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [],
      stagingExactRevisionEvidence: 'SYNTHETIC_UNKNOWN_EXACT_DIAGNOSTIC',
    },
  ];

  for (const payload of invalidPayloads) {
    const yc = await fakeYc(payload);
    await assert.rejects(
      execFileAsync(
        process.execPath,
        ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
            PRIHRASH_YC_BIN: yc,
          },
        },
      ),
      (error) => {
        assert.equal(error.code, 2);
        assert.deepEqual(JSON.parse(error.stdout), {
          status: 'FAIL',
          code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_OUTPUT_INVALID',
        });
        assert.equal(error.stderr, '');
        return true;
      },
    );
  }
});

test('recovery invoker accepts validated controlled structure reasons with the canonical four-key shape', async () => {
  const reasons = [
    'VALIDATED_CURRENT_EMPTY_STAGING_ABSENT',
    'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY',
    'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
    'VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT',
    'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT',
    'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS',
    'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED',
  ];
  for (const reason of reasons) {
    const yc = await fakeYc({
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason,
      ...(reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'
        ? {
            validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
            staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'HISTORICAL_CONTEXT_NOT_PROVEN' },
          } : {}),
    });
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
          PRIHRASH_YC_BIN: yc,
        },
      },
    );
    assert.deepEqual(JSON.parse(stdout), {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason,
    });
    assert.equal(stderr, reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'
      ? 'R1_VALIDATED_SOURCE_EVIDENCE=AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY\n'
        + 'R1_STALE_VALIDATED_GATE_BLOCKER=HISTORICAL_CONTEXT_NOT_PROVEN\n'
      : '');
  }
});

test('surface-only invoker accepts bare STAGING enum only when explicitly selected', async () => {
  const yc = await fakeYc({
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });
  const env = {
    ...process.env,
    PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
    PRIHRASH_YC_BIN: yc,
  };
  const accepted = await execFileAsync(process.execPath, ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'], {
    cwd: process.cwd(),
    env: { ...env, RECOVERY_SURFACE_ONLY: '1' },
  });
  assert.deepEqual(JSON.parse(accepted.stdout), {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });
  assert.equal(accepted.stderr, '');

  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'], {
      cwd: process.cwd(),
      env: { ...env, RECOVERY_SURFACE_ONLY: '0' },
    }),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(JSON.parse(error.stdout).code, 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_OUTPUT_INVALID');
      return true;
    },
  );
});


test('VALIDATED source invoker rejects missing, unknown, extra and wrong-state evidence without echo', async () => {
  const base = { status: 'PASS', code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED', verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY' };
  for (const value of [base, { ...base, validatedSourceEvidence: 'private text' }, { ...base, validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH', private: 'private text' }, { ...base, reason: 'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY', validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH' }]) {
    const yc = await fakeYc(value);
    await assert.rejects(() => execFileAsync(process.execPath, ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'], {
      cwd: process.cwd(), env: { ...process.env, PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id', PRIHRASH_YC_BIN: yc },
    }), (error) => error.code === 2 && !error.stdout.includes('private text') && !error.stderr.includes('private text'));
  }
});


test('controlled-preparation-only invoker preserves only allowlisted enum evidence', async () => {
  const base = {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  };
  for (const [evidence, retryEvidence, queryErrorEvidence, grpcStatusEvidence, phaseEvidence, referenceReadStageEvidence, readStageEvidence, metadataScanCostEvidence] of [
    ['READY', 'NO_RETRY', 'UNOBSERVED', 'UNOBSERVED', 'CURRENT_WRITE_PREPARATION', 'VIKA_MEMBER_READ', 'UNOBSERVED', 'UNOBSERVED'],
    ['YDB_QUERY_TIMEOUT', 'RETRIED', 'ABORT_TIMEOUT', 'NON_GRPC', 'RECONCILIATION_READ', 'ACCOUNTS_READ', 'REVISION_METADATA_SCAN', 'LT_10_RU'],
    ['YDB_DATA_QUERY_EXECUTION_FAILED', 'NON_RETRYABLE', 'GRPC_STATUS', 'UNAVAILABLE', 'RECONCILIATION_READ', 'CATEGORIES_READ', 'REVISION_PAYLOAD_BATCH', 'GE_10_LT_3000_RU'],
    ['YDB_DATA_QUERY_EXECUTION_YDB_UNAVAILABLE', 'EXHAUSTED', 'YDB_STATUS', 'NON_GRPC', 'RECONCILIATION_READ', 'VIKA_MEMBER_READ', 'REVISION_COLLISION_READ', 'GE_3000_RU'],
    ['DURABLE_RECONCILIATION_FAILURE', 'UNOBSERVED', 'OTHER', 'NON_GRPC', 'ADMISSION_READ', 'DIAGNOSTIC_FAILED', 'DIAGNOSTIC_FAILED', 'DIAGNOSTIC_FAILED'],
  ]) {
    const yc = await fakeYc({
      ...base,
      stagingControlledPreparationEvidence: evidence,
      stagingControlledPreparationRetryEvidence: retryEvidence,
      stagingControlledPreparationQueryErrorEvidence: queryErrorEvidence,
      stagingControlledPreparationGrpcStatusEvidence: grpcStatusEvidence,
      stagingControlledPreparationPhaseEvidence: phaseEvidence,
      stagingControlledPreparationReferenceReadStageEvidence: referenceReadStageEvidence,
      stagingControlledPreparationReconciliationReadStageEvidence: readStageEvidence,
      stagingControlledPreparationMetadataScanCostEvidence: metadataScanCostEvidence,
    });
    const result = await execFileAsync(
      process.execPath,
      ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
          PRIHRASH_YC_BIN: yc,
          RECOVERY_CONTROLLED_PREPARATION_ONLY: '1',
        },
      },
    );
    assert.deepEqual(JSON.parse(result.stdout), base);
    assert.equal(
      result.stderr,
      `R1_STAGING_CONTROLLED_PREPARATION_EVIDENCE=${evidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE=${retryEvidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_QUERY_ERROR_EVIDENCE=${queryErrorEvidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_GRPC_STATUS_EVIDENCE=${grpcStatusEvidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_PHASE_EVIDENCE=${phaseEvidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_REFERENCE_READ_STAGE_EVIDENCE=${referenceReadStageEvidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_RECONCILIATION_READ_STAGE_EVIDENCE=${readStageEvidence}\n`
        + `R1_STAGING_CONTROLLED_PREPARATION_METADATA_SCAN_COST_EVIDENCE=${metadataScanCostEvidence}\n`,
    );
  }
});

test('controlled preparation evidence is rejected outside its mode and unknown enums fail closed', async () => {
  const base = {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  };
  for (const { payload, mode } of [
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '0',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'PRIVATE_ENUM',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'YDB_DATA_FAILURE',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'YDB_DATA_QUERY_EXECUTION_YDB_TIMEOUT',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'PRIVATE_RETRY_ENUM',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'PRIVATE_QUERY_ERROR_ENUM',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationGrpcStatusEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'PRIVATE_GRPC_STATUS_ENUM',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'PRIVATE_PHASE',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationReferenceReadStageEvidence: 'PRIVATE_REFERENCE_STAGE',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'RECONCILIATION_READ',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'REVISION_METADATA_SCAN',
        stagingControlledPreparationMetadataScanCostEvidence: 'PRIVATE_COST_ENUM',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'RECONCILIATION_READ',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'REVISION_METADATA_SCAN',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'RECONCILIATION_READ',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
        stagingControlledPreparationReconciliationReadStageEvidence: 'PRIVATE_READ_STAGE',
      },
      mode: '1',
    },
    {
      payload: {
        ...base,
        stagingControlledPreparationEvidence: 'READY',
        stagingControlledPreparationRetryEvidence: 'NO_RETRY',
        stagingControlledPreparationQueryErrorEvidence: 'UNOBSERVED',
        stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
        stagingControlledPreparationPhaseEvidence: 'RECONCILIATION_READ',
        stagingControlledPreparationReferenceReadStageEvidence: 'UNOBSERVED',
        stagingControlledPreparationMetadataScanCostEvidence: 'UNOBSERVED',
      },
      mode: '1',
    },
  ]) {
    const yc = await fakeYc(payload);
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
          PRIHRASH_YC_BIN: yc,
          RECOVERY_CONTROLLED_PREPARATION_ONLY: mode,
        },
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.deepEqual(JSON.parse(error.stdout), {
          status: 'FAIL',
          code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_OUTPUT_INVALID',
        });
        assert.equal(error.stdout.includes('PRIVATE_ENUM'), false);
        assert.equal(error.stderr.includes('PRIVATE_ENUM'), false);
        return true;
      },
    );
  }
});
