import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import {
  InitialSourceLineageError,
  buildInitialSourceLineageProjection,
} from '../../dist/migration/initialSourceLineage.js';
import { markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000301';
const RUN_ID = '00000000-0000-0000-0000-000000000302';
const SOURCE_ID_1 = '00000000-0000-0000-0000-000000000303';
const SOURCE_ID_2 = '00000000-0000-0000-0000-000000000304';

function payload(description) {
  const S = (value) => ({ kind: 'STRING', value });
  const N = (value) => ({ kind: 'NUMBER', value });
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Synthetic Account'),
    expense_category: S('Synthetic Category'),
    description: S(description),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  };
}

function envelope() {
  return buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-06T19:45:00Z',
    startedAt: '2026-09-06T19:45:01Z',
    snapshotDigest: 'synthetic-snapshot-digest',
    rows: [
      { sourceRecordId: SOURCE_ID_1, rowHint: 2, digest: 'same-row-digest' },
      { sourceRecordId: SOURCE_ID_2, rowHint: 3, digest: 'same-row-digest' },
    ],
  });
}

function observations() {
  return [
    { sourceRecordId: SOURCE_ID_1, payload: payload('Synthetic A') },
    { sourceRecordId: SOURCE_ID_2, payload: payload('Synthetic B') },
  ];
}

test('first-sight projection preserves independent lineage even for equal row digests', () => {
  const projection = buildInitialSourceLineageProjection(envelope(), observations());

  assert.equal(projection.records.length, 2);
  assert.equal(projection.revisions.length, 2);
  assert.deepEqual(projection.records.map((record) => record.id), [SOURCE_ID_1, SOURCE_ID_2]);
  assert.deepEqual(projection.records.map((record) => record.currentDigest), ['same-row-digest', 'same-row-digest']);
  assert.deepEqual(projection.revisions.map((revision) => revision.sourceRecordId), [SOURCE_ID_1, SOURCE_ID_2]);
  assert.deepEqual(projection.revisions.map((revision) => revision.revision), [1, 1]);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.records), true);
  assert.equal(Object.isFrozen(projection.revisions), true);
});

test('projection records only proven first-sight facts and leaves undecided semantics null', () => {
  const projection = buildInitialSourceLineageProjection(envelope(), observations());
  const record = projection.records[0];
  const revision = projection.revisions[0];

  assert.deepEqual(record, {
    id: SOURCE_ID_1,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-06T19:45:00Z',
    lastSeenAt: '2026-09-06T19:45:00Z',
    lastRowHint: 2,
    currentDigest: 'same-row-digest',
    state: null,
    classification: null,
    normalizationStatus: null,
    transactionId: null,
    currentRevision: 1,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
  assert.equal(revision.migrationRunId, RUN_ID);
  assert.equal(revision.observedAt, '2026-09-06T19:45:00Z');
  assert.equal(revision.rowHint, 2);
  assert.equal(revision.rowDigest, 'same-row-digest');
  assert.equal(revision.changeClass, null);
});

test('raw payload v2 serialization has canonical fixed key order', () => {
  const projection = buildInitialSourceLineageProjection(envelope(), observations());
  assert.equal(
    projection.revisions[0].rawPayload,
    JSON.stringify({
      adapter_schema_version: 2,
      date: { kind: 'NUMBER', value: '45292.5' },
      operation_type: { kind: 'STRING', value: 'Расход' },
      expense_account: { kind: 'STRING', value: 'Synthetic Account' },
      expense_category: { kind: 'STRING', value: 'Synthetic Category' },
      description: { kind: 'STRING', value: 'Synthetic A' },
      expense_amount: { kind: 'NUMBER', value: '123.45' },
      income_account: null,
      income_category: null,
      income_amount: null,
      vika_flag: null,
      note: null,
    }),
  );
});

for (const [name, mutate, code] of [
  ['wrong payload schema', (items) => { items[0].payload.adapter_schema_version = 1; }, 'INVALID_PAYLOAD_SCHEMA'],
  ['extra payload key', (items) => { items[0].payload.extra = 'x'; }, 'INVALID_PAYLOAD_KEYS'],
  ['missing payload key', (items) => { delete items[0].payload.note; }, 'INVALID_PAYLOAD_KEYS'],
  ['noncanonical numeric payload value', (items) => { items[0].payload.expense_amount = { kind: 'NUMBER', value: '1.230' }; }, 'INVALID_PAYLOAD_VALUE'],
  ['unknown source id', (items) => { items[1].sourceRecordId = '00000000-0000-0000-0000-000000000399'; }, 'UNKNOWN_PAYLOAD_SOURCE_ID'],
  ['duplicate source id', (items) => { items[1].sourceRecordId = SOURCE_ID_1; }, 'DUPLICATE_PAYLOAD_SOURCE_ID'],
]) {
  test(`lineage projection fails closed for ${name}`, () => {
    const items = observations();
    mutate(items);
    assert.throws(
      () => buildInitialSourceLineageProjection(envelope(), items),
      (error) => error instanceof InitialSourceLineageError && error.code === code,
    );
  });
}

test('lineage projection requires a STAGING run', () => {
  const source = envelope();
  const validated = {
    ...source,
    run: markMigrationRunValidated(source.run),
  };
  assert.throws(
    () => buildInitialSourceLineageProjection(validated, observations()),
    (error) => error instanceof InitialSourceLineageError && error.code === 'RUN_NOT_STAGING',
  );
});
