import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter, writeStatement } from '../../dist/integration/ydb/adapter.js';
import { uuidParameter } from '../../dist/integration/ydb/parameters.js';
import { AtomicPromotionError, promoteAtomicDelta } from '../../dist/migration/atomicPromotion.js';
import { createMigrationRun, markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';

const RUN_ID = '00000000-0000-0000-0000-000000009101';
const ENTITY_ID = '00000000-0000-0000-0000-000000009102';
const FINISHED_AT = '2026-09-07T09:35:00.000Z';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T09:34:00.000Z',
    sourceSnapshotDigest: 'synthetic-marker-guard',
    counters: { rowsSeen: 1, rowsNew: 0, rowsChanged: 1, rowsMissing: 0, rowsAmbiguous: 0 },
  }));
}

function deltaWrite() {
  return Object.freeze({
    statement: writeStatement(
      'UPDATE source_records SET state = $state WHERE id = $id RETURNING id',
      { id: uuidParameter(ENTITY_ID), state: { type: 'Utf8', value: 'MISSING' } },
    ),
    estimatedParameterBytes: 64,
    expectedReturnedRowCount: 1,
  });
}

test('marker precondition miss rolls back already successful delta write', async () => {
  const events = [];
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      events.push('begin');
      try {
        const value = await work({
          async execute(statement) {
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) {
              events.push('marker-miss');
              return { rows: [] };
            }
            events.push('delta-success');
            return { rows: [{ id: ENTITY_ID }] };
          },
        });
        events.push('commit');
        return value;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  });

  const run = validatedRun();
  await assert.rejects(
    () => promoteAtomicDelta(adapter, run, [deltaWrite()], FINISHED_AT),
    (error) => error instanceof AtomicPromotionError && error.code === 'COMMIT_MARKER_PRECONDITION_FAILED',
  );

  assert.equal(run.state, 'VALIDATED');
  assert.deepEqual(events, ['begin', 'delta-success', 'marker-miss', 'rollback']);
});

test('marker exact predicates include immutable run evidence and lifecycle null guards', async () => {
  let marker;
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) {
            marker = statement;
            return { rows: [{ id: RUN_ID }] };
          }
          return { rows: [{ id: ENTITY_ID }] };
        },
      });
    },
  });

  const run = validatedRun();
  const result = await promoteAtomicDelta(adapter, run, [deltaWrite()], FINISHED_AT);
  assert.equal(result.status, 'COMMITTED');
  assert.match(marker.text, /source_snapshot_digest = \$source_snapshot_digest/);
  assert.match(marker.text, /rows_seen = \$rows_seen/);
  assert.match(marker.text, /rows_new = \$rows_new/);
  assert.match(marker.text, /rows_changed = \$rows_changed/);
  assert.match(marker.text, /rows_missing = \$rows_missing/);
  assert.match(marker.text, /rows_ambiguous = \$rows_ambiguous/);
  assert.match(marker.text, /finished_at IS NULL AND error_code IS NULL RETURNING id$/);
  assert.deepEqual(marker.parameters.source_snapshot_digest, { type: 'String', value: run.sourceSnapshotDigest });
  assert.deepEqual(marker.parameters.rows_seen, { type: 'Uint64', value: 1n });
});
