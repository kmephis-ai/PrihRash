import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { planInitialSourceRevisionEvidenceResume } from '../../dist/migration/initialSourceRevisionEvidenceRecovery.js';
import { serializeRawPayload } from '../../dist/migration/rawPayloadProvenance.js';

const RUN_ID = '00000000-0000-0000-0000-000000009601';
const SOURCE_ID = '00000000-0000-0000-0000-000000009602';
const ROW_DIGEST = ' synthetic-row-digest ';

function rawPayload() {
  const S = (value) => ({ kind: 'STRING', value });
  const N = (value) => ({ kind: 'NUMBER', value });
  return serializeRawPayload({
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Synthetic Account'),
    expense_category: S('Synthetic Category'),
    description: S('Synthetic Description'),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  });
}

test('partial revision replay preserves exact nonblank digest evidence without trim normalization', async () => {
  const expected = Object.freeze({
    sourceRecordId: SOURCE_ID,
    revision: 1,
    migrationRunId: RUN_ID,
    observedAt: '2026-09-07T19:55:00Z',
    rowHint: 2,
    rowDigest: ROW_DIGEST,
    changeClass: null,
    rawPayload: rawPayload(),
  });
  const adapter = new YdbAdapter({
    async executeRead() {
      return {
        rows: [{
          source_record_id: SOURCE_ID,
          revision: 1n,
          migration_run_id: RUN_ID,
          observed_at: expected.observedAt,
          row_hint: 2n,
          row_digest: ROW_DIGEST,
          change_class: null,
          raw_payload: JSON.parse(expected.rawPayload),
        }],
      };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });

  const resume = await planInitialSourceRevisionEvidenceResume(adapter, [expected]);
  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID]);
  assert.deepEqual(resume.missingRevisions, []);
});
