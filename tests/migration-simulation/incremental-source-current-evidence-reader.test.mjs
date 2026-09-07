import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { SOURCE_SHEET_NAME } from '../../dist/integration/google/sourceSchema.js';
import {
  IncrementalSourceCurrentEvidenceReaderError,
  readIncrementalSourceCurrentEvidence,
} from '../../dist/migration/incrementalSourceCurrentEvidenceReader.js';

function sourceRow(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000201',
    source_type: 'GOOGLE_SHEETS',
    source_sheet: SOURCE_SHEET_NAME,
    first_seen_at: '2026-09-01T10:00:00.000Z',
    last_seen_at: '2026-09-07T10:00:00.000Z',
    last_row_hint: 7n,
    current_digest: 'row-digest-a',
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalization_status: 'NORMALIZED',
    transaction_id: '00000000-0000-0000-0000-000000000301',
    current_revision: 2n,
    resolution_code: null,
    resolved_at: null,
    resolved_by: null,
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

test('reads canonical source_records once and projects consistent lineage + source-current evidence', async () => {
  const missingResolved = sourceRow({
    id: '00000000-0000-0000-0000-000000000202',
    first_seen_at: '2026-08-01T10:00:00.000Z',
    last_seen_at: '2026-09-06T10:00:00.000Z',
    last_row_hint: 3,
    current_digest: 'row-digest-b',
    state: 'MISSING',
    classification: 'AMBIGUOUS',
    normalization_status: null,
    transaction_id: null,
    current_revision: 4,
    resolution_code: 'KEEP_CANONICAL',
    resolved_at: '2026-09-07T09:00:00.000Z',
    resolved_by: 'OWNER',
  });
  const active = sourceRow();
  const { adapter, observed } = makeAdapter([missingResolved, active]);

  const evidence = await readIncrementalSourceCurrentEvidence(adapter);

  assert.equal(observed.calls.length, 1);
  const statement = observed.calls[0];
  assert.equal(statement.kind, 'READ');
  assert.match(statement.text, /FROM source_records WHERE source_type = \$source_type AND source_sheet = \$source_sheet/);
  assert.equal(statement.parameters.source_type.value, 'GOOGLE_SHEETS');
  assert.equal(statement.parameters.source_sheet.value, SOURCE_SHEET_NAME);

  assert.deepEqual(evidence.sourceCurrent.map((item) => item.id), [active.id, missingResolved.id]);
  assert.deepEqual(evidence.lineageRecords.map((item) => item.id), [active.id, missingResolved.id]);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.sourceCurrent), true);
  assert.equal(Object.isFrozen(evidence.lineageRecords), true);

  for (let index = 0; index < evidence.sourceCurrent.length; index += 1) {
    const source = evidence.sourceCurrent[index];
    const lineage = evidence.lineageRecords[index];
    assert.deepEqual(lineage, {
      id: source.id,
      sourceType: source.sourceType,
      sourceSheet: source.sourceSheet,
      lastRowHint: source.lastRowHint,
      currentDigest: source.currentDigest,
      state: source.state,
      currentRevision: source.currentRevision,
    });
  }

  assert.equal(evidence.sourceCurrent[0].lastRowHint, 7);
  assert.equal(evidence.sourceCurrent[0].currentRevision, 2);
  assert.equal(evidence.sourceCurrent[1].state, 'MISSING');
  assert.equal(evidence.sourceCurrent[1].resolutionCode, 'KEEP_CANONICAL');
});

test('normalizes UUID casing and sorts deterministically by normalized id', async () => {
  const upper = sourceRow({ id: 'AAAAAAAA-0000-0000-0000-000000000202', transaction_id: null });
  const lower = sourceRow({ id: '00000000-0000-0000-0000-000000000203', transaction_id: null });
  const { adapter } = makeAdapter([upper, lower]);

  const evidence = await readIncrementalSourceCurrentEvidence(adapter);

  assert.deepEqual(evidence.sourceCurrent.map((item) => item.id), [
    '00000000-0000-0000-0000-000000000203',
    'aaaaaaaa-0000-0000-0000-000000000202',
  ]);
});

test('duplicate source-record id is rejected case-insensitively', async () => {
  const first = sourceRow({ id: 'AAAAAAAA-0000-0000-0000-000000000201' });
  const second = sourceRow({ id: 'aaaaaaaa-0000-0000-0000-000000000201' });
  const { adapter } = makeAdapter([first, second]);

  await assert.rejects(
    () => readIncrementalSourceCurrentEvidence(adapter),
    (error) => error instanceof IncrementalSourceCurrentEvidenceReaderError
      && error.code === 'DUPLICATE_SOURCE_RECORD_ID',
  );
});

test('malformed provider/source evidence fails closed', async () => {
  const malformed = [
    { source_type: 'OTHER' },
    { source_sheet: 'Other Sheet' },
    { id: 'not-a-uuid' },
    { first_seen_at: 'not-a-time' },
    { last_seen_at: '2026-08-01T00:00:00.000Z' },
    { last_row_hint: 0n },
    { current_digest: '  digest  ' },
    { state: 'ACTIVE' },
    { classification: 'UNKNOWN_CLASS' },
    { normalization_status: 123 },
    { transaction_id: 'bad-id' },
    { current_revision: 0n },
  ];

  for (const overrides of malformed) {
    const { adapter } = makeAdapter([sourceRow(overrides)]);
    await assert.rejects(
      () => readIncrementalSourceCurrentEvidence(adapter),
      (error) => error instanceof IncrementalSourceCurrentEvidenceReaderError
        && error.code === 'MALFORMED_SOURCE_CURRENT_EVIDENCE',
    );
  }
});

test('resolution audit must be all-null or fully populated', async () => {
  for (const overrides of [
    { resolution_code: 'KEEP_CANONICAL' },
    { resolved_at: '2026-09-07T09:00:00.000Z' },
    { resolved_by: 'OWNER' },
    { resolution_code: 'KEEP_CANONICAL', resolved_at: '2026-09-07T09:00:00.000Z' },
  ]) {
    const { adapter } = makeAdapter([sourceRow(overrides)]);
    await assert.rejects(
      () => readIncrementalSourceCurrentEvidence(adapter),
      (error) => error instanceof IncrementalSourceCurrentEvidenceReaderError
        && error.code === 'MALFORMED_SOURCE_CURRENT_EVIDENCE',
    );
  }
});

test('empty current source evidence is valid and performs no writes', async () => {
  const { adapter, observed } = makeAdapter([]);

  const evidence = await readIncrementalSourceCurrentEvidence(adapter);

  assert.deepEqual(evidence, { lineageRecords: [], sourceCurrent: [] });
  assert.equal(observed.calls.length, 1);
});
