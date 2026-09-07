import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalCurrentPersistenceError,
  prepareIncrementalCurrentWrites,
} from '../../dist/migration/incrementalCurrentPersistence.js';
import { createMigrationRun, markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';
import { id, previous, transaction } from './incremental-source-current-candidate-fixtures.mjs';

const RUN_ID = id(700);
const PROMOTED_AT = '2026-09-07T09:25:00.000Z';

function validatedRun() {
  return markMigrationRunValidated(createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T09:20:00.000Z',
    sourceSnapshotDigest: 'synthetic-incremental-snapshot',
    counters: { rowsSeen: 3, rowsNew: 1, rowsChanged: 1, rowsMissing: 1, rowsAmbiguous: 0 },
  }));
}

function sourceCandidate(record, overrides = {}) {
  return Object.freeze({ ...record, ...overrides });
}

function deltaPlan() {
  const source2 = previous(2, { currentRevision: 2 });
  const source3 = previous(3, { currentRevision: 3 });
  const source4 = Object.freeze({
    id: id(4), sourceType: 'GOOGLE_SHEETS', sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: PROMOTED_AT, lastSeenAt: PROMOTED_AT, lastRowHint: 41,
    currentDigest: 'new-4', state: null, classification: 'FINANCIAL_RECORD', normalizationStatus: null,
    transactionId: id(104), currentRevision: 1, resolutionCode: null, resolvedAt: null, resolvedBy: null,
  });
  return Object.freeze({
    sourceIntents: Object.freeze([
      Object.freeze({
        kind: 'UPDATE_SOURCE_RECORD',
        candidate: sourceCandidate(source2, {
          lastSeenAt: PROMOTED_AT, lastRowHint: 21, currentDigest: 'new-2', currentRevision: 3,
        }),
        expectedCurrentRevision: 2,
        expectedCurrentDigest: 'd-2',
        expectedState: null,
        expectedTransactionId: id(102),
        expectedResolutionCode: null,
      }),
      Object.freeze({
        kind: 'UPDATE_SOURCE_RECORD',
        candidate: sourceCandidate(source3, { state: 'MISSING' }),
        expectedCurrentRevision: 3,
        expectedCurrentDigest: 'd-3',
        expectedState: null,
        expectedTransactionId: id(103),
        expectedResolutionCode: null,
      }),
      Object.freeze({ kind: 'CREATE_SOURCE_RECORD', candidate: source4 }),
    ]),
    transactionIntents: Object.freeze([
      Object.freeze({
        kind: 'REPLACE_TRANSACTION',
        candidate: Object.freeze({ id: id(102), transaction: transaction(2222), version: 3 }),
        expectedVersion: 2,
      }),
      Object.freeze({
        kind: 'CREATE_TRANSACTION',
        candidate: Object.freeze({ id: id(104), transaction: transaction(4444), version: 1 }),
      }),
    ]),
    promotionBlocker: null,
  });
}

function revisions() {
  return Object.freeze({
    revisions: Object.freeze([
      Object.freeze({
        sourceRecordId: id(2), revision: 3, migrationRunId: RUN_ID, observedAt: PROMOTED_AT,
        rowHint: 21, rowDigest: 'new-2', changeClass: 'OWNER_CORRECTION', rawPayload: '{"v":2}',
      }),
      Object.freeze({
        sourceRecordId: id(4), revision: 1, migrationRunId: RUN_ID, observedAt: PROMOTED_AT,
        rowHint: 41, rowDigest: 'new-4', changeClass: null, rawPayload: '{"v":4}',
      }),
    ]),
  });
}

