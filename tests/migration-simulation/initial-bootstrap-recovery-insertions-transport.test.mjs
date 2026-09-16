import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeYandexInitialBootstrapRecoveryFunction,
} from '../../dist/runtime/yandexCloudInitialBootstrapRecoveryFunction.js';

test('Yandex recovery transport accepts insertion-only source diagnostic enum', async () => {
  const result = await executeYandexInitialBootstrapRecoveryFunction({}, async () => ({
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
  }));

  assert.deepEqual(result, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
  });
});
