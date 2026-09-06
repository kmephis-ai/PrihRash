import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { createMigrationRun } from '../../dist/migration/migrationRunState.js';
import {
  InitialRunCounterRefinementError,
  refineInitialRunCounters,
} from '../../dist/migration/initialRunCounterRefinement.js';
import {
  InitialRunCounterRefinementPersistenceError,
  executeInitialRunCounterRefinementWrite,
  prepareInitialRunCounterRefinementWrite,
} from '../../dist/migration/initialRunCounterRefinementPersistence.js';
import { MigrationRunLifecycleExecutorError } from '../../dist/migration/migrationRunLifecycleExecutor.js';

const RUN_ID = '00000000-0000-0000-0000-000000000951';

function staging(overrides = {}) {
  return Object.freeze({
    ...createMigrationRun({
      id: RUN_ID,
      startedAt: '2026-09-06T21:05:00Z',
      sourceSnapshotDigest: 'synthetic-snapshot-digest',
      counters: { rowsSeen: 5, rowsNew: 5, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
    }),
    ...overrides,
  });
}

function projection(rowsSeen = 5, ambiguous = 2) {
  return { counters: { rowsSeen, ambiguous } };
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

test('refines only rowsAmbiguous from complete initial projection evidence', () => {
  const previous = staging();
  const refined = refineInitialRunCounters(previous, projection());

  assert.deepEqual(refined, { ...previous, rowsAmbiguous: 2 });
  assert.equal(Object.isFrozen(refined), true);
  assert.equal(previous.rowsAmbiguous, 0);
});

for (const [name, run, projected, code] of [
  ['non-STAGING run', staging({ state: 'VALIDATED' }), projection(), 'RUN_NOT_STAGING'],
  ['non-initial counters', staging({ rowsChanged: 1 }), projection(), 'INITIAL_COUNTERS_INCONSISTENT'],
  ['row count mismatch', staging(), projection(4, 2), 'PROJECTION_ROW_COUNT_MISMATCH'],
]) {
  test(`counter refinement fails closed for ${name}`, () => {
    assert.throws(
      () => refineInitialRunCounters(run, projected),
      (error) => error instanceof InitialRunCounterRefinementError && error.code === code,
    );
  });
}

test('prepared refinement is conditional on exact previous STAGING evidence', () => {
  const previous = staging();
  const refined = refineInitialRunCounters(previous, projection());
  const prepared = prepareInitialRunCounterRefinementWrite(previous, refined);

  assert.equal(prepared.statement.kind, 'WRITE');
  assert.equal(prepared.statement.text.startsWith('UPDATE migration_runs SET rows_ambiguous = $rows_ambiguous '), true);
  assert.equal(prepared.statement.parameters.expected_state.value, 'STAGING');
  assert.equal(prepared.statement.parameters.expected_rows_ambiguous.value, 0n);
  assert.equal(prepared.statement.parameters.rows_ambiguous.value, 2n);
  assert.equal(prepared.estimatedParameterBytes > 0, true);
});

test('counter persistence rejects no-op and unrelated field changes', () => {
  const previous = staging();
  assert.throws(
    () => prepareInitialRunCounterRefinementWrite(previous, previous),
    (error) => error instanceof InitialRunCounterRefinementPersistenceError && error.code === 'COUNTER_NOT_CHANGED',
  );
  assert.throws(
    () => prepareInitialRunCounterRefinementWrite(previous, { ...previous, rowsAmbiguous: 2, rowsSeen: 6 }),
    (error) => error instanceof InitialRunCounterRefinementPersistenceError
      && error.code === 'RUN_IMMUTABLE_FIELDS_CHANGED',
  );
});

test('commits refined counter only after matching same-transaction read-back', async () => {
  const previous = staging();
  const refined = refineInitialRunCounters(previous, projection());
  const prepared = prepareInitialRunCounterRefinementWrite(previous, refined);
  const fake = fakeTransport([observedRow(refined)]);

  const result = await executeInitialRunCounterRefinementWrite(
    new YdbAdapter(fake.transport),
    prepared,
    refined,
  );

  assert.equal(result.rowsAmbiguous, 2);
  assert.deepEqual(fake.events, ['begin', 'write', 'readback', 'commit']);
});

test('lost-update/read-back mismatch rolls back counter refinement', async () => {
  const previous = staging();
  const refined = refineInitialRunCounters(previous, projection());
  const prepared = prepareInitialRunCounterRefinementWrite(previous, refined);
  const fake = fakeTransport([observedRow(previous)]);

  await assert.rejects(
    () => executeInitialRunCounterRefinementWrite(new YdbAdapter(fake.transport), prepared, refined),
    (error) => error instanceof MigrationRunLifecycleExecutorError
      && error.code === 'RUN_TRANSITION_EVIDENCE_MISMATCH',
  );
  assert.deepEqual(fake.events.at(-1), 'rollback');
});
