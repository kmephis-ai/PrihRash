import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { markReviewRequired, resolveReviewItem } from '../../dist/migration/resolution.js';
import { prepareResolutionMetadataWrite } from '../../dist/migration/resolutionPersistence.js';
import { recoverResolutionMetadataCommit } from '../../dist/migration/resolutionRecovery.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000001301';
const TRANSACTION_ID = '00000000-0000-0000-0000-000000001302';

function prepared() {
  const resolved = resolveReviewItem(
    markReviewRequired(SOURCE_ID, 'MISSING', TRANSACTION_ID),
    'KEEP_CANONICAL',
    { resolvedAt: '2026-09-07T04:20:00.000Z', resolvedBy: 'OWNER' },
  );
  return prepareResolutionMetadataWrite(resolved, {
    sourceRecordId: SOURCE_ID,
    sourceState: 'MISSING',
    classification: 'FINANCIAL_RECORD',
    transactionId: TRANSACTION_ID,
    currentRevision: 3,
  });
}

function rowFor(preparedWrite, overrides = {}) {
  return {
    state: preparedWrite.expectation.sourceState,
    classification: preparedWrite.expectation.classification,
    transaction_id: preparedWrite.expectation.transactionId,
    current_revision: BigInt(preparedWrite.expectation.currentRevision),
    resolution_code: preparedWrite.resolved.resolutionCode,
    resolved_at: preparedWrite.resolved.resolvedAt,
    resolved_by: preparedWrite.resolved.resolvedBy,
    ...overrides,
  };
}

function adapterWithRows(rows) {
  const calls = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      calls.push(statement.kind);
      return { rows };
    },
    async serializableReadWrite() {
      throw new Error('recovery must stay read-only');
    },
  });
  return { adapter, calls };
}

test('classifies exact target metadata as APPLIED using read-only evidence', async () => {
  const write = prepared();
  const fake = adapterWithRows([rowFor(write)]);

  const result = await recoverResolutionMetadataCommit(fake.adapter, write);

  assert.deepEqual(result, { status: 'APPLIED' });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(fake.calls, ['READ']);
});

test('classifies exact unresolved expected row as NOT_APPLIED', async () => {
  const write = prepared();
  const fake = adapterWithRows([
    rowFor(write, { resolution_code: null, resolved_at: null, resolved_by: null }),
  ]);

  assert.deepEqual(await recoverResolutionMetadataCommit(fake.adapter, write), { status: 'NOT_APPLIED' });
});

test('changed revision after ambiguous commit requires recovery instead of retry', async () => {
  const write = prepared();
  const fake = adapterWithRows([rowFor(write, { current_revision: 4n })]);

  assert.deepEqual(await recoverResolutionMetadataCommit(fake.adapter, write), { status: 'RECOVERY_REQUIRED' });
});

test('concurrent source recovery requires recovery instead of retry', async () => {
  const write = prepared();
  const fake = adapterWithRows([rowFor(write, { state: null })]);

  assert.deepEqual(await recoverResolutionMetadataCommit(fake.adapter, write), { status: 'RECOVERY_REQUIRED' });
});

test('foreign or partial resolution metadata requires recovery', async () => {
  const write = prepared();
  const fake = adapterWithRows([
    rowFor(write, { resolution_code: 'RESOLVED_NO_CHANGE', resolved_at: null }),
  ]);

  assert.deepEqual(await recoverResolutionMetadataCommit(fake.adapter, write), { status: 'RECOVERY_REQUIRED' });
});

test('missing row requires recovery because commit outcome cannot be proven', async () => {
  const write = prepared();
  const fake = adapterWithRows([]);

  assert.deepEqual(await recoverResolutionMetadataCommit(fake.adapter, write), { status: 'RECOVERY_REQUIRED' });
});

test('multiple rows fail closed as recovery required', async () => {
  const write = prepared();
  const row = rowFor(write);
  const fake = adapterWithRows([row, row]);

  assert.deepEqual(await recoverResolutionMetadataCommit(fake.adapter, write), { status: 'RECOVERY_REQUIRED' });
});
