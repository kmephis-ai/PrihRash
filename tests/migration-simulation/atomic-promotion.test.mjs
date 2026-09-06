import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YdbAdapter,
  YdbCommitOutcomeUnknownError,
  YdbTransportCommitOutcomeUnknownError,
  readStatement,
  writeStatement,
} from '../../dist/integration/ydb/adapter.js';
import { utf8Parameter, uuidParameter } from '../../dist/integration/ydb/parameters.js';
import {
  AtomicPromotionError,
  COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES,
  PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT,
  PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
  promoteAtomicDelta,
} from '../../dist/migration/atomicPromotion.js';
import {
  createMigrationRun,
  markMigrationRunCommitted,
  markMigrationRunFailed,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const FINISHED_AT = '2026-09-06T17:45:00Z';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T17:40:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: {
      rowsSeen: 10,
      rowsNew: 1,
      rowsChanged: 2,
      rowsMissing: 0,
      rowsAmbiguous: 0,
    },
  }));
}

function createFakeTransport(options = {}) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead(statement) {
        events.push(['read', statement]);
        return { rows: [] };
      },
      async serializableReadWrite(work) {
        events.push(['begin']);
        const transaction = Object.freeze({
          async execute(statement) {
            events.push(['execute', statement]);
            if (options.executeError) throw options.executeError;
            return { rows: [] };
          },
        });
        let value;
        try {
          value = await work(transaction);
        } catch (error) {
          events.push(['rollback']);
          throw error;
        }
        events.push(['commit']);
        if (options.commitError) {
          throw new YdbTransportCommitOutcomeUnknownError(options.commitError);
        }
        return value;
      },
    },
  };
}

function deltaWrite(label, estimatedParameterBytes = 128) {
  return {
    statement: writeStatement(
      'UPSERT INTO source_records (id, state) VALUES ($id, $state)',
      {
        id: uuidParameter('123e4567-e89b-42d3-a456-426614174001'),
        state: utf8Parameter(label),
      },
    ),
    estimatedParameterBytes,
  };
}

function expectAtomicPromotionError(code, promiseFactory) {
  return assert.rejects(
    promiseFactory,
    (error) => error instanceof AtomicPromotionError && error.code === code,
  );
}

test('ordinary delta and COMMITTED marker execute in one transaction with marker last', async () => {
  const run = validatedRun();
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);

  const result = await promoteAtomicDelta(
    adapter,
    run,
    [deltaWrite('ACTIVE'), deltaWrite('MISSING')],
    FINISHED_AT,
  );

  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.run.state, 'COMMITTED');
  assert.equal(run.state, 'VALIDATED');
  assert.deepEqual(fake.events.map(([name]) => name), [
    'begin',
    'execute',
    'execute',
    'execute',
    'commit',
  ]);

  const executed = fake.events.filter(([name]) => name === 'execute').map(([, statement]) => statement);
  assert.equal(executed.at(-1).text.startsWith('UPDATE migration_runs SET state = $state'), true);
  assert.equal(executed.at(-1).parameters.id.value, RUN_ID);
  assert.equal(executed.at(-1).parameters.state.value, 'COMMITTED');
  assert.equal(executed.at(-1).parameters.expected_state.value, 'VALIDATED');
});

test('aggregate parameter estimate above 2 MiB fails before transaction begin', async () => {
  const run = validatedRun();
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);
  const tooLarge = PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT - COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES + 1;

  const result = await promoteAtomicDelta(adapter, run, [deltaWrite('ACTIVE', tooLarge)], FINISHED_AT);

  assert.equal(result.status, 'FAILED_PRECHECK');
  assert.equal(result.errorCode, 'PROMOTION_TOO_LARGE');
  assert.equal(result.run.state, 'FAILED');
  assert.equal(result.run.errorCode, 'PROMOTION_TOO_LARGE');
  assert.equal(run.state, 'VALIDATED');
  assert.deepEqual(fake.events, []);
});

test('query text above 8 KiB pre-live guard fails before transaction begin', async () => {
  const run = validatedRun();
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);
  const longStatement = writeStatement('X'.repeat(PRELIVE_PROMOTION_QUERY_BYTES_LIMIT + 1));

  const result = await promoteAtomicDelta(
    adapter,
    run,
    [{ statement: longStatement, estimatedParameterBytes: 0 }],
    FINISHED_AT,
  );

  assert.equal(result.status, 'FAILED_PRECHECK');
  assert.equal(result.run.errorCode, 'PROMOTION_TOO_LARGE');
  assert.deepEqual(fake.events, []);
});

test('only VALIDATED run may enter promotion', async () => {
  const staging = createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-06T17:40:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 0, rowsNew: 0, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 },
  });
  const validated = markMigrationRunValidated(staging);
  const failed = markMigrationRunFailed(validated, FINISHED_AT, 'SYNTHETIC_FAILURE');
  const committed = markMigrationRunCommitted(validated, FINISHED_AT);

  for (const run of [staging, failed, committed]) {
    const fake = createFakeTransport();
    const adapter = new YdbAdapter(fake.transport);
    await expectAtomicPromotionError(
      'RUN_NOT_VALIDATED',
      () => promoteAtomicDelta(adapter, run, [deltaWrite('ACTIVE')], FINISHED_AT),
    );
    assert.deepEqual(fake.events, []);
  }
});

test('READ statement and invalid size estimate fail before begin', async () => {
  const run = validatedRun();

  {
    const fake = createFakeTransport();
    const adapter = new YdbAdapter(fake.transport);
    await expectAtomicPromotionError(
      'INVALID_PROMOTION_STATEMENT',
      () => promoteAtomicDelta(
        adapter,
        run,
        [{ statement: readStatement('SELECT 1'), estimatedParameterBytes: 0 }],
        FINISHED_AT,
      ),
    );
    assert.deepEqual(fake.events, []);
  }

  for (const estimate of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const fake = createFakeTransport();
    const adapter = new YdbAdapter(fake.transport);
    await expectAtomicPromotionError(
      'INVALID_PROMOTION_ESTIMATE',
      () => promoteAtomicDelta(adapter, run, [deltaWrite('ACTIVE', estimate)], FINISHED_AT),
    );
    assert.deepEqual(fake.events, []);
  }
});

test('statement failure rolls back transaction and leaves run VALIDATED', async () => {
  const run = validatedRun();
  const writeError = new Error('synthetic delta write failed');
  const fake = createFakeTransport({ executeError: writeError });
  const adapter = new YdbAdapter(fake.transport);

  await assert.rejects(
    () => promoteAtomicDelta(adapter, run, [deltaWrite('ACTIVE')], FINISHED_AT),
    (error) => error === writeError,
  );

  assert.equal(run.state, 'VALIDATED');
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'execute', 'rollback']);
});

test('unknown commit outcome does not auto-mark run FAILED or COMMITTED', async () => {
  const run = validatedRun();
  const commitError = new Error('synthetic commit transport failure');
  const fake = createFakeTransport({ commitError });
  const adapter = new YdbAdapter(fake.transport);

  await assert.rejects(
    () => promoteAtomicDelta(adapter, run, [deltaWrite('ACTIVE')], FINISHED_AT),
    (error) => error instanceof YdbCommitOutcomeUnknownError && error.cause === commitError,
  );

  assert.equal(run.state, 'VALIDATED');
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'execute', 'execute', 'commit']);
});
