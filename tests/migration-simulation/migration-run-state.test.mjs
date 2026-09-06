import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MigrationRunStateError,
  createMigrationRun,
  isVerifiedShadowEligible,
  markMigrationRunCommitted,
  markMigrationRunFailed,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const COUNTERS = Object.freeze({
  rowsSeen: 10,
  rowsNew: 2,
  rowsChanged: 3,
  rowsMissing: 1,
  rowsAmbiguous: 4,
});

function stagingRun() {
  return createMigrationRun({
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: '2026-09-06T17:00:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: COUNTERS,
  });
}

function expectIllegalTransition(fromRun, transition, to) {
  assert.throws(
    transition,
    (error) => (
      error instanceof MigrationRunStateError
      && error.code === 'ILLEGAL_MIGRATION_RUN_TRANSITION'
      && error.from === fromRun.state
      && error.to === to
    ),
  );
}

test('MigrationRun always starts in STAGING and is not verified', () => {
  const run = stagingRun();

  assert.equal(run.state, 'STAGING');
  assert.equal(run.finishedAt, null);
  assert.equal(run.errorCode, null);
  assert.equal(isVerifiedShadowEligible(run), false);
  assert.equal(Object.isFrozen(run), true);
});

test('legal happy path is STAGING to VALIDATED to COMMITTED', () => {
  const staging = stagingRun();
  const validated = markMigrationRunValidated(staging);
  const committed = markMigrationRunCommitted(validated, '2026-09-06T17:01:00Z');

  assert.equal(staging.state, 'STAGING');
  assert.equal(validated.state, 'VALIDATED');
  assert.equal(validated.finishedAt, null);
  assert.equal(isVerifiedShadowEligible(validated), false);
  assert.equal(committed.state, 'COMMITTED');
  assert.equal(committed.finishedAt, '2026-09-06T17:01:00Z');
  assert.equal(isVerifiedShadowEligible(committed), true);
});

test('STAGING cannot bypass validation and become COMMITTED', () => {
  const run = stagingRun();

  expectIllegalTransition(
    run,
    () => markMigrationRunCommitted(run, '2026-09-06T17:01:00Z'),
    'COMMITTED',
  );
  assert.equal(run.state, 'STAGING');
  assert.equal(isVerifiedShadowEligible(run), false);
});

test('run may fail from STAGING or VALIDATED but FAILED is never verified', () => {
  const staging = stagingRun();
  const failedDuringStaging = markMigrationRunFailed(
    staging,
    '2026-09-06T17:00:30Z',
    'SOURCE_SCHEMA_MISMATCH',
  );
  const validated = markMigrationRunValidated(staging);
  const failedAfterValidation = markMigrationRunFailed(
    validated,
    '2026-09-06T17:00:45Z',
    'RECONCILIATION_FAILED',
  );

  assert.equal(failedDuringStaging.state, 'FAILED');
  assert.equal(failedDuringStaging.errorCode, 'SOURCE_SCHEMA_MISMATCH');
  assert.equal(isVerifiedShadowEligible(failedDuringStaging), false);
  assert.equal(failedAfterValidation.state, 'FAILED');
  assert.equal(failedAfterValidation.errorCode, 'RECONCILIATION_FAILED');
  assert.equal(isVerifiedShadowEligible(failedAfterValidation), false);
});

test('COMMITTED and FAILED are terminal', () => {
  const validated = markMigrationRunValidated(stagingRun());
  const committed = markMigrationRunCommitted(validated, '2026-09-06T17:01:00Z');
  const failed = markMigrationRunFailed(validated, '2026-09-06T17:01:00Z', 'SYNTHETIC_FAILURE');

  expectIllegalTransition(committed, () => markMigrationRunValidated(committed), 'VALIDATED');
  expectIllegalTransition(
    committed,
    () => markMigrationRunFailed(committed, '2026-09-06T17:02:00Z', 'LATE_FAILURE'),
    'FAILED',
  );
  expectIllegalTransition(failed, () => markMigrationRunValidated(failed), 'VALIDATED');
  expectIllegalTransition(
    failed,
    () => markMigrationRunCommitted(failed, '2026-09-06T17:02:00Z'),
    'COMMITTED',
  );
});

test('lifecycle transitions preserve source identity and reconciliation evidence', () => {
  const staging = stagingRun();
  const validated = markMigrationRunValidated(staging);
  const committed = markMigrationRunCommitted(validated, '2026-09-06T17:01:00Z');

  for (const field of [
    'id',
    'startedAt',
    'sourceSnapshotDigest',
    'rowsSeen',
    'rowsNew',
    'rowsChanged',
    'rowsMissing',
    'rowsAmbiguous',
  ]) {
    assert.equal(validated[field], staging[field]);
    assert.equal(committed[field], staging[field]);
  }
});

test('illegal transition is fail-closed and does not mutate the source object', () => {
  const staging = stagingRun();
  const before = structuredClone(staging);

  expectIllegalTransition(
    staging,
    () => markMigrationRunCommitted(staging, '2026-09-06T17:01:00Z'),
    'COMMITTED',
  );

  assert.deepEqual(staging, before);
  assert.equal(Object.isFrozen(staging), true);
});
