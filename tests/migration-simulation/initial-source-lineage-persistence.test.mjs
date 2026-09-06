import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import { buildInitialSourceLineageProjection } from '../../dist/migration/initialSourceLineage.js';
import {
  InitialSourceLineagePersistenceError,
  prepareInitialSourceLineageWrites,
} from '../../dist/migration/initialSourceLineagePersistence.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000401';
const RUN_ID = '00000000-0000-0000-0000-000000000402';
const SOURCE_ID_1 = '00000000-0000-0000-0000-000000000403';
const SOURCE_ID_2 = '00000000-0000-0000-0000-000000000404';

function payload(description) {
  return {
    adapter_schema_version: 1,
    date: '2026-01-01',
    operation_type: 'Расход',
    expense_account: 'Synthetic Account',
    expense_category: 'Synthetic Category',
    description,
    expense_amount: '123.45',
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  };
}

function projection() {
  const envelope = buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-06T19:50:00Z',
    startedAt: '2026-09-06T19:50:01Z',
    snapshotDigest: 'synthetic-snapshot-digest',
    rows: [
      { sourceRecordId: SOURCE_ID_1, rowHint: 2, digest: 'same-row-digest' },
      { sourceRecordId: SOURCE_ID_2, rowHint: 3, digest: 'same-row-digest' },
    ],
  });
  return buildInitialSourceLineageProjection(envelope, [
    { sourceRecordId: SOURCE_ID_1, payload: payload('Synthetic A') },
    { sourceRecordId: SOURCE_ID_2, payload: payload('Synthetic B') },
  ]);
}

test('prepares one source record and one revision write per independent lineage row', () => {
  const writes = prepareInitialSourceLineageWrites(projection());

  assert.equal(writes.length, 4);
  assert.equal(writes.every((write) => write.statement.kind === 'WRITE'), true);
  assert.equal(writes[0].statement.text.startsWith('UPSERT INTO source_records '), true);
  assert.equal(writes[1].statement.text.startsWith('UPSERT INTO source_record_revisions '), true);
  assert.equal(writes[2].statement.parameters.id.value, SOURCE_ID_2);
  assert.equal(writes[3].statement.parameters.source_record_id.value, SOURCE_ID_2);
  assert.equal(writes.every((write) => write.estimatedParameterBytes > 0), true);
  assert.equal(Object.isFrozen(writes), true);
  assert.equal(writes.every(Object.isFrozen), true);
});

test('uses schema-aligned typed parameters and preserves undecided semantics as null', () => {
  const [recordWrite, revisionWrite] = prepareInitialSourceLineageWrites(projection());

  assert.equal(recordWrite.statement.parameters.id.type, 'Uuid');
  assert.equal(recordWrite.statement.parameters.last_row_hint.type, 'Uint64');
  assert.equal(recordWrite.statement.parameters.current_digest.type, 'String');
  assert.equal(recordWrite.statement.parameters.state.value, null);
  assert.equal(recordWrite.statement.parameters.classification.value, null);
  assert.equal(recordWrite.statement.parameters.normalization_status.value, null);
  assert.equal(recordWrite.statement.parameters.transaction_id.value, null);
  assert.equal(revisionWrite.statement.parameters.revision.type, 'Uint64');
  assert.equal(revisionWrite.statement.parameters.raw_payload.type, 'JsonDocument');
  assert.equal(revisionWrite.statement.parameters.change_class.value, null);
  assert.equal(JSON.parse(revisionWrite.statement.parameters.raw_payload.value).description, 'Synthetic A');
});

test('fails closed when record and revision arrays lose positional lineage consistency', () => {
  const source = projection();
  const swapped = {
    records: source.records,
    revisions: [source.revisions[1], source.revisions[0]],
  };
  assert.throws(
    () => prepareInitialSourceLineageWrites(swapped),
    (error) => error instanceof InitialSourceLineagePersistenceError
      && error.code === 'REVISION_RECORD_MISMATCH',
  );
});

test('fails closed when initial revision invariant is not one', () => {
  const source = projection();
  const invalid = {
    records: [{ ...source.records[0], currentRevision: 2 }],
    revisions: [{ ...source.revisions[0], revision: 2 }],
  };
  assert.throws(
    () => prepareInitialSourceLineageWrites(invalid),
    (error) => error instanceof InitialSourceLineagePersistenceError
      && error.code === 'INVALID_INITIAL_REVISION',
  );
});
