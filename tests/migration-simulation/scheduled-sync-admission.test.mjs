import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ScheduledSyncAdmissionError,
  evaluateScheduledSyncAdmission,
} from '../../dist/migration/scheduledSyncAdmission.js';

function run(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000901',
    startedAt: '2026-09-07T12:00:00.000Z',
    finishedAt: '2026-09-07T12:00:10.000Z',
    sourceSnapshotDigest: 'digest-a',
    state: 'COMMITTED',
    rowsSeen: 10,
    rowsNew: 0,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateScheduledSyncAdmission({
    observedSnapshotDigest: 'digest-b',
    committedBaselineRun: run(),
    incompleteRuns: [],
    ...overrides,
  });
}

test('NO_CHANGE when fresh full snapshot matches last committed baseline', () => {
  const result = evaluate({ observedSnapshotDigest: 'digest-a' });
  assert.deepEqual(result, { decision: 'NO_CHANGE' });
  assert.equal(Object.isFrozen(result), true);
});

test('START_INCREMENTAL only from a clean committed baseline with changed digest', () => {
  assert.deepEqual(evaluate(), { decision: 'START_INCREMENTAL' });
});

test('BOOTSTRAP_REQUIRED when no committed baseline exists', () => {
  assert.deepEqual(evaluate({ committedBaselineRun: null }), { decision: 'BOOTSTRAP_REQUIRED' });
});

test('RECOVERY_REQUIRED takes priority over no-change and bootstrap decisions', () => {
  const staging = run({
    id: '00000000-0000-0000-0000-000000000902',
    state: 'STAGING',
    finishedAt: null,
    sourceSnapshotDigest: 'digest-b',
  });
  const validated = run({
    id: '00000000-0000-0000-0000-000000000903',
    state: 'VALIDATED',
    finishedAt: null,
    sourceSnapshotDigest: 'digest-c',
  });

  assert.deepEqual(evaluate({ observedSnapshotDigest: 'digest-a', incompleteRuns: [staging] }), {
    decision: 'RECOVERY_REQUIRED',
  });
  assert.deepEqual(evaluate({ committedBaselineRun: null, incompleteRuns: [validated] }), {
    decision: 'RECOVERY_REQUIRED',
  });
});

test('malformed or non-committed baseline fails closed', () => {
  for (const baseline of [
    run({ state: 'FAILED', errorCode: 'X' }),
    run({ state: 'VALIDATED', finishedAt: null }),
    run({ sourceSnapshotDigest: '' }),
  ]) {
    assert.throws(
      () => evaluate({ committedBaselineRun: baseline }),
      (error) => error instanceof ScheduledSyncAdmissionError && error.code === 'INVALID_COMMITTED_BASELINE',
    );
  }
});

test('malformed incomplete evidence fails closed instead of being ignored', () => {
  assert.throws(
    () => evaluate({ incompleteRuns: [run()] }),
    (error) => error instanceof ScheduledSyncAdmissionError && error.code === 'INVALID_INCOMPLETE_RUN',
  );

  const staging = run({
    id: '00000000-0000-0000-0000-000000000904',
    state: 'STAGING',
    finishedAt: null,
  });
  assert.throws(
    () => evaluate({ incompleteRuns: [staging, staging] }),
    (error) => error instanceof ScheduledSyncAdmissionError && error.code === 'DUPLICATE_INCOMPLETE_RUN_ID',
  );
});

test('empty or whitespace-normalized observed digest is rejected', () => {
  for (const observedSnapshotDigest of ['', ' digest-a', 'digest-a ']) {
    assert.throws(
      () => evaluate({ observedSnapshotDigest }),
      (error) => error instanceof ScheduledSyncAdmissionError && error.code === 'INVALID_OBSERVED_SNAPSHOT_DIGEST',
    );
  }
});
