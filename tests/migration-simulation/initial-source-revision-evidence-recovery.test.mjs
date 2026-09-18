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
const OTHER_RUN_ID = '00000000-0000-0000-0000-000000009591';
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
      return { rows: typeof rows === 'function' ? rows(statement) : rows };
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

test('restart after partial revision evidence separates run-scoped payload verification from missing-key collision read', async () => {
  const expected = [
    revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A'),
    revision(SOURCE_ID_2, 3, 'synthetic-row-b', 'Synthetic B'),
  ];
  const statements = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader(
      (statement) => {
        if (statement.parameters.migration_run_id !== undefined && /raw_payload/.test(statement.text)) {
          return [providerRow(expected[0])];
        }
        if (statement.parameters.migration_run_id !== undefined) return [providerRow(expected[0])];
        return [];
      },
      (statement) => statements.push(statement),
    ),
    expected,
  );

  assert.equal(statements.length, 3);
  assert.match(statements[0].text, /migration_run_id = \$migration_run_id ORDER BY source_record_id$/);
  assert.doesNotMatch(statements[0].text, /raw_payload|AS_TABLE/);
  assert.equal(statements[0].parameters.revision.value, 1n);
  assert.equal(statements[0].parameters.migration_run_id.value, RUN_ID);

  assert.match(statements[1].text, /raw_payload/);
  assert.match(statements[1].text, /source_record_id >= \$source_record_id_from/);
  assert.match(statements[1].text, /source_record_id <= \$source_record_id_to/);
  assert.match(statements[1].text, /migration_run_id = \$migration_run_id/);
  assert.doesNotMatch(statements[1].text, /AS_TABLE|source_record_id_\d+/);
  assert.equal(statements[1].parameters.source_record_id_from.value, SOURCE_ID_1);
  assert.equal(statements[1].parameters.source_record_id_to.value, SOURCE_ID_1);

  assert.match(statements[2].text, /INNER JOIN AS_TABLE\(\$source_keys\) AS k/);
  assert.doesNotMatch(statements[2].text, /raw_payload/);
  assert.equal(statements[2].parameters.source_keys.type, 'ListStruct');
  assert.deepEqual(
    statements[2].parameters.source_keys.value.rows.map((row) => row.source_record_id.value),
    [SOURCE_ID_2],
  );

  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1]);
  assert.deepEqual(resume.missingRevisions, [expected[1]]);
  const writes = prepareInitialSourceRevisionWrites(resume.missingRevisions);
  assert.equal(writes.length, 1);
  assert.match(writes[0].statement.text, /^INSERT INTO source_record_revisions /);
  assert.equal(writes[0].statement.parameters.source_record_id.value, SOURCE_ID_2);
});

test('primary-key collision from another migration run fails closed instead of planning a conflicting INSERT', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  await expectRecoveryError(
    'EXISTING_REVISION_MISMATCH',
    () => planInitialSourceRevisionEvidenceResume(
      reader((statement) => (
        statement.parameters.migration_run_id === undefined
          ? [providerRow(expected[0], { migration_run_id: OTHER_RUN_ID })]
          : []
      )),
      expected,
    ),
  );
});

test('native Date timestamp readback matches the same expected instant', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader([providerRow(expected[0], { observed_at: new Date(expected[0].observedAt) })]),
    expected,
  );
  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1]);
  assert.deepEqual(resume.missingRevisions, []);
});

test('fully materialized exact revision evidence makes replay a no-op', async () => {
  const expected = [
    revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A'),
    revision(SOURCE_ID_2, 3, 'synthetic-row-b', 'Synthetic B'),
  ];
  const resume = await planInitialSourceRevisionEvidenceResume(reader(expected.map(providerRow)), expected);
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

test('foreign or duplicate source evidence returned by the provider fails closed', async () => {
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

test('large current-run payload verification uses constant-size PK ranges bounded by response bytes', async () => {
  const expected = Array.from({ length: 1_000 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-row-${index + 1}`,
    `Synthetic ${index + 1} ${'x'.repeat(1024)}`,
  ));
  const statements = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      if (!/raw_payload/.test(statement.text)) return expected.map(providerRow);
      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      return expected
        .filter((item) => item.sourceRecordId >= from && item.sourceRecordId <= to)
        .map(providerRow);
    }, (statement) => statements.push(statement)),
    expected,
  );

  assert.equal(statements.length > 2, true);
  assert.deepEqual(Object.keys(statements[0].parameters).sort(), ['migration_run_id', 'revision']);
  assert.doesNotMatch(statements[0].text, /AS_TABLE|raw_payload/);

  const payloadReads = statements.slice(1);
  assert.equal(payloadReads.length > 1, true);
  assert.equal(payloadReads.length < 10, true);
  assert.equal(new Set(payloadReads.map((statement) => statement.text)).size, 1);
  assert.equal(payloadReads.every((statement) => (
    statement.parameters.migration_run_id.value === RUN_ID
    && /raw_payload/.test(statement.text)
    && /source_record_id >= \$source_record_id_from/.test(statement.text)
    && /source_record_id <= \$source_record_id_to/.test(statement.text)
    && !/AS_TABLE|source_record_id_\d+/.test(statement.text)
    && Object.keys(statement.parameters).sort().join(',') ===
      'migration_run_id,revision,source_record_id_from,source_record_id_to'
  )), true);
  assert.equal(payloadReads[0].parameters.source_record_id_from.value, expected[0].sourceRecordId);
  assert.equal(
    payloadReads.at(-1).parameters.source_record_id_to.value,
    expected.at(-1).sourceRecordId,
  );
  assert.deepEqual(resume.existingSourceRecordIds, expected.map((item) => item.sourceRecordId).sort());
  assert.deepEqual(resume.missingRevisions, []);
});

test('payload ranges follow YDB metadata order instead of Node UUID string order', async () => {
  const ids = [
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000003',
  ];
  const expected = ids.map((id, index) => revision(
    id,
    index + 2,
    `synthetic-provider-order-${index}`,
    `Synthetic ${index} ${'x'.repeat(300_000)}`,
  ));
  const providerOrder = [expected[2], expected[0], expected[1]];
  const statements = [];
  const byId = new Map(expected.map((item) => [item.sourceRecordId, item]));

  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      if (!/raw_payload/.test(statement.text)) {
        assert.match(statement.text, /ORDER BY source_record_id$/);
        return providerOrder.map(providerRow);
      }
      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      assert.equal(from, to);
      const found = byId.get(from);
      return found === undefined ? [] : [providerRow(found)];
    }, (statement) => statements.push(statement)),
    expected,
  );

  const payloadReads = statements.filter((statement) => /raw_payload/.test(statement.text));
  assert.deepEqual(
    payloadReads.map((statement) => statement.parameters.source_record_id_from.value),
    providerOrder.map((item) => item.sourceRecordId),
  );
  assert.deepEqual(resume.existingSourceRecordIds, [...ids].sort());
  assert.deepEqual(resume.missingRevisions, []);
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
