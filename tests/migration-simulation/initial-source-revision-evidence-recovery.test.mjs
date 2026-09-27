import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { YdbJsV6DataTransportError } from '../../dist/integration/ydb/ydbJsV6DataTransport.js';
import {
  InitialSourceRevisionEvidenceRecoveryError,
  createInitialSourceRevisionEvidenceReadBudgetWaiter,
  initialSourceRevisionEvidenceReadBudgetDelayMs,
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
      const resultRows = typeof rows === 'function' ? rows(statement) : rows;
      const limitMatch = statement.text.match(/ORDER BY source_record_id LIMIT (\d+)$/);
      if (limitMatch === null) return { rows: resultRows };
      const after = statement.parameters.source_record_id_after?.value;
      return {
        rows: resultRows
          .filter((row) => after === undefined || row.source_record_id > after)
          .sort((left, right) => left.source_record_id.localeCompare(right.source_record_id))
          .slice(0, Number(limitMatch[1])),
      };
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
  const readStages = [];
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
    (stage) => readStages.push(stage),
  );

  assert.deepEqual(readStages, ['REVISION_PAYLOAD_BATCH', 'REVISION_COLLISION_READ']);
  assert.equal(statements.length, 2);
  assert.match(statements[0].text, /FROM source_record_revisions VIEW idx_source_record_revisions_run_revision/);
  assert.match(statements[0].text, /raw_payload/);
  assert.match(statements[0].text, /WHERE migration_run_id = \$migration_run_id AND revision = \$revision/);
  assert.match(statements[0].text, /ORDER BY source_record_id LIMIT 3$/);
  assert.equal(statements[0].parameters.revision.value, 1n);
  assert.equal(statements[0].parameters.migration_run_id.value, RUN_ID);
  assert.deepEqual(Object.keys(statements[0].parameters).sort(), ['migration_run_id', 'revision']);

  assert.match(statements[1].text, /INNER JOIN AS_TABLE\(\$source_keys\) AS k/);
  assert.doesNotMatch(statements[1].text, /raw_payload/);
  assert.equal(statements[1].parameters.source_keys.type, 'ListStruct');
  assert.deepEqual(
    statements[1].parameters.source_keys.value.rows.map((row) => row.source_record_id.value),
    [SOURCE_ID_2],
  );

  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1]);
  assert.deepEqual(resume.missingRevisions, [expected[1]]);
  const writes = prepareInitialSourceRevisionWrites(resume.missingRevisions);
  assert.equal(writes.length, 1);
  assert.match(writes[0].statement.text, /^INSERT INTO source_record_revisions /);
  assert.equal(writes[0].statement.parameters.source_record_id.value, SOURCE_ID_2);
});

test('revision read-stage observer cannot alter recovery semantics when it throws', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  const seen = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader(expected.map(providerRow)),
    expected,
    (stage) => {
      seen.push(stage);
      throw new Error('diagnostic observer failure');
    },
  );
  assert.deepEqual(seen, ['REVISION_PAYLOAD_BATCH']);
  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1]);
  assert.deepEqual(resume.missingRevisions, []);
});

test('revision payload batch observer is enum-only and cannot alter recovery semantics when it throws', async () => {
  const expected = [revision(SOURCE_ID_1, 2, 'synthetic-row-a', 'Synthetic A')];
  const seen = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader(expected.map(providerRow)),
    expected,
    undefined,
    (evidence) => {
      seen.push(evidence);
      throw new Error('diagnostic observer failure');
    },
  );
  assert.deepEqual(seen, ['ALL_BATCHES_WITHIN_64_KIB']);
  assert.deepEqual(resume.existingSourceRecordIds, [SOURCE_ID_1]);
  assert.deepEqual(resume.missingRevisions, []);
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

test('large current-run revision proof reads exact payload once through bounded indexed cursor pages', async () => {
  const expected = Array.from({ length: 1_000 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-row-${index + 1}`,
    `Synthetic ${index + 1} ${'x'.repeat(1024)}`,
  ));
  const statements = [];
  const batchEvidence = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      statements.push(statement);
      assert.match(statement.text, /VIEW idx_source_record_revisions_run_revision/);
      assert.match(statement.text, /ORDER BY source_record_id LIMIT 9$/);
      assert.match(statement.text, /raw_payload/);
      assert.deepEqual(statement.parameters.revision, { type: 'Uint64', value: 1n });
      return expected.map(providerRow);
    }),
    expected,
    undefined,
    (evidence) => batchEvidence.push(evidence),
  );

  const payloadReads = statements;
  assert.equal(payloadReads.length, Math.ceil(expected.length / 9));
  assert.equal(batchEvidence.length > 1, true);
  assert.deepEqual([...new Set(batchEvidence)], ['ALL_BATCHES_WITHIN_64_KIB']);
  assert.equal(new Set(payloadReads.map((statement) => statement.text)).size, 2);
  assert.equal(payloadReads.every((statement) => (
    statement.parameters.migration_run_id.value === RUN_ID
    && /raw_payload/.test(statement.text)
    && /source_record_id > \$source_record_id_after/.test(statement.text) ===
      Object.hasOwn(statement.parameters, 'source_record_id_after')
    && Object.keys(statement.parameters).sort().includes('migration_run_id')
  )), true);
  assert.deepEqual(resume.existingSourceRecordIds, expected.map((item) => item.sourceRecordId).sort());
  assert.deepEqual(resume.missingRevisions, []);
});

test('complete revision evidence does not perform a duplicate metadata scan', async () => {
  const expected = Array.from({ length: 600 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-metadata-row-${index + 1}`,
    `Synthetic ${index + 1}`,
  ));
  const revisionReadStatements = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      assert.match(statement.text, /raw_payload/);
      revisionReadStatements.push(statement);
      const after = statement.parameters.source_record_id_after?.value;
      const limit = Number(statement.text.match(/LIMIT (\d+)$/)?.[1]);
      return {
        rows: expected.filter((item) => after === undefined || item.sourceRecordId > after)
          .slice(0, limit)
          .map(providerRow),
      };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });

  const resume = await planInitialSourceRevisionEvidenceResume(adapter, expected);

  assert.equal(revisionReadStatements.length, 67);
  assert.deepEqual(resume.existingSourceRecordIds, expected.map((item) => item.sourceRecordId));
  assert.deepEqual(resume.missingRevisions, []);
});

