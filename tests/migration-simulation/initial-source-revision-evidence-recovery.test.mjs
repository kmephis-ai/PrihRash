import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  InitialSourceRevisionEvidenceRecoveryError,
  planInitialSourceRevisionEvidenceResume,
} from '../../dist/migration/initialSourceRevisionEvidenceRecovery.js';
import { prepareInitialSourceRevisionWrites } from '../../dist/migration/initialSourceLineagePersistence.js';
import { serializeRawPayload } from '../../dist/migration/rawPayloadProvenance.js';

const RUN_ID = '00000000-0000-0000-0000-000000009501';
const SOURCE_ID_1 = '00000000-0000-0000-0000-000000009502';
const SOURCE_ID_2 = '00000000-0000-0000-0000-000000009503';
const EXTRA_SOURCE_ID = '00000000-0000-0000-0000-000000009599';

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

function revision(sourceRecordId, rowHint, rowDigest, description) {
  return Object.freeze({
    sourceRecordId,
    revision: 1,
    migrationRunId: RUN_ID,
    observedAt: '2026-09-07T19:50:00Z',
    rowHint,
    rowDigest,
    changeClass: null,
    rawPayload: serializeRawPayload(payload(description)),
  });
}

function providerRow(expected, overrides = {}) {
  return {
    source_record_id: expected.sourceRecordId,
    revision: 1n,
    migration_run_id: expected.migrationRunId,
    observed_at: expected.observedAt,
    row_hint: BigInt(expected.rowHint),
    row_digest: expected.rowDigest,
    change_class: null,
    raw_payload: JSON.parse(expected.rawPayload),
    ...overrides,
  };
}

function reader(rows, queryChecks = () => {}) {
  return new YdbAdapter({
    async executeRead(statement) {
      queryChecks(statement);
      return { rows };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });
}

function expectRecoveryError(code, work) {
  return assert.rejects(
    work,
    (error) => error instanceof InitialSourceRevisionEvidenceRecoveryError && error.code === code,
  );
}

test('restart after partial revision evidence reuses exact existing revision and returns only missing append-only writes', async () => {
  const expected = [
    revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A'),
    revision(SOURCE_ID_2, 3, 'synthetic-row-b', 'Synthetic B'),
  ];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader([providerRow(expected[0])], (statement) => {
      assert.match(statement.text, /WHERE migration_run_id = \$migration_run_id AND revision = \$revision/);
      assert.equal(statement.parameters.migration_run_id.value, RUN_ID);
      assert.equal(statement.parameters.revision.value, 1n);
    }),
    expected,
  );

  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1]);
  assert.deepEqual(resume.missingRevisions, [expected[1]]);
  const writes = prepareInitialSourceRevisionWrites(resume.missingRevisions);
  assert.equal(writes.length, 1);
  assert.match(writes[0].statement.text, /^INSERT INTO source_record_revisions /);
  assert.equal(writes[0].statement.parameters.source_record_id.value, SOURCE_ID_2);
});

test('fully materialized exact revision evidence makes replay a no-op', async () => {
  const expected = [
    revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A'),
    revision(SOURCE_ID_2, 3, 'synthetic-row-b', 'Synthetic B'),
  ];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader(expected.map(providerRow)),
    expected,
  );
  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1, SOURCE_ID_2]);
  assert.deepEqual(resume.missingRevisions, []);
  assert.deepEqual(prepareInitialSourceRevisionWrites(resume.missingRevisions), []);
});

test('contradictory existing revision-1 evidence blocks resume instead of overwriting provenance', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  await expectRecoveryError(
    'EXISTING_REVISION_MISMATCH',
    () => planInitialSourceRevisionEvidenceResume(
      reader([providerRow(expected[0], { row_digest: 'different-digest' })]),
      expected,
    ),
  );
});

test('foreign or duplicate source evidence under the claimed run fails closed', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  await expectRecoveryError(
    'EXTRA_EXISTING_REVISION',
    () => planInitialSourceRevisionEvidenceResume(
      reader([providerRow({ ...expected[0], sourceRecordId: EXTRA_SOURCE_ID })]),
      expected,
    ),
  );

  await expectRecoveryError(
    'DUPLICATE_EXISTING_REVISION',
    () => planInitialSourceRevisionEvidenceResume(
      reader([providerRow(expected[0]), providerRow(expected[0])]),
      expected,
    ),
  );
});

test('malformed raw payload is not accepted as equivalent revision evidence', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  await expectRecoveryError(
    'MALFORMED_EXISTING_REVISION',
    () => planInitialSourceRevisionEvidenceResume(
      reader([providerRow(expected[0], { raw_payload: { adapter_schema_version: 1 } })]),
      expected,
    ),
  );
});
