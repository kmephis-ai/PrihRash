import assert from 'node:assert/strict';
import test from 'node:test';
import { executeYandexInitialBootstrapRecoveryFunction } from '../../dist/runtime/yandexCloudInitialBootstrapRecoveryFunction.js';

const base = {
  verdict: 'RECOVERY_REQUIRED',
  reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
  staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'SOURCE_DRIFT_NOT_PROVEN' },
};
test('VALIDATED source evidence remains enum-only and cannot cross lifecycle or surface boundaries', async () => {
  for (const validatedSourceEvidence of ['AUTHORITATIVE_SNAPSHOT_MATCH', 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH', 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED', 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY', 'AUTHORITATIVE_ROW_COUNT_MISMATCH', 'AUTHORITATIVE_BINDING_MISMATCH', 'VALIDATED_METADATA_INVALID', 'VALIDATED_SOURCE_DIAGNOSTIC_FAILED']) {
    assert.deepEqual(await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({ ...base, validatedSourceEvidence })), {
      status: 'PASS', code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED', ...base, validatedSourceEvidence,
    });
  }
  for (const value of [
    { verdict: base.verdict, reason: base.reason },
    { ...base, validatedSourceEvidence: 'private text' },
    { ...base, validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH', stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY' },
    { ...base, reason: 'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY', validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH' },
    { ...base, validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH', staleValidatedRecoveryGate: { status: 'READY_FOR_MARKER_ONLY' } },
  ]) {
    assert.deepEqual(await executeYandexInitialBootstrapRecoveryFunction({}, async () => value), { status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED' });
  }
  assert.equal((await executeYandexInitialBootstrapRecoveryFunction({ PRIHRASH_R1_RECOVERY_SURFACE_ONLY: '1' }, async () => ({ ...base, validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_MATCH' }))).status, 'FAIL');
});
