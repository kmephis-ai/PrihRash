import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatement, YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT } from '../../dist/migration/atomicPromotion.js';
import {
  InitialRevisionEvidenceError,
  executeInitialRevisionEvidenceBatches,
  planInitialRevisionEvidenceBatches,
} from '../../dist/migration/initialSourceRevisionEvidenceExecutor.js';

function evidenceWrite(bytes) {
  return Object.freeze({
    role: 'STAGING_EVIDENCE',
    statement: writeStatement('UPSERT INTO source_record_revisions (source_record_id) VALUES ($id)'),
    estimatedParameterBytes: bytes,
  });
}

test('greedily chunks staging revision evidence under calibrated transaction cap', () => {
  const writes = Array.from({ length: 5 }, () => evidenceWrite(150 * 1024));
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

test('executes each evidence batch independently and preserves earlier unverified evidence on later failure', async () => {
  const batches = planInitialRevisionEvidenceBatches([
    evidenceWrite(300 * 1024),
    evidenceWrite(300 * 1024),
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
