import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatement, YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  jsonDocumentParameter,
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../../dist/integration/ydb/parameters.js';
import {
  PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT,
  PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
} from '../../dist/migration/atomicPromotion.js';
import {
  InitialRevisionEvidenceError,
  executeInitialRevisionEvidenceBatches,
  planInitialRevisionEvidenceBatches,
} from '../../dist/migration/initialSourceRevisionEvidenceExecutor.js';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const OBSERVED_AT = '2026-09-01T00:00:00.000Z';
const REVISION_INSERT = 'INSERT INTO source_record_revisions '
  + '(source_record_id, revision, migration_run_id, observed_at, row_hint, row_digest, change_class, raw_payload) '
  + 'VALUES ($source_record_id, $revision, $migration_run_id, $observed_at, $row_hint, $row_digest, '
  + '$change_class, $raw_payload)';

function sourceId(index) {
  return `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`;
}

function evidenceWrite(bytes, index = 0) {
  return Object.freeze({
    role: 'STAGING_EVIDENCE',
    statement: writeStatement(REVISION_INSERT, {
      source_record_id: uuidParameter(sourceId(index)),
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(RUN_ID),
      observed_at: timestampParameter(OBSERVED_AT),
      row_hint: uint64Parameter(index + 2),
      row_digest: stringParameter(`digest-${index}`),
      change_class: utf8Parameter(null),
      raw_payload: jsonDocumentParameter(JSON.stringify({ index })),
    }),
    estimatedParameterBytes: bytes,
  });
}

test('greedily chunks staging revision evidence under calibrated transaction cap', () => {
  const writes = Array.from({ length: 5 }, (_, index) => evidenceWrite(150 * 1024, index));
  const batches = planInitialRevisionEvidenceBatches(writes);

  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map((batch) => batch.writes.length), [3, 2]);
  assert.equal(
    batches.every((batch) => batch.totalEstimatedParameterBytes <= PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT),
    true,
  );
  assert.equal(Object.isFrozen(batches), true);
  assert.equal(batches.every((batch) => Object.isFrozen(batch) && Object.isFrozen(batch.writes)), true);
});

test('uses the calibrated parameter-byte cap instead of an unrelated 50-row split', () => {
  const writes = Array.from({ length: 120 }, (_, index) => evidenceWrite(128, index));
  const batches = planInitialRevisionEvidenceBatches(writes);

  assert.deepEqual(batches.map((batch) => batch.writes.length), [120]);
  assert.equal(
    batches.every((batch) => batch.totalEstimatedParameterBytes <= PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT),
    true,
  );
});

test('rejects verified-current write from staging evidence path', () => {
  const currentWrite = { ...evidenceWrite(128), role: 'VERIFIED_CURRENT' };
  assert.throws(
    () => planInitialRevisionEvidenceBatches([currentWrite]),
    (error) => error instanceof InitialRevisionEvidenceError && error.code === 'NON_EVIDENCE_WRITE',
  );
});

test('rejects a single evidence write that cannot fit one bounded transaction', () => {
  assert.throws(
    () => planInitialRevisionEvidenceBatches([evidenceWrite(PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT)]),
    (error) => error instanceof InitialRevisionEvidenceError && error.code === 'EVIDENCE_WRITE_TOO_LARGE',
  );
});

