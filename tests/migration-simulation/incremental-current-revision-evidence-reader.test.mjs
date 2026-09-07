import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { SOURCE_SHEET_NAME } from '../../dist/integration/google/sourceSchema.js';
import {
  IncrementalCurrentRevisionEvidenceReaderError,
  readIncrementalCurrentRevisionEvidence,
} from '../../dist/migration/incrementalCurrentRevisionEvidenceReader.js';

const SOURCE_ID_A = '00000000-0000-0000-0000-000000000201';
const SOURCE_ID_B = '00000000-0000-0000-0000-000000000202';
const RUN_ID = '00000000-0000-0000-0000-000000000101';

function payload(overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: { kind: 'NUMBER', value: '45500' },
    operation_type: { kind: 'STRING', value: 'Расход' },
    expense_account: { kind: 'STRING', value: 'Synthetic Account' },
    expense_category: { kind: 'STRING', value: 'Synthetic Category' },
    description: { kind: 'STRING', value: 'synthetic description' },
    expense_amount: { kind: 'NUMBER', value: '100.5' },
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  };
}

function source(id, overrides = {}) {
  return {
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: SOURCE_SHEET_NAME,
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-09-07T00:00:00.000Z',
    lastRowHint: 5,
    currentDigest: 'digest-a',
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalizationStatus: 'NORMALIZED',
    transactionId: null,
    currentRevision: 2,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function revisionRow(id, overrides = {}) {
  return {
    source_record_id: id,
    revision: 2n,
    migration_run_id: RUN_ID,
    observed_at: '2026-09-07T10:00:00.000Z',
    row_hint: 5n,
    row_digest: 'digest-a',
    change_class: 'OWNER_CORRECTION',
    raw_payload: payload(),
    ...overrides,
  };
}

function makeAdapter(rows) {
  const observed = { calls: [] };
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      observed.calls.push(statement);
      return { rows };
    },
    async serializableReadWrite() {
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });
  return { adapter, observed };
}

test('reads current revision rows once and returns consistent previous revision + runtime payload evidence', async () => {
  const sourceA = source(SOURCE_ID_A);
  const sourceB = source(SOURCE_ID_B, {
    lastRowHint: 7,
    currentDigest: 'digest-b',
    currentRevision: 4,
    state: 'MISSING',
    classification: 'AMBIGUOUS',
  });
  const rowB = revisionRow(SOURCE_ID_B, {
    revision: 4,
    row_hint: 7,
    row_digest: 'digest-b',
    change_class: 'AMBIGUOUS_CHANGE',
    raw_payload: JSON.stringify(payload({ note: { kind: 'STRING', value: 'synthetic note' } })),
  });
  const rowA = revisionRow(SOURCE_ID_A);
  const { adapter, observed } = makeAdapter([rowB, rowA]);

  const evidence = await readIncrementalCurrentRevisionEvidence(adapter, [sourceB, sourceA]);

  assert.equal(observed.calls.length, 1);
  const statement = observed.calls[0];
  assert.equal(statement.kind, 'READ');
  assert.match(statement.text, /JOIN source_records AS s/);
  assert.match(statement.text, /s\.current_revision = r\.revision/);
  assert.equal(statement.parameters.source_type.value, 'GOOGLE_SHEETS');
  assert.equal(statement.parameters.source_sheet.value, SOURCE_SHEET_NAME);

  assert.deepEqual(evidence.previousRevisionEvidence, [
    { sourceRecordId: SOURCE_ID_A, currentRevision: 2 },
    { sourceRecordId: SOURCE_ID_B, currentRevision: 4 },
  ]);
  assert.deepEqual(evidence.currentRevisionPayloads.map((item) => item.sourceRecordId), [SOURCE_ID_A, SOURCE_ID_B]);
  assert.equal(evidence.currentRevisionPayloads[0].rowDigest, 'digest-a');
  assert.equal(evidence.currentRevisionPayloads[1].rawPayload.note.value, 'synthetic note');
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.currentRevisionPayloads), true);
  assert.equal(Object.isFrozen(evidence.currentRevisionPayloads[0].rawPayload), true);
});

