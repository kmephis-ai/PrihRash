import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { markReviewRequired, resolveReviewItem } from '../../dist/migration/resolution.js';
import {
  ResolutionPersistenceError,
  executeResolutionMetadataWrite,
  prepareResolutionMetadataWrite,
} from '../../dist/migration/resolutionPersistence.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000001201';
const TRANSACTION_ID = '00000000-0000-0000-0000-000000001202';
const AUDIT = { resolvedAt: '2026-09-07T04:10:00.000Z', resolvedBy: 'OWNER' };

function missingResolved() {
  return resolveReviewItem(
    markReviewRequired(SOURCE_ID, 'MISSING', TRANSACTION_ID),
    'KEEP_CANONICAL',
    AUDIT,
  );
}

function expectation(overrides = {}) {
  return {
    sourceRecordId: SOURCE_ID,
    sourceState: 'MISSING',
    classification: 'FINANCIAL_RECORD',
    transactionId: TRANSACTION_ID,
    currentRevision: 3,
    ...overrides,
  };
}

function observedRow(prepared, overrides = {}) {
  return {
    state: prepared.expectation.sourceState,
    classification: prepared.expectation.classification,
    transaction_id: prepared.expectation.transactionId,
    current_revision: BigInt(prepared.expectation.currentRevision),
    resolution_code: prepared.resolved.resolutionCode,
    resolved_at: prepared.resolved.resolvedAt,
    resolved_by: prepared.resolved.resolvedBy,
    ...overrides,
  };
}

function fakeTransport(readRowsFactory) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            if (statement.kind === 'WRITE') {
              events.push('write');
              return { rows: [] };
            }
            events.push('readback');
            return { rows: readRowsFactory() };
          },
        };
        try {
          const result = await work(transaction);
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    },
  };
}

test('persists only resolution metadata and commits after exact same-transaction read-back', async () => {
  const prepared = prepareResolutionMetadataWrite(missingResolved(), expectation());
  const fake = fakeTransport(() => [observedRow(prepared)]);

  const result = await executeResolutionMetadataWrite(new YdbAdapter(fake.transport), prepared);

  assert.equal(result.resolutionCode, 'KEEP_CANONICAL');
  assert.equal(result.transactionId, TRANSACTION_ID);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(fake.events, ['begin', 'write', 'readback', 'commit']);
  assert.match(prepared.statement.text, /resolution_code IS NULL/);
  assert.doesNotMatch(prepared.statement.text, /UPDATE transactions/);
});

test('zero-row conditional update cannot silently resolve a missing source record', async () => {
  const prepared = prepareResolutionMetadataWrite(missingResolved(), expectation());
  const fake = fakeTransport(() => []);

  await assert.rejects(
    () => executeResolutionMetadataWrite(new YdbAdapter(fake.transport), prepared),
    (error) => error instanceof ResolutionPersistenceError
      && error.code === 'SOURCE_RECORD_NOT_FOUND_AFTER_RESOLUTION',
  );
  assert.deepEqual(fake.events, ['begin', 'write', 'readback', 'rollback']);
});

test('concurrent source recovery or reclassification rolls back on evidence mismatch', async () => {
  const prepared = prepareResolutionMetadataWrite(missingResolved(), expectation());
  const fake = fakeTransport(() => [observedRow(prepared, { state: null })]);

  await assert.rejects(
    () => executeResolutionMetadataWrite(new YdbAdapter(fake.transport), prepared),
    (error) => error instanceof ResolutionPersistenceError
      && error.code === 'RESOLUTION_EVIDENCE_MISMATCH',
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('concurrent revision advance rolls back instead of resolving stale evidence', async () => {
  const prepared = prepareResolutionMetadataWrite(missingResolved(), expectation());
  const fake = fakeTransport(() => [observedRow(prepared, { current_revision: 4n })]);

  await assert.rejects(
    () => executeResolutionMetadataWrite(new YdbAdapter(fake.transport), prepared),
    (error) => error instanceof ResolutionPersistenceError
      && error.code === 'RESOLUTION_EVIDENCE_MISMATCH',
  );
});

test('AMBIGUOUS review requires current ambiguous classification', () => {
  const resolved = resolveReviewItem(
    markReviewRequired(SOURCE_ID, 'AMBIGUOUS', TRANSACTION_ID),
    'RESOLVED_NO_CHANGE',
    AUDIT,
  );

  assert.throws(
    () => prepareResolutionMetadataWrite(resolved, expectation({ sourceState: null, classification: 'FINANCIAL_RECORD' })),
    (error) => error instanceof ResolutionPersistenceError && error.code === 'REVIEW_REASON_MISMATCH',
  );
});

test('MISSING review requires current missing source state', () => {
  assert.throws(
    () => prepareResolutionMetadataWrite(missingResolved(), expectation({ sourceState: null })),
    (error) => error instanceof ResolutionPersistenceError && error.code === 'REVIEW_REASON_MISMATCH',
  );
});

test('transaction relink cannot be smuggled into metadata-only persistence', () => {
  assert.throws(
    () => prepareResolutionMetadataWrite(missingResolved(), expectation({ transactionId: null })),
    (error) => error instanceof ResolutionPersistenceError && error.code === 'TRANSACTION_LINK_MISMATCH',
  );
});

test('current revision must be a positive safe integer', () => {
  assert.throws(
    () => prepareResolutionMetadataWrite(missingResolved(), expectation({ currentRevision: 0 })),
    (error) => error instanceof ResolutionPersistenceError && error.code === 'INVALID_CURRENT_REVISION',
  );
});