test('coalesces a >50-row initial batch into one bounded AS_TABLE provider execute', async () => {
  const rowCount = 120;
  const writes = Array.from({ length: rowCount }, (_, index) => evidenceWrite(128, index));
  const batches = planInitialRevisionEvidenceBatches(writes);
  assert.equal(batches.length, 1);

  const executed = [];
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          executed.push(statement);
          return { rows: [] };
        },
      });
    },
  });

  await executeInitialRevisionEvidenceBatches(adapter, batches);

  assert.equal(executed.length, 1);
  const [statement] = executed;
  assert.equal(statement.kind, 'WRITE');
  assert.match(statement.text, /^INSERT INTO source_record_revisions /);
  assert.match(statement.text, /FROM AS_TABLE\(\$rows\)$/);
  assert.equal(
    new TextEncoder().encode(statement.text).byteLength <= PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
    true,
  );
  assert.deepEqual(Object.keys(statement.parameters), ['rows']);
  assert.equal(statement.parameters.rows.type, 'ListStruct');
  assert.equal(statement.parameters.rows.value.rows.length, rowCount);
  assert.equal(
    statement.parameters.rows.value.rows[0].source_record_id.value,
    sourceId(0),
  );
  assert.equal(
    statement.parameters.rows.value.rows[rowCount - 1].source_record_id.value,
    sourceId(rowCount - 1),
  );
  assert.equal(statement.parameters.rows.value.columns[0].nullable, false);
  assert.equal(statement.parameters.rows.value.columns[2].nullable, true);
});

test('rejects malformed staging evidence shape before starting provider transaction', async () => {
  const valid = evidenceWrite(128);
  const malformed = Object.freeze({
    ...valid,
    statement: writeStatement('INSERT INTO source_record_revisions (source_record_id) VALUES ($source_record_id)', {
      source_record_id: valid.statement.parameters.source_record_id,
    }),
  });
  const batches = planInitialRevisionEvidenceBatches([malformed]);
  let transactionStarted = false;
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite() {
      transactionStarted = true;
      throw new Error('transaction must not start');
    },
  });

  await assert.rejects(
    () => executeInitialRevisionEvidenceBatches(adapter, batches),
    (error) => error instanceof InitialRevisionEvidenceError && error.code === 'EVIDENCE_WRITE_SHAPE_INVALID',
  );
  assert.equal(transactionStarted, false);
});

test('executes each evidence batch independently and preserves earlier unverified evidence on later failure', async () => {
  const batches = planInitialRevisionEvidenceBatches([
    evidenceWrite(300 * 1024, 0),
    evidenceWrite(300 * 1024, 1),
  ]);
  const events = [];
  let transactionIndex = 0;
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      transactionIndex += 1;
      events.push(`begin:${transactionIndex}`);
      try {
        const value = await work({
          async execute(statement) {
            events.push(`write:${transactionIndex}:${statement.kind}`);
            if (transactionIndex === 2) throw new Error('synthetic batch failure');
            return { rows: [] };
          },
        });
        events.push(`commit:${transactionIndex}`);
        return value;
      } catch (error) {
        events.push(`rollback:${transactionIndex}`);
        throw error;
      }
    },
  });

  await assert.rejects(() => executeInitialRevisionEvidenceBatches(adapter, batches), /synthetic batch failure/);
  assert.deepEqual(events, [
    'begin:1', 'write:1:WRITE', 'commit:1',
    'begin:2', 'write:2:WRITE', 'rollback:2',
  ]);
});

test('identity-only evidence cannot reconstruct the exact revision batch partition', () => {
  // The identity manifest records one binding per source row but intentionally does not
  // persist revision raw-payload byte size. The planner therefore has information that
  // manifest-only recovery does not: equal binding cardinality can produce different
  // transaction partitions solely because estimated parameter bytes differ.
  const identityEquivalentSmallWrites = Array.from({ length: 4 }, (_, index) => evidenceWrite(128, index));
  const identityEquivalentLargeWrites = Array.from(
    { length: 4 }, (_, index) => evidenceWrite(200 * 1024, index),
  );

  assert.equal(identityEquivalentSmallWrites.length, identityEquivalentLargeWrites.length);
  assert.deepEqual(
    planInitialRevisionEvidenceBatches(identityEquivalentSmallWrites).map((batch) => batch.writes.length),
    [4],
  );
  assert.deepEqual(
    planInitialRevisionEvidenceBatches(identityEquivalentLargeWrites).map((batch) => batch.writes.length),
    [2, 2],
  );
});
