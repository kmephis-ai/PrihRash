import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YdbAdapter,
  YdbCommitOutcomeUnknownError,
  YdbTransportCommitOutcomeUnknownError,
} from '../../dist/integration/ydb/adapter.js';
import {
  commitControlledInitialRun,
  recoverControlledInitialCommitMarker,
  ControlledInitialCommitMarkerError,
} from '../../dist/migration/initialControlledRebuildCommitMarker.js';
import { INITIAL_RECONCILIATION_CHECKS } from '../../dist/migration/initialValidationGate.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const RUN_ID = '00000000-0000-0000-0000-000000009701';
const FINISHED_AT = '2026-09-06T22:05:00Z';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T22:00:00Z',
    sourceSnapshotDigest: 'synthetic-commit-marker-digest',
    counters: { rowsSeen: 2, rowsNew: 2, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  }));
}

function matchedEvidence() {
  return Object.freeze({
    checks: Object.freeze(Object.fromEntries(INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED']))),
    unexplainedHighImpactMismatchCount: 0,
  });
}

function markerTransport({ markerState = 'COMMITTED', unknownCommit = false } = {}) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead(statement) {
        events.push(['read', statement]);
        return { rows: [{
          state: markerState,
          finished_at: markerState === 'COMMITTED' ? FINISHED_AT : null,
          error_code: null,
        }] };
      },
      async serializableReadWrite(work) {
        events.push(['begin']);
        let execution = 0;
        const transaction = {
          async execute(statement) {
            execution += 1;
            events.push(['execute', statement]);
            if (execution === 1) return { rows: [] };
            return { rows: [{
              state: markerState,
              finished_at: markerState === 'COMMITTED' ? FINISHED_AT : null,
              error_code: null,
            }] };
          },
        };
        const result = await work(transaction);
        if (unknownCommit) {
          throw new YdbTransportCommitOutcomeUnknownError(new Error('synthetic marker ambiguity'));
        }
        events.push(['commit']);
        return result;
      },
    },
  };
}

function expectMarkerCode(code, work) {
  return assert.rejects(
    work,
    (error) => error instanceof ControlledInitialCommitMarkerError && error.code === code,
  );
}

test('commits only after exact current verification and verifies read-your-write marker state', async () => {
  const fake = markerTransport();
  const run = await commitControlledInitialRun(
    new YdbAdapter(fake.transport),
    validatedRun(),
    matchedEvidence(),
    FINISHED_AT,
  );

  assert.equal(run.state, 'COMMITTED');
  assert.equal(run.finishedAt, FINISHED_AT);
  assert.equal(run.errorCode, null);
  const executions = fake.events.filter(([kind]) => kind === 'execute');
  assert.equal(executions.length, 2);
  assert.equal(executions[0][1].kind, 'WRITE');
  assert.match(executions[0][1].text, /WHERE id = \$id AND state = \$expected_state/);
  assert.equal(executions[1][1].kind, 'READ');
  assert.match(executions[1][1].text, /FROM migration_runs WHERE id = \$id/);
});

test('mismatched or not-checked current verification prevents any marker mutation', async () => {
  for (const evidence of [
    Object.freeze({ ...matchedEvidence(), unexplainedHighImpactMismatchCount: 1 }),
    Object.freeze({
      ...matchedEvidence(),
      checks: Object.freeze({ ...matchedEvidence().checks, TOTALS_BY_TYPE: 'MISMATCH' }),
    }),
    Object.freeze({
      ...matchedEvidence(),
      checks: Object.freeze({ ...matchedEvidence().checks, ACCOUNT_AGGREGATES: 'NOT_CHECKED' }),
    }),
  ]) {
    const fake = markerTransport();
    await expectMarkerCode('CURRENT_VERIFICATION_NOT_MATCHED', () => commitControlledInitialRun(
      new YdbAdapter(fake.transport), validatedRun(), evidence, FINISHED_AT,
    ));
    assert.equal(fake.events.length, 0);
  }
});

test('conditional update conflict is detected by read-your-write verification', async () => {
  const fake = markerTransport({ markerState: 'VALIDATED' });
  await expectMarkerCode('MARKER_TRANSITION_CONFLICT', () => commitControlledInitialRun(
    new YdbAdapter(fake.transport), validatedRun(), matchedEvidence(), FINISHED_AT,
  ));
});

test('unknown marker commit outcome remains recovery-required and does not claim COMMITTED', async () => {
  const fake = markerTransport({ unknownCommit: true });
  await assert.rejects(
    () => commitControlledInitialRun(
      new YdbAdapter(fake.transport), validatedRun(), matchedEvidence(), FINISHED_AT,
    ),
    (error) => error instanceof YdbCommitOutcomeUnknownError && error.code === 'COMMIT_OUTCOME_UNKNOWN',
  );
  assert.equal(fake.events.filter(([kind]) => kind === 'begin').length, 1);
});

test('recovery reads marker state without writes and distinguishes committed from still validated', async () => {
  const committed = markerTransport({ markerState: 'COMMITTED' });
  assert.deepEqual(
    await recoverControlledInitialCommitMarker(new YdbAdapter(committed.transport), RUN_ID, FINISHED_AT),
    { status: 'COMMITTED' },
  );
  assert.deepEqual(committed.events.map(([kind]) => kind), ['read']);

  const validated = markerTransport({ markerState: 'VALIDATED' });
  assert.deepEqual(
    await recoverControlledInitialCommitMarker(new YdbAdapter(validated.transport), RUN_ID, FINISHED_AT),
    { status: 'NOT_COMMITTED' },
  );
  assert.deepEqual(validated.events.map(([kind]) => kind), ['read']);
});

test('recovery fails closed on unexpected marker state or conflicting committed timestamp', async () => {
  const failed = markerTransport({ markerState: 'FAILED' });
  await expectMarkerCode('MALFORMED_MARKER_ROW', () => recoverControlledInitialCommitMarker(
    new YdbAdapter(failed.transport), RUN_ID, FINISHED_AT,
  ));

  const conflicting = markerTransport({ markerState: 'COMMITTED' });
  conflicting.transport.executeRead = async () => ({ rows: [{
    state: 'COMMITTED', finished_at: '2026-09-06T22:06:00Z', error_code: null,
  }] });
  await expectMarkerCode('MALFORMED_MARKER_ROW', () => recoverControlledInitialCommitMarker(
    new YdbAdapter(conflicting.transport), RUN_ID, FINISHED_AT,
  ));
});

test('requires unfinished VALIDATED run before marker transaction', async () => {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T22:00:00Z',
    sourceSnapshotDigest: 'synthetic-commit-marker-digest',
    counters: { rowsSeen: 2, rowsNew: 2, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  });
  const fake = markerTransport();
  await expectMarkerCode('RUN_NOT_VALIDATED', () => commitControlledInitialRun(
    new YdbAdapter(fake.transport), staging, matchedEvidence(), FINISHED_AT,
  ));
  assert.equal(fake.events.length, 0);
});
