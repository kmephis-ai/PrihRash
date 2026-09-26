import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { YdbJsV6DataTransportError } from '../../dist/integration/ydb/ydbJsV6DataTransport.js';
import {
  InitialSourceRevisionEvidenceRecoveryError,
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

  assert.deepEqual(readStages, [
    'REVISION_METADATA_SCAN',
    'REVISION_PAYLOAD_BATCH',
    'REVISION_COLLISION_READ',
  ]);
  assert.equal(statements.length, 3);
  assert.match(statements[0].text, /FROM source_record_revisions VIEW idx_source_record_revisions_run_revision/);
  assert.match(statements[0].text, /WHERE revision = \$revision AND migration_run_id = \$migration_run_id ORDER BY source_record_id$/);
  assert.doesNotMatch(statements[0].text, /raw_payload|AS_TABLE/);
  assert.equal(statements[0].parameters.revision.value, 1n);
  assert.equal(statements[0].parameters.migration_run_id.value, RUN_ID);
  assert.deepEqual(Object.keys(statements[0].parameters).sort(), ['migration_run_id', 'revision']);

  assert.match(statements[1].text, /raw_payload/);
  assert.match(statements[1].text, /source_record_id >= \$source_record_id_from/);
  assert.match(statements[1].text, /source_record_id <= \$source_record_id_to/);
  assert.match(statements[1].text, /r\.migration_run_id = \$migration_run_id/);
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
  assert.deepEqual(seen, ['REVISION_METADATA_SCAN', 'REVISION_PAYLOAD_BATCH']);
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

test('large metadata-only current-run scan is one indexed read; payload verification stays byte-bounded', async () => {
  const expected = Array.from({ length: 1_000 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-row-${index + 1}`,
    `Synthetic ${index + 1} ${'x'.repeat(1024)}`,
  ));
  const byId = new Map(expected.map((item) => [item.sourceRecordId, item]));
  const statements = [];
  const batchEvidence = [];
  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      if (!/raw_payload/.test(statement.text)) {
        assert.match(statement.text, /VIEW idx_source_record_revisions_run_revision/);
        assert.match(statement.text, /ORDER BY source_record_id$/);
        assert.doesNotMatch(statement.text, /LIMIT|source_record_id_cursor|raw_payload/);
        return expected.map(providerRow);
      }
      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      return expected.filter((item) => item.sourceRecordId >= from && item.sourceRecordId <= to)
        .map(providerRow);
    }, (statement) => statements.push(statement)),
    expected,
    undefined,
    (evidence) => batchEvidence.push(evidence),
  );

  const metadataReads = statements.filter((statement) => !/raw_payload/.test(statement.text));
  assert.equal(metadataReads.length, 1);
  assert.equal(Object.keys(metadataReads[0].parameters).sort().join(','), 'migration_run_id,revision');
  assert.equal(metadataReads.every((statement) => !/AS_TABLE|raw_payload|LIMIT/.test(statement.text)), true);

  const payloadReads = statements.filter((statement) => /raw_payload/.test(statement.text));
  assert.equal(payloadReads.length > 1, true);
  assert.equal(payloadReads.length <= Math.ceil(expected.length / 8), true);
  assert.equal(batchEvidence.length > 1, true);
  assert.deepEqual([...new Set(batchEvidence)], ['ALL_BATCHES_WITHIN_64_KIB']);
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
  assert.deepEqual(
    payloadReads.flatMap((statement) => expected.filter((item) => (
      item.sourceRecordId >= statement.parameters.source_record_id_from.value
      && item.sourceRecordId <= statement.parameters.source_record_id_to.value
    )).map((item) => item.sourceRecordId)),
    expected.map((item) => item.sourceRecordId),
  );
  assert.deepEqual(resume.existingSourceRecordIds, expected.map((item) => item.sourceRecordId).sort());
  assert.deepEqual(resume.missingRevisions, []);
});

test('metadata RU proof uses one exact indexed scan instead of burst-draining per-page queries', async () => {
  const expected = Array.from({ length: 600 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 1,
    `synthetic-metadata-row-${index + 1}`,
    `Synthetic ${index + 1}`,
  ));
  const metadataStatements = [];
  let syntheticBurstRu = 0;
  const syntheticBurstRuLimit = 601;
  const syntheticPagedQueryCount = Math.ceil(expected.length / 128);
  assert.equal(expected.length + 1 <= syntheticBurstRuLimit, true);
  assert.equal(expected.length + syntheticPagedQueryCount > syntheticBurstRuLimit, true);
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      if (!/raw_payload/.test(statement.text)) {
        assert.match(statement.text, /VIEW idx_source_record_revisions_run_revision/);
        assert.match(statement.text, /WHERE revision = \$revision AND migration_run_id = \$migration_run_id ORDER BY source_record_id$/);
        assert.doesNotMatch(statement.text, /LIMIT|source_record_id_cursor|raw_payload/);
        assert.deepEqual(Object.keys(statement.parameters).sort(), ['migration_run_id', 'revision']);
        metadataStatements.push(statement);
        // Synthetic request budget: each query pays a small fixed execution cost
        // in addition to its row reads. Splitting this complete evidence scan into
        // multiple pages would spend that fixed cost repeatedly.
        syntheticBurstRu += expected.length + metadataStatements.length;
        assert.equal(syntheticBurstRu <= syntheticBurstRuLimit, true);
        return { rows: expected.map(providerRow) };
      }

      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      return {
        rows: expected.filter((item) => item.sourceRecordId >= from && item.sourceRecordId <= to)
          .map(providerRow),
      };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });

  const resume = await planInitialSourceRevisionEvidenceResume(adapter, expected);

  assert.equal(metadataStatements.length, 1);
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
      if (!/raw_payload/.test(statement.text)) return expected.map(providerRow);
      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      return expected.filter((item) => item.sourceRecordId >= from && item.sourceRecordId <= to)
        .map(providerRow);
    }),
    expected,
    undefined,
    undefined,
    async (units) => waitedUnits.push(units),
  );

  const payloadReads = statements.filter((statement) => /raw_payload/.test(statement.text));
  assert.equal(payloadReads.length, 2);
  assert.deepEqual(waitedUnits, [9, 8]);
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

test('payload primary-key ranges follow YDB metadata order without client-side UUID sorting', async () => {
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
  const batchEvidence = [];
  const byId = new Map(expected.map((item) => [item.sourceRecordId, item]));
  const providerRank = new Map(providerOrder.map((item, index) => [item.sourceRecordId, index]));

  const resume = await planInitialSourceRevisionEvidenceResume(
    reader((statement) => {
      if (!/raw_payload/.test(statement.text)) {
        assert.match(statement.text, /VIEW idx_source_record_revisions_run_revision/);
        assert.match(statement.text, /ORDER BY source_record_id$/);
        assert.doesNotMatch(statement.text, /LIMIT|source_record_id_cursor/);
        return providerOrder.map(providerRow);
      }
      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      const fromRank = providerRank.get(from);
      const toRank = providerRank.get(to);
      return providerOrder.filter((item) => {
        const rank = providerRank.get(item.sourceRecordId);
        return rank >= fromRank && rank <= toRank;
      })
        .map(providerRow);
    }, (statement) => statements.push(statement)),
    expected,
    undefined,
    (evidence) => batchEvidence.push(evidence),
  );

  const payloadReads = statements.filter((statement) => /raw_payload/.test(statement.text));
  assert.deepEqual(batchEvidence, [
    'SINGLE_REVISION_EXCEEDS_64_KIB',
    'SINGLE_REVISION_EXCEEDS_64_KIB',
    'SINGLE_REVISION_EXCEEDS_64_KIB',
  ]);
  assert.deepEqual(
    payloadReads.flatMap((statement) => (
      providerOrder.filter((item) => {
        const rank = providerRank.get(item.sourceRecordId);
        return rank >= providerRank.get(statement.parameters.source_record_id_from.value)
          && rank <= providerRank.get(statement.parameters.source_record_id_to.value);
      }).map((item) => item.sourceRecordId)
    )),
    providerOrder.map((item) => item.sourceRecordId),
  );
  assert.deepEqual(resume.existingSourceRecordIds, [...ids].sort());
  assert.deepEqual(resume.missingRevisions, []);
});

test('RESOURCE_EXHAUSTED exact-payload range batches stay below the synthetic per-query resource envelope', async () => {
  const expected = Array.from({ length: 4 }, (_, index) => revision(
    `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    index + 2,
    `synthetic-row-${index + 1}`,
    `Synthetic ${index + 1} ${'x'.repeat(40_000)}`,
  ));
  const providerOrdered = [...expected].reverse();
  const byId = new Map(expected.map((item) => [item.sourceRecordId, item]));
  const payloadReadBoundaries = [];
  const providerRank = new Map(providerOrdered.map((item, index) => [item.sourceRecordId, index]));
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      if (/raw_payload/.test(statement.text) && /AS_TABLE\(\$source_keys\)/.test(statement.text)) {
        throw new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_RESOURCE_EXHAUSTED');
      }
      if (!/raw_payload/.test(statement.text)) return { rows: providerOrdered.map(providerRow) };

      const from = statement.parameters.source_record_id_from.value;
      const to = statement.parameters.source_record_id_to.value;
      const fromRank = providerRank.get(from);
      const toRank = providerRank.get(to);
      const range = providerOrdered.slice(fromRank, toRank + 1);
      const estimatedResponseBytes = range.reduce((total, item) => total + item.rawPayload.length + 256, 0);
      if (estimatedResponseBytes > 96 * 1024) {
        throw new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_RESOURCE_EXHAUSTED');
      }
      payloadReadBoundaries.push([from, to]);
      return {
        rows: range
          .map((item) => byId.get(item.sourceRecordId))
          .filter((item) => item !== undefined)
          .map(providerRow),
      };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });

  const resume = await planInitialSourceRevisionEvidenceResume(adapter, expected);

  assert.equal(payloadReadBoundaries.length > 1, true);
  assert.deepEqual(
    payloadReadBoundaries.flatMap(([from, to]) => {
      const fromRank = providerRank.get(from);
      const toRank = providerRank.get(to);
      return providerOrdered.slice(fromRank, toRank + 1).map((item) => item.sourceRecordId);
    }),
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