test('compiles transactions, immutable revisions, then source current writes into one atomic preflight', () => {
  const result = prepareIncrementalCurrentWrites(validatedRun(), deltaPlan(), revisions(), PROMOTED_AT);

  assert.equal(result.preflight.eligible, true);
  assert.deepEqual(result.writes.map((write) => [write.role, write.entityId]), [
    ['TRANSACTION', id(102)],
    ['TRANSACTION', id(104)],
    ['SOURCE_REVISION', id(2)],
    ['SOURCE_REVISION', id(4)],
    ['SOURCE_RECORD', id(2)],
    ['SOURCE_RECORD', id(3)],
    ['SOURCE_RECORD', id(4)],
  ]);
  assert.equal(result.writes.every((write) => write.expectedReturnedRowCount === 1), true);
  assert.equal(result.writes.filter((write) => write.statement.text.includes('source_record_revisions')).length, 2);

  const replace = result.writes[0];
  assert.match(replace.statement.text, /^UPDATE transactions SET /);
  assert.match(replace.statement.text, /WHERE id = \$id AND version = \$expected_version RETURNING id$/);
  assert.deepEqual(replace.statement.parameters.expected_version, { type: 'Uint64', value: 2n });
  assert.deepEqual(replace.statement.parameters.version, { type: 'Uint64', value: 3n });
  assert.equal(Object.hasOwn(replace.statement.parameters, 'created_at'), false);
  assert.deepEqual(replace.statement.parameters.updated_at, { type: 'Timestamp', value: PROMOTED_AT });

  const createTx = result.writes[1];
  assert.match(createTx.statement.text, /^INSERT INTO transactions /);
  assert.deepEqual(createTx.statement.parameters.captured_at, { type: 'Timestamp', value: null });
  assert.deepEqual(createTx.statement.parameters.created_at, { type: 'Timestamp', value: PROMOTED_AT });
  assert.deepEqual(createTx.statement.parameters.updated_at, { type: 'Timestamp', value: PROMOTED_AT });

  const revisedRevision = result.writes[2];
  assert.match(revisedRevision.statement.text, /^INSERT INTO source_record_revisions /);
  assert.match(revisedRevision.statement.text, /RETURNING source_record_id$/);
  assert.deepEqual(revisedRevision.statement.parameters.source_record_id, { type: 'Uuid', value: id(2) });
  assert.deepEqual(revisedRevision.statement.parameters.revision, { type: 'Uint64', value: 3n });
  assert.deepEqual(revisedRevision.statement.parameters.migration_run_id, { type: 'Uuid', value: RUN_ID });
  assert.deepEqual(revisedRevision.statement.parameters.observed_at, { type: 'Timestamp', value: PROMOTED_AT });
  assert.deepEqual(revisedRevision.statement.parameters.row_hint, { type: 'Uint64', value: 21n });
  assert.deepEqual(revisedRevision.statement.parameters.row_digest, { type: 'String', value: 'new-2' });
  assert.deepEqual(revisedRevision.statement.parameters.change_class, { type: 'Utf8', value: 'OWNER_CORRECTION' });
  assert.deepEqual(revisedRevision.statement.parameters.raw_payload, { type: 'JsonDocument', value: '{"v":2}' });

  const insertedRevision = result.writes[3];
  assert.deepEqual(insertedRevision.statement.parameters.source_record_id, { type: 'Uuid', value: id(4) });
  assert.deepEqual(insertedRevision.statement.parameters.revision, { type: 'Uint64', value: 1n });
  assert.deepEqual(insertedRevision.statement.parameters.change_class, { type: 'Utf8', value: null });
  assert.deepEqual(insertedRevision.statement.parameters.raw_payload, { type: 'JsonDocument', value: '{"v":4}' });

  const revisedSource = result.writes[4];
  assert.match(revisedSource.statement.text, /^UPDATE source_records SET /);
  assert.match(revisedSource.statement.text, /current_revision = \$expected_current_revision/);
  assert.match(revisedSource.statement.text, /current_digest = \$expected_current_digest/);
  assert.match(revisedSource.statement.text, /state IS NULL/);
  assert.match(revisedSource.statement.text, /transaction_id = \$expected_transaction_id/);
  assert.match(revisedSource.statement.text, /resolution_code IS NULL/);
  assert.deepEqual(revisedSource.statement.parameters.expected_current_revision, { type: 'Uint64', value: 2n });
  assert.deepEqual(revisedSource.statement.parameters.expected_transaction_id, { type: 'Uuid', value: id(102) });

  const missingSource = result.writes[5];
  assert.deepEqual(missingSource.statement.parameters.current_revision, { type: 'Uint64', value: 3n });
  assert.deepEqual(missingSource.statement.parameters.state, { type: 'Utf8', value: 'MISSING' });

  const createSource = result.writes[6];
  assert.match(createSource.statement.text, /^INSERT INTO source_records /);
  assert.match(createSource.statement.text, /RETURNING id$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.writes), true);
});

test('revision coverage is exact and promotion blockers fail closed', () => {
  const run = validatedRun();
  const delta = deltaPlan();

  assert.throws(
    () => prepareIncrementalCurrentWrites(run, delta, { revisions: revisions().revisions.slice(0, 1) }, PROMOTED_AT),
    (error) => error instanceof IncrementalCurrentPersistenceError && error.code === 'MISSING_REVISION_EVIDENCE',
  );

  const wrongRun = revisions().revisions.map((revision) => (
    revision.sourceRecordId === id(2) ? { ...revision, migrationRunId: id(999) } : revision
  ));
  assert.throws(
    () => prepareIncrementalCurrentWrites(run, delta, { revisions: wrongRun }, PROMOTED_AT),
    (error) => error instanceof IncrementalCurrentPersistenceError && error.code === 'REVISION_RUN_MISMATCH',
  );

  assert.throws(
    () => prepareIncrementalCurrentWrites(run, { ...delta, promotionBlocker: 'UNRESOLVED_LINEAGE' }, revisions(), PROMOTED_AT),
    (error) => error instanceof IncrementalCurrentPersistenceError && error.code === 'PROMOTION_BLOCKED',
  );
});

test('malformed staged revision payload cannot enter the atomic write set', () => {
  const invalid = revisions().revisions.map((revision) => (
    revision.sourceRecordId === id(2) ? { ...revision, rawPayload: '{bad json' } : revision
  ));
  assert.throws(
    () => prepareIncrementalCurrentWrites(validatedRun(), deltaPlan(), { revisions: invalid }, PROMOTED_AT),
    (error) => error?.code === 'INVALID_JSON_DOCUMENT',
  );
});