test('payload batches are row-bounded and wait for the read-unit budget before each range query', async () => {
  const expected = Array.from({ length: 17 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-paced-row-${index + 1}`,
    `Synthetic ${index + 1}`,
  ));
  const statements = [];
  const waitedUnits = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      statements.push(statement);
      return expected.map(providerRow);
    }),
    expected,
    undefined,
    undefined,
    async (units) => waitedUnits.push(units),
  );

  const payloadReads = statements.filter((statement) => /raw_payload/.test(statement.text));
  assert.equal(payloadReads.length, 2);
  assert.deepEqual(waitedUnits, [9, 9]);
  assert.deepEqual(resume.existingSourceRecordIds, expected.map((item) => item.sourceRecordId));
  assert.deepEqual(resume.missingRevisions, []);
});

test('RU pacing preserves a one-unit CPU margin under the verified 10-RU/s baseline', () => {
  assert.equal(initialSourceRevisionEvidenceReadBudgetDelayMs(8), 900);
  assert.equal(initialSourceRevisionEvidenceReadBudgetDelayMs(16), 1_700);
  assert.throws(
    () => initialSourceRevisionEvidenceReadBudgetDelayMs(0),
    (error) => error instanceof InitialSourceRevisionEvidenceRecoveryError
      && error.code === 'INVALID_EXPECTED_REVISION',
  );
});

test('RU pacer accounts for time spent in the preceding query instead of adding a full batch delay', async () => {
  let now = 0;
  const waits = [];
  const pacer = createInitialSourceRevisionEvidenceReadBudgetWaiter(
    () => now,
    async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  );

  await pacer(8);
  now += 400;
  await pacer(8);
  now += 1_000;
  await pacer(1);

  assert.deepEqual(waits, [900, 500]);
});

test('revision cursor follows YDB UUID ordering without client-side comparison and classifies an oversized row locally', async () => {
  const ids = [
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000003',
  ];
  const expected = ids.map((id, index) => revision(
    id,
    index + 2,
    `synthetic-provider-order-${index}`,
    `Synthetic ${index} ${'x'.repeat(index === 1 ? 300_000 : 100)}`,
  ));
  const providerOrder = [expected[2], expected[0], expected[1]];
  const statements = [];
  const batchEvidence = [];
  const providerRank = new Map(providerOrder.map((item, index) => [item.sourceRecordId, index]));

  const resume = await planInitialSourceRevisionEvidenceResume(
    new YdbAdapter({
      async executeRead(statement) {
        statements.push(statement);
        assert.match(statement.text, /VIEW idx_source_record_revisions_run_revision/);
        const afterId = statement.parameters.source_record_id_after?.value;
        const afterRank = afterId === undefined ? -1 : providerRank.get(afterId);
        return {
          rows: providerOrder.filter((item) => providerRank.get(item.sourceRecordId) > afterRank)
            .slice(0, Number(statement.text.match(/LIMIT (\d+)$/)?.[1]))
            .map(providerRow),
        };
      },
      async serializableReadWrite() { throw new Error('write not expected'); },
    }),
    expected,
    undefined,
    (evidence) => batchEvidence.push(evidence),
  );

  const payloadReads = statements.filter((statement) => /raw_payload/.test(statement.text));
  assert.deepEqual(batchEvidence, [
    'ALL_BATCHES_WITHIN_64_KIB',
    'ALL_BATCHES_WITHIN_64_KIB',
    'SINGLE_REVISION_EXCEEDS_64_KIB',
  ]);
  assert.deepEqual(
    payloadReads.length,
    4,
  );
  assert.deepEqual(resume.existingSourceRecordIds, [...ids].sort());
  assert.deepEqual(resume.missingRevisions, []);
});

test('large exact-payload cursor pages stay below the synthetic per-query resource envelope', async () => {
  const expected = Array.from({ length: 4 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 2,
    `synthetic-row-${index + 1}`,
    `Synthetic ${index + 1} ${'x'.repeat(40_000)}`,
  ));
  const providerOrdered = [...expected].reverse();
  const payloadReadBoundaries = [];
  const providerRank = new Map(providerOrdered.map((item, index) => [item.sourceRecordId, index]));
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      const afterId = statement.parameters.source_record_id_after?.value;
      const afterRank = afterId === undefined ? -1 : providerRank.get(afterId);
      const range = providerOrdered.filter((item) => providerRank.get(item.sourceRecordId) > afterRank)
        .slice(0, Number(statement.text.match(/LIMIT (\d+)$/)?.[1]));
      const estimatedResponseBytes = range.reduce((total, item) => total + item.rawPayload.length + 256, 0);
      if (estimatedResponseBytes > 96 * 1024) {
        throw new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_RESOURCE_EXHAUSTED');
      }
      payloadReadBoundaries.push(range.map((item) => item.sourceRecordId));
      return { rows: range.map(providerRow) };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });

  const resume = await planInitialSourceRevisionEvidenceResume(adapter, expected);

  assert.equal(payloadReadBoundaries.length > 1, true);
  assert.deepEqual(
    payloadReadBoundaries.flat(),
    providerOrdered.map((item) => item.sourceRecordId),
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
