import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';
import { prepareMigrationRunValidatedWrite } from '../../dist/migration/migrationRunPersistence.js';
import {
  MigrationRunLifecycleExecutorError,
  executeMigrationRunLifecycleWrite,
} from '../../dist/migration/migrationRunLifecycleExecutor.js';

const RUN_ID = '00000000-0000-0000-0000-000000000601';

function runs() {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T20:05:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 3, rowsNew: 3, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  });
  return { staging, validated: markMigrationRunValidated(staging) };
}

function observedRow(run, overrides = {}) {
  return {
    state: run.state,
    finished_at: run.finishedAt,
    error_code: run.errorCode,
    source_snapshot_digest: run.sourceSnapshotDigest,
    rows_seen: BigInt(run.rowsSeen),
    rows_new: BigInt(run.rowsNew),
    rows_changed: BigInt(run.rowsChanged),
    rows_missing: BigInt(run.rowsMissing),
    rows_ambiguous: BigInt(run.rowsAmbiguous),
    ...overrides,
  };
}

function fakeTransport(readRows) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            events.push(statement.kind === 'WRITE' ? 'write' : 'readback');
            if (statement.kind === 'READ') return { rows: readRows };
            return { rows: [] };
          },
        };
        try {
          const value = await work(transaction);
          events.push('commit');
          return value;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    },
  };
}

test('commits lifecycle transition only after matching in-transaction read-back', async () => {
  const { staging, validated } = runs();
  const prepared = prepareMigrationRunValidatedWrite(staging, validated);
  const fake = fakeTransport([observedRow(validated)]);
  const result = await executeMigrationRunLifecycleWrite(new YdbAdapter(fake.transport), prepared, validated);

  assert.equal(result.state, 'VALIDATED');
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(fake.events, ['begin', 'write', 'readback', 'commit']);
});

test('zero-row conditional update cannot silently commit as successful transition', async () => {
  const { staging, validated } = runs();
  const prepared = prepareMigrationRunValidatedWrite(staging, validated);
  const fake = fakeTransport([]);

  await assert.rejects(
    () => executeMigrationRunLifecycleWrite(new YdbAdapter(fake.transport), prepared, validated),
    (error) => error instanceof MigrationRunLifecycleExecutorError
      && error.code === 'RUN_NOT_FOUND_AFTER_TRANSITION',
  );
  assert.deepEqual(fake.events, ['begin', 'write', 'readback', 'rollback']);
});

test('mismatched state/evidence rolls back instead of accepting stale or foreign run', async () => {
  const { staging, validated } = runs();
  const prepared = prepareMigrationRunValidatedWrite(staging, validated);
  const fake = fakeTransport([observedRow(validated, { state: 'STAGING' })]);

  await assert.rejects(
    () => executeMigrationRunLifecycleWrite(new YdbAdapter(fake.transport), prepared, validated),
    (error) => error instanceof MigrationRunLifecycleExecutorError
      && error.code === 'RUN_TRANSITION_EVIDENCE_MISMATCH',
  );
  assert.deepEqual(fake.events.at(-1), 'rollback');
});

test('multiple read-back rows fail closed as ambiguous', async () => {
  const { staging, validated } = runs();
  const prepared = prepareMigrationRunValidatedWrite(staging, validated);
  const row = observedRow(validated);
  const fake = fakeTransport([row, row]);

  await assert.rejects(
    () => executeMigrationRunLifecycleWrite(new YdbAdapter(fake.transport), prepared, validated),
    (error) => error instanceof MigrationRunLifecycleExecutorError
      && error.code === 'RUN_RESULT_AMBIGUOUS_AFTER_TRANSITION',
  );
});
