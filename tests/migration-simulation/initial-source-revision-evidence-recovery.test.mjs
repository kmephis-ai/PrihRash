import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  InitialSourceRevisionEvidenceRecoveryError,
  planInitialSourceRevisionEvidenceResume,
} from '../../dist/migration/initialSourceRevisionEvidenceRecovery.js';
import { PRELIVE_PROMOTION_QUERY_BYTES_LIMIT } from '../../dist/migration/atomicPromotion.js';
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
  assert.match(statements[0].text, /migration_run_id = \$migration_run_id$/);
  assert.doesNotMatch(statements[0].text, /raw_payload|AS_TABLE/);
  assert.equal(statements[0].parameters.revision.value, 1n);
  assert.equal(statements[0].parameters.migration_run_id.value, RUN_ID);

  assert.match(statements[1].text, /raw_payload/);
  assert.match(statements[1].text, /migration_run_id = \$migration_run_id/);
  assert.match(statements[1].text, /source_record_id = \$source_record_id_0/);
  assert.doesNotMatch(statements[1].text, /AS_TABLE/);
  assert.equal(statements[1].parameters.source_record_id_0.value, SOURCE_ID_1);

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

test('large current-run payload verification is bounded by response and query bytes without AS_TABLE', async () => {
  const expected = Array.from({ length: 1_000 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-row-${index + 1}`,
    `Synthetic ${index + 1} ${'x'.repeat(1024)}`,
  ));
  const byId = new Map(expected.map((item) => [item.sourceRecordId, item]));
  const statements = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      if (!/raw_payload/.test(statement.text)) return expected.map(providerRow);
      const ids = Object.entries(statement.parameters)
        .filter(([name]) => name.startsWith('source_record_id_'))
        .sort(([left], [right]) => Number(left.split('_').at(-1)) - Number(right.split('_').at(-1)))
        .map(([, parameter]) => parameter.value);
      return ids.map((id) => providerRow(byId.get(id)));
    }, (statement) => statements.push(statement)),
    expected,
  );

  assert.equal(statements.length > 2, true);
  assert.deepEqual(Object.keys(statements[0].parameters).sort(), ['migration_run_id', 'revision']);
  assert.doesNotMatch(statements[0].text, /AS_TABLE|raw_payload/);

  const payloadReads = statements.slice(1);
  assert.equal(payloadReads.length > 1, true);
  assert.equal(payloadReads.every((statement) => (
    statement.parameters.migration_run_id.value === RUN_ID
    && /raw_payload/.test(statement.text)
    && !/AS_TABLE/.test(statement.text)
    && /source_record_id = \$source_record_id_0/.test(statement.text)
    && new TextEncoder().encode(statement.text).byteLength <= PRELIVE_PROMOTION_QUERY_BYTES_LIMIT
  )), true);
  assert.equal(
    payloadReads.reduce(
      (total, statement) => total + Object.keys(statement.parameters)
        .filter((name) => name.startsWith('source_record_id_')).length,
      0,
    ),
    expected.length,
  );
  assert.deepEqual(resume.existingSourceRecordIds, expected.map((item) => item.sourceRecordId).sort());
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