test('normalizes UUID casing and accepts null change_class for initial revision evidence', async () => {
  const upper = SOURCE_ID_A.toUpperCase();
  const { adapter } = makeAdapter([revisionRow(upper, { change_class: null })]);
  const evidence = await readIncrementalCurrentRevisionEvidence(adapter, [source(upper)]);

  assert.equal(evidence.currentRevisionPayloads[0].sourceRecordId, SOURCE_ID_A);
  assert.equal(evidence.currentRevisionPayloads[0].changeClass, null);
});

test('current revision number, row hint and digest must exactly match source current evidence', async () => {
  for (const overrides of [
    { revision: 3 },
    { row_hint: 6 },
    { row_digest: 'other-digest' },
  ]) {
    const { adapter } = makeAdapter([revisionRow(SOURCE_ID_A, overrides)]);
    await assert.rejects(
      () => readIncrementalCurrentRevisionEvidence(adapter, [source(SOURCE_ID_A)]),
      (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
        && error.code === 'CURRENT_REVISION_EVIDENCE_MISMATCH',
    );
  }
});

test('missing, extra and duplicate current revision rows fail closed', async () => {
  await assert.rejects(
    () => readIncrementalCurrentRevisionEvidence(makeAdapter([]).adapter, [source(SOURCE_ID_A)]),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'MISSING_CURRENT_REVISION_EVIDENCE',
  );

  await assert.rejects(
    () => readIncrementalCurrentRevisionEvidence(
      makeAdapter([revisionRow(SOURCE_ID_B)]).adapter,
      [source(SOURCE_ID_A)],
    ),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'EXTRA_CURRENT_REVISION_EVIDENCE',
  );

  await assert.rejects(
    () => readIncrementalCurrentRevisionEvidence(
      makeAdapter([revisionRow(SOURCE_ID_A), revisionRow(SOURCE_ID_A)]).adapter,
      [source(SOURCE_ID_A)],
    ),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'DUPLICATE_CURRENT_REVISION_EVIDENCE',
  );
});

test('malformed provider revision metadata and raw payload fail closed', async () => {
  const malformed = [
    { source_record_id: 'bad-id' },
    { revision: 0n },
    { migration_run_id: 'bad-id' },
    { observed_at: 'not-a-time' },
    { row_hint: 0 },
    { row_digest: ' digest ' },
    { change_class: 'NO_CHANGE' },
    { raw_payload: '{not-json' },
    { raw_payload: payload({ adapter_schema_version: 1 }) },
    { raw_payload: payload({ expense_amount: { kind: 'NUMBER', value: '01' } }) },
  ];

  for (const overrides of malformed) {
    const { adapter } = makeAdapter([revisionRow(SOURCE_ID_A, overrides)]);
    await assert.rejects(
      () => readIncrementalCurrentRevisionEvidence(adapter, [source(SOURCE_ID_A)]),
      (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
        && error.code === 'MALFORMED_CURRENT_REVISION_EVIDENCE',
      `field=${Object.keys(overrides)[0]}`,
    );
  }
});

test('duplicate or malformed source input evidence fails before provider read', async () => {
  const duplicate = makeAdapter([]);
  await assert.rejects(
    () => readIncrementalCurrentRevisionEvidence(duplicate.adapter, [source(SOURCE_ID_A), source(SOURCE_ID_A.toUpperCase())]),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'DUPLICATE_SOURCE_RECORD_ID',
  );
  assert.equal(duplicate.observed.calls.length, 0);

  const invalid = makeAdapter([]);
  await assert.rejects(
    () => readIncrementalCurrentRevisionEvidence(invalid.adapter, [source('bad-id')]),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'INVALID_SOURCE_EVIDENCE',
  );
  assert.equal(invalid.observed.calls.length, 0);
});

test('empty source evidence requires empty provider current-revision result', async () => {
  const empty = makeAdapter([]);
  const evidence = await readIncrementalCurrentRevisionEvidence(empty.adapter, []);
  assert.deepEqual(evidence, { previousRevisionEvidence: [], currentRevisionPayloads: [] });

  const extra = makeAdapter([revisionRow(SOURCE_ID_A)]);
  await assert.rejects(
    () => readIncrementalCurrentRevisionEvidence(extra.adapter, []),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'EXTRA_CURRENT_REVISION_EVIDENCE',
  );
});
