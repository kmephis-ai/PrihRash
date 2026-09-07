import assert from 'node:assert/strict';
import test from 'node:test';
import {
  YdbAdapter,
  YdbAdapterError,
  writeStatement,
} from '../../dist/integration/ydb/adapter.js';
import { readConsistentIncrementalCurrentEvidence } from '../../dist/migration/consistentIncrementalCurrentEvidence.js';
import { IncrementalCurrentRevisionEvidenceReaderError } from '../../dist/migration/incrementalCurrentRevisionEvidenceReader.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000008001';
const RUN_ID = '00000000-0000-0000-0000-000000008002';

const rawPayload = Object.freeze({
  adapter_schema_version: 2,
  date: { kind: 'NUMBER', value: '45500' },
  operation_type: { kind: 'STRING', value: 'Расход' },
  expense_account: { kind: 'STRING', value: 'Карта Visa' },
  expense_category: { kind: 'STRING', value: 'Synthetic Category' },
  description: { kind: 'STRING', value: 'Synthetic Evidence' },
  expense_amount: { kind: 'NUMBER', value: '10' },
  income_account: null,
  income_category: null,
  income_amount: null,
  vika_flag: null,
  note: null,
});

function sourceRow() {
  return {
    id: SOURCE_ID,
    source_type: 'GOOGLE_SHEETS',
    source_sheet: 'Ответы на форму (11)',
    first_seen_at: '2026-09-01T10:00:00.000Z',
    last_seen_at: '2026-09-07T15:00:00.000Z',
    last_row_hint: 2n,
    current_digest: 'source-digest',
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalization_status: 'NORMALIZED',
    transaction_id: null,
    current_revision: 1n,
    resolution_code: null,
    resolved_at: null,
    resolved_by: null,
  };
}

function revisionRow() {
  return {
    source_record_id: SOURCE_ID,
    revision: 1n,
    migration_run_id: RUN_ID,
    observed_at: '2026-09-07T15:00:00.000Z',
    row_hint: 2n,
    row_digest: 'source-digest',
    change_class: null,
    raw_payload: JSON.stringify(rawPayload),
  };
}

function makeAdapter({ revisionRows = [revisionRow()] } = {}) {
  const observed = {
    outsideReadCount: 0,
    transactionCount: 0,
    statements: [],
  };
  const adapter = new YdbAdapter({
    async executeRead() {
      observed.outsideReadCount += 1;
      throw new Error('OUTSIDE_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      observed.transactionCount += 1;
      return work({
        async execute(statement) {
          observed.statements.push(statement);
          if (statement.kind !== 'READ') throw new Error('UNEXPECTED_WRITE');
          if (statement.text.includes('FROM source_records WHERE')) return { rows: [sourceRow()] };
          if (statement.text.includes('FROM source_record_revisions AS r')) return { rows: revisionRows };
          if (statement.text.includes('FROM transactions')) return { rows: [] };
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });
  return { adapter, observed };
}

test('reads source, matching current revision and transactions in one YDB transaction', async () => {
  const { adapter, observed } = makeAdapter();

  const snapshot = await readConsistentIncrementalCurrentEvidence(adapter);

  assert.equal(observed.outsideReadCount, 0);
  assert.equal(observed.transactionCount, 1);
  assert.equal(observed.statements.length, 3);
  assert.deepEqual(observed.statements.map((statement) => statement.kind), ['READ', 'READ', 'READ']);
  assert.equal(snapshot.sourceEvidence.sourceCurrent.length, 1);
  assert.equal(snapshot.sourceEvidence.sourceCurrent[0].id, SOURCE_ID);
  assert.equal(snapshot.revisionEvidence.currentRevisionPayloads.length, 1);
  assert.equal(snapshot.revisionEvidence.currentRevisionPayloads[0].sourceRecordId, SOURCE_ID);
  assert.equal(snapshot.revisionEvidence.currentRevisionPayloads[0].rowDigest, 'source-digest');
  assert.deepEqual(snapshot.previousTransactions, []);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.sourceEvidence.sourceCurrent), true);
  assert.equal(Object.isFrozen(snapshot.revisionEvidence.currentRevisionPayloads), true);
  assert.equal(Object.isFrozen(snapshot.previousTransactions), true);
});

test('preserves existing fail-closed missing revision evidence error inside the shared transaction', async () => {
  const { adapter, observed } = makeAdapter({ revisionRows: [] });

  await assert.rejects(
    () => readConsistentIncrementalCurrentEvidence(adapter),
    (error) => error instanceof IncrementalCurrentRevisionEvidenceReaderError
      && error.code === 'MISSING_CURRENT_REVISION_EVIDENCE',
  );

  assert.equal(observed.outsideReadCount, 0);
  assert.equal(observed.transactionCount, 1);
  assert.equal(observed.statements.length, 2);
});

test('transaction read scope rejects WRITE statements before transport execution', async () => {
  let executeCount = 0;
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('UNEXPECTED_OUTSIDE_READ');
    },
    async serializableReadWrite(work) {
      return work({
        async execute() {
          executeCount += 1;
          return { rows: [] };
        },
      });
    },
  });

  await adapter.serializableReadWrite(async (transaction) => {
    await assert.rejects(
      () => transaction.read(writeStatement('UPDATE synthetic SET value = 1')),
      (error) => error instanceof YdbAdapterError && error.code === 'WRITE_REQUIRES_TRANSACTION',
    );
  });

  assert.equal(executeCount, 0);
});
