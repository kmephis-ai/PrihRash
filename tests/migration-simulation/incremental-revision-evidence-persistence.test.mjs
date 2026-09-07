import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { InitialRevisionEvidenceError } from '../../dist/migration/initialSourceRevisionEvidenceExecutor.js';
import {
  executeIncrementalRevisionEvidenceBatches,
  planIncrementalRevisionEvidenceBatches,
  prepareIncrementalRevisionEvidenceWrites,
} from '../../dist/migration/incrementalRevisionEvidencePersistence.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000002001';
const RUN_ID = '00000000-0000-0000-0000-000000002002';
const OBSERVED_AT = '2026-09-07T05:20:00.000Z';

function plan(rawPayload = JSON.stringify({ synthetic: true })) {
  return {
    revisions: [
      {
        sourceRecordId: SOURCE_ID,
        revision: 3,
        migrationRunId: RUN_ID,
        observedAt: OBSERVED_AT,
        rowHint: 7,
        rowDigest: 'synthetic-row-digest',
        changeClass: 'OWNER_CORRECTION',
        rawPayload,
      },
    ],
  };
}

test('compiles only schema-aligned source_record_revisions staging writes with typed parameters', () => {
  const writes = prepareIncrementalRevisionEvidenceWrites(plan());
  assert.equal(writes.length, 1);
  const write = writes[0];

  assert.equal(write.role, 'STAGING_EVIDENCE');
  assert.match(write.statement.text, /^UPSERT INTO source_record_revisions /);
  assert.doesNotMatch(write.statement.text, /^UPSERT INTO source_records /);
  assert.doesNotMatch(write.statement.text, /\btransactions\b/);
  assert.equal(write.statement.kind, 'WRITE');
  assert.deepEqual(write.statement.parameters.source_record_id, { type: 'Uuid', value: SOURCE_ID });
  assert.deepEqual(write.statement.parameters.revision, { type: 'Uint64', value: 3n });
  assert.deepEqual(write.statement.parameters.migration_run_id, { type: 'Uuid', value: RUN_ID });
  assert.deepEqual(write.statement.parameters.observed_at, { type: 'Timestamp', value: OBSERVED_AT });
  assert.deepEqual(write.statement.parameters.row_hint, { type: 'Uint64', value: 7n });
  assert.deepEqual(write.statement.parameters.row_digest, { type: 'String', value: 'synthetic-row-digest' });
  assert.deepEqual(write.statement.parameters.change_class, { type: 'Utf8', value: 'OWNER_CORRECTION' });
  assert.deepEqual(write.statement.parameters.raw_payload, {
    type: 'JsonDocument',
    value: JSON.stringify({ synthetic: true }),
  });
  assert.ok(write.estimatedParameterBytes > 0);
  assert.equal(Object.isFrozen(writes), true);
  assert.equal(Object.isFrozen(write), true);
});

test('reuses the existing bounded revision evidence batch planner and executor', async () => {
  const writes = prepareIncrementalRevisionEvidenceWrites(plan());
  const batches = planIncrementalRevisionEvidenceBatches(writes);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].writes.length, 1);
  assert.equal(batches[0].writes[0], writes[0]);

  const events = [];
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      events.push('begin');
      const result = await work({
        async execute(statement) {
          events.push(statement.text.startsWith('UPSERT INTO source_record_revisions ') ? 'revision-write' : 'unexpected');
          return { rows: [] };
        },
      });
      events.push('commit');
      return result;
    },
  });

  await executeIncrementalRevisionEvidenceBatches(adapter, batches);
  assert.deepEqual(events, ['begin', 'revision-write', 'commit']);
});

test('oversized single incremental revision evidence write fails the existing calibrated bounded preflight', () => {
  const hugePayload = JSON.stringify({ synthetic: 'x'.repeat(600 * 1024) });
  const writes = prepareIncrementalRevisionEvidenceWrites(plan(hugePayload));
  assert.ok(writes[0].estimatedParameterBytes > 512 * 1024);

  assert.throws(
    () => planIncrementalRevisionEvidenceBatches(writes),
    (error) => error instanceof InitialRevisionEvidenceError
      && error.code === 'EVIDENCE_WRITE_TOO_LARGE',
  );
});

test('empty evidence plan produces no writes, batches or transactions', async () => {
  const writes = prepareIncrementalRevisionEvidenceWrites({ revisions: [] });
  const batches = planIncrementalRevisionEvidenceBatches(writes);
  assert.deepEqual(writes, []);
  assert.deepEqual(batches, []);

  let transactionCount = 0;
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite() {
      transactionCount += 1;
      throw new Error('transaction not expected');
    },
  });
  await executeIncrementalRevisionEvidenceBatches(adapter, batches);
  assert.equal(transactionCount, 0);
});
