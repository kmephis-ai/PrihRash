import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMigrationRun,
  markMigrationRunFailed,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';
import {
  MigrationRunPersistenceError,
  prepareMigrationRunFailedWrite,
  prepareMigrationRunValidatedWrite,
} from '../../dist/migration/migrationRunPersistence.js';

const RUN_ID = '00000000-0000-0000-0000-000000000501';

function stagingRun() {
  return createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T20:00:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: {
      rowsSeen: 12,
      rowsNew: 12,
      rowsChanged: 0,
      rowsMissing: 0,
      rowsAmbiguous: 0,
    },
  });
}

test('prepares conditional STAGING to VALIDATED lifecycle update', () => {
  const staging = stagingRun();
  const validated = markMigrationRunValidated(staging);
  const write = prepareMigrationRunValidatedWrite(staging, validated);

  assert.equal(write.statement.kind, 'WRITE');
  assert.equal(write.statement.text.startsWith('UPDATE migration_runs SET state = $state'), true);
  assert.equal(write.statement.parameters.id.type, 'Uuid');
  assert.equal(write.statement.parameters.state.value, 'VALIDATED');
  assert.equal(write.statement.parameters.expected_state.value, 'STAGING');
  assert.equal(write.statement.parameters.source_snapshot_digest.value, 'synthetic-snapshot-digest');
  assert.equal(write.statement.parameters.finished_at.value, null);
  assert.equal(write.statement.parameters.error_code.value, null);
  assert.equal(write.estimatedParameterBytes > 0, true);
  assert.equal(Object.isFrozen(write), true);
});

test('prepares FAILED transition with the exact previous state as compare guard', () => {
  const staging = stagingRun();
  const validated = markMigrationRunValidated(staging);

  for (const previous of [staging, validated]) {
    const failed = markMigrationRunFailed(previous, '2026-09-06T20:01:00Z', 'SYNTHETIC_FAILURE');
    const write = prepareMigrationRunFailedWrite(previous, failed);
    assert.equal(write.statement.parameters.expected_state.value, previous.state);
    assert.equal(write.statement.parameters.state.value, 'FAILED');
    assert.equal(write.statement.parameters.finished_at.value, '2026-09-06T20:01:00Z');
    assert.equal(write.statement.parameters.error_code.value, 'SYNTHETIC_FAILURE');
  }
});

test('fails closed if immutable run evidence changes between lifecycle states', () => {
  const staging = stagingRun();
  const validated = { ...markMigrationRunValidated(staging), rowsSeen: 13 };
  assert.throws(
    () => prepareMigrationRunValidatedWrite(staging, validated),
    (error) => error instanceof MigrationRunPersistenceError
      && error.code === 'RUN_IMMUTABLE_FIELDS_CHANGED',
  );
});

test('fails closed on invalid lifecycle direction or empty failure code', () => {
  const staging = stagingRun();
  assert.throws(
    () => prepareMigrationRunValidatedWrite(markMigrationRunValidated(staging), markMigrationRunValidated(staging)),
    (error) => error instanceof MigrationRunPersistenceError
      && error.code === 'INVALID_LIFECYCLE_TRANSITION',
  );

  const invalidFailed = {
    ...markMigrationRunFailed(staging, '2026-09-06T20:01:00Z', 'SYNTHETIC_FAILURE'),
    errorCode: '   ',
  };
  assert.throws(
    () => prepareMigrationRunFailedWrite(staging, invalidFailed),
    (error) => error instanceof MigrationRunPersistenceError
      && error.code === 'INVALID_FAILED_RUN',
  );
});
