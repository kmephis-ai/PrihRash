import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatement } from '../../dist/integration/ydb/adapter.js';
import {
  ControlledInitialRebuildError,
  planControlledInitialRebuild,
} from '../../dist/migration/initialControlledRebuild.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const RUN_ID = '00000000-0000-0000-0000-000000004001';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T21:30:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 4, rowsNew: 4, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  }));
}

function prepared(role, sourceRecordId, estimatedParameterBytes) {
  return Object.freeze({
    role,
    sourceRecordId,
    statement: writeStatement(
      role === 'TRANSACTION' ? 'UPSERT INTO transactions (id) VALUES ($id)' : 'UPSERT INTO source_records (id) VALUES ($id)',
      {},
    ),
    estimatedParameterBytes,
  });
}

function oversizedWrites() {
  return Object.freeze([
    prepared('TRANSACTION', '00000000-0000-0000-0000-000000004101', 100_000),
    prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004101', 100_000),
    prepared('TRANSACTION', '00000000-0000-0000-0000-000000004102', 100_000),
    prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004102', 100_000),
    prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004103', 100_000),
    prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004104', 100_000),
  ]);
}

test('plans bounded staging batches and one atomic two-table replacement for initial-only rebuild', () => {
  const plan = planControlledInitialRebuild(validatedRun(), oversizedWrites(), null);

  assert.equal(plan.runId, RUN_ID);
  assert.deepEqual(plan.stagingTables, {
    transactions: 'rebuild/r_00000000000000000000000000004001/transactions',
    sourceRecords: 'rebuild/r_00000000000000000000000000004001/source_records',
  });
  assert.equal(plan.batches.length, 2);
  assert.deepEqual(plan.batches.map((batch) => batch.writes.length), [5, 1]);
  assert.equal(plan.batches.every((batch) => batch.estimatedParameterBytes <= 512 * 1024), true);
  assert.deepEqual(plan.replacements, [
    {
      source: 'rebuild/r_00000000000000000000000000004001/transactions',
      destination: 'transactions',
      replace: true,
    },
    {
      source: 'rebuild/r_00000000000000000000000000004001/source_records',
      destination: 'source_records',
      replace: true,
    },
  ]);
  assert.equal(plan.expectedTransactionCount, 2);
  assert.equal(plan.expectedSourceRecordCount, 4);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.batches), true);
});

test('fails closed when a previous verified shadow exists', () => {
  assert.throws(
    () => planControlledInitialRebuild(
      validatedRun(),
      oversizedWrites(),
      '00000000-0000-0000-0000-000000009999',
    ),
    (error) => error instanceof ControlledInitialRebuildError
      && error.code === 'PREVIOUS_VERIFIED_SHADOW_PRESENT',
  );
});

test('does not use controlled path when ordinary atomic route is still eligible', () => {
  assert.throws(
    () => planControlledInitialRebuild(
      validatedRun(),
      [prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004101', 1_000)],
      null,
    ),
    (error) => error instanceof ControlledInitialRebuildError
      && error.code === 'ORDINARY_ATOMIC_ROUTE_ELIGIBLE',
  );
});

test('rejects a single staging write that cannot fit the calibrated bounded transaction', () => {
  assert.throws(
    () => planControlledInitialRebuild(
      validatedRun(),
      [
        prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004101', 600_000),
        prepared('SOURCE_RECORD', '00000000-0000-0000-0000-000000004102', 1_000),
      ],
      null,
    ),
    (error) => error instanceof ControlledInitialRebuildError
      && error.code === 'STAGING_WRITE_TOO_LARGE',
  );
});

test('requires a validated run and non-empty write set', () => {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T21:30:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 1, rowsNew: 1, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  });

  assert.throws(
    () => planControlledInitialRebuild(staging, oversizedWrites(), null),
    (error) => error instanceof ControlledInitialRebuildError && error.code === 'RUN_NOT_VALIDATED',
  );
  assert.throws(
    () => planControlledInitialRebuild(validatedRun(), [], null),
    (error) => error instanceof ControlledInitialRebuildError && error.code === 'NO_CURRENT_WRITES',
  );
});
