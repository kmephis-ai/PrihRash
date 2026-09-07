import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import { buildInitialSourceLineageProjection } from '../../dist/migration/initialSourceLineage.js';
import { prepareInitialSourceLineageWrites } from '../../dist/migration/initialSourceLineagePersistence.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000701';
const RUN_ID = '00000000-0000-0000-0000-000000000702';
const SOURCE_ID = '00000000-0000-0000-0000-000000000703';
const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

const envelope = buildInitialBootstrapCandidate({
  snapshotId: SNAPSHOT_ID,
  migrationRunId: RUN_ID,
  capturedAt: '2026-09-06T20:08:00Z',
  startedAt: '2026-09-06T20:08:01Z',
  snapshotDigest: 'synthetic-snapshot-digest',
  rows: [{ sourceRecordId: SOURCE_ID, rowHint: 2, digest: 'synthetic-row-digest' }],
});

const projection = buildInitialSourceLineageProjection(envelope, [{
  sourceRecordId: SOURCE_ID,
  payload: {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Synthetic Account'),
    expense_category: S('Synthetic Category'),
    description: S('Synthetic description'),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  },
}]);

test('marks source record as verified-current and revision as staging evidence', () => {
  const [recordWrite, revisionWrite] = prepareInitialSourceLineageWrites(projection);
  assert.equal(recordWrite.role, 'VERIFIED_CURRENT');
  assert.equal(revisionWrite.role, 'STAGING_EVIDENCE');
  assert.equal(recordWrite.statement.text.startsWith('UPSERT INTO source_records '), true);
  assert.equal(revisionWrite.statement.text.startsWith('INSERT INTO source_record_revisions '), true);
});