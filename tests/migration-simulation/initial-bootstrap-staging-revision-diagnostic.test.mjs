import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseInitialBootstrapStagingDurableRevisionEvidence,
  diagnoseInitialBootstrapStagingExactRevisionEvidence,
  diagnoseInitialBootstrapStagingRevisionEvidence,
} from '../../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';
import { PRELIVE_PROMOTION_QUERY_BYTES_LIMIT } from '../../dist/migration/atomicPromotion.js';

const RUN_ID = '00000000-0000-0000-0000-000000000901';
const OTHER_RUN_ID = '00000000-0000-0000-0000-000000000902';
const SNAPSHOT_DIGEST = 'synthetic-snapshot-digest';
const SNAPSHOT_CAPTURED_AT = '2026-09-18T08:00:00.000Z';

function rawPayload(description = 'Synthetic') {
  return Object.freeze({
    adapter_schema_version: 3,
    date: Object.freeze({ kind: 'NUMBER', value: '45292' }),
    operation_type: Object.freeze({ kind: 'STRING', value: 'Расход' }),
    expense_account: Object.freeze({ kind: 'STRING', value: 'Карта Visa' }),
    expense_category: Object.freeze({ kind: 'STRING', value: 'Synthetic Food' }),
    description: Object.freeze({ kind: 'STRING', value: description }),
    expense_amount: Object.freeze({ kind: 'NUMBER', value: '10' }),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  });
}

function sourceId(index) {
  return `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
}

function observations(count) {
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    sourceOrdinal: index,
    rowHint: index + 2,
    digest: `synthetic-digest-${index}`,
  })));
}

function binding(observation, index) {
  return Object.freeze({
    source_ordinal: observation.sourceOrdinal,
    row_hint: observation.rowHint,
    row_digest: observation.digest,
    source_record_id: sourceId(index),
    transaction_id: null,
  });
}

function manifestRow(sourceObservations) {
  return Object.freeze({
    migration_run_id: RUN_ID,
    run_state: 'STAGING',
    run_snapshot_digest: SNAPSHOT_DIGEST,
    rows_seen: BigInt(sourceObservations.length),
    manifest_snapshot_digest: SNAPSHOT_DIGEST,
    binding_count: BigInt(sourceObservations.length),
    bindings: Object.freeze({
      schema_version: 1,
      bindings: Object.freeze(sourceObservations.map(binding)),
    }),
    snapshot_digest: SNAPSHOT_DIGEST,
    snapshot_row_count: BigInt(sourceObservations.length),
    snapshot_captured_at: SNAPSHOT_CAPTURED_AT,
  });
}

function revisionRow(observation, index, migrationRunId = RUN_ID, overrides = {}) {
  return Object.freeze({
    source_record_id: sourceId(index),
    revision: 1n,
    migration_run_id: migrationRunId,
    observed_at: SNAPSHOT_CAPTURED_AT,
    row_hint: BigInt(observation.rowHint),
    row_digest: observation.digest,
    change_class: null,
    raw_payload: rawPayload(`Synthetic ${index}`),
    ...overrides,
  });
}

function exactObservations(count) {
  return Object.freeze(observations(count).map((observation, index) => Object.freeze({
    ...observation,
    rawPayload: rawPayload(`Synthetic ${index}`),
  })));
}

function reader(sourceObservations, revisionResponder) {
  const calls = [];
  return Object.freeze({
    calls,
    async read(statement) {
      calls.push(statement);
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        return { rows: [manifestRow(sourceObservations)] };
      }
      return { rows: await revisionResponder(statement, calls.length - 1) };
    },
  });
}

test('staging revision diagnostic distinguishes no, partial, complete and cross-run PK evidence', async () => {
  const sourceObservations = observations(2);

  const none = reader(sourceObservations, async () => []);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(none, SNAPSHOT_DIGEST, sourceObservations),
    'NO_REVISION_EVIDENCE',
  );

  const partial = reader(sourceObservations, async (statement) => (
    statement.parameters.migration_run_id === undefined
      ? []
      : [revisionRow(sourceObservations[0], 0)]
  ));
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(partial, SNAPSHOT_DIGEST, sourceObservations),
    'PARTIAL_CURRENT_RUN_ONLY',
  );

  const complete = reader(sourceObservations, async () => sourceObservations.map((item, index) => revisionRow(item, index)));
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(complete, SNAPSHOT_DIGEST, sourceObservations),
    'COMPLETE_CURRENT_RUN_ONLY',
  );

  const collision = reader(sourceObservations, async (statement) => (
    statement.parameters.migration_run_id === undefined
      ? [revisionRow(sourceObservations[0], 0, OTHER_RUN_ID)]
      : []
  ));
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(collision, SNAPSHOT_DIGEST, sourceObservations),
    'CROSS_RUN_PK_COLLISION',
  );
});

test('staging revision diagnostic rejects duplicate transaction ids in manifest evidence', async () => {
  const sourceObservations = observations(2);
  const duplicateTransactionId = '00000000-0000-0000-0000-000000009999';
  const mismatchReader = Object.freeze({
    async read(statement) {
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        const row = manifestRow(sourceObservations);
        return {
          rows: [{
            ...row,
            bindings: {
              schema_version: 1,
              bindings: sourceObservations.map((observation, index) => ({
                ...binding(observation, index),
                transaction_id: duplicateTransactionId,
              })),
            },
          }],
        };
      }
      throw new Error('revision evidence must not be read after malformed manifest');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(mismatchReader, SNAPSHOT_DIGEST, sourceObservations),
    'STAGING_MANIFEST_STRUCTURE_MISMATCH',
  );
});

test('staging revision diagnostic separates manifest cardinality from structure failures', async () => {
  const sourceObservations = observations(1);
  const cardinalityReader = Object.freeze({
    async read() { return { rows: [] }; },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(cardinalityReader, SNAPSHOT_DIGEST, sourceObservations),
    'STAGING_MANIFEST_CARDINALITY_MISMATCH',
  );

  const malformedReader = Object.freeze({
    async read() {
      return { rows: [{ ...manifestRow(sourceObservations), migration_run_id: 'not-a-uuid' }] };
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(malformedReader, SNAPSHOT_DIGEST, sourceObservations),
    'STAGING_MANIFEST_STRUCTURE_MISMATCH',
  );
});

test('staging revision diagnostic fails closed when durable manifest metadata disagrees internally', async () => {
  const sourceObservations = observations(1);
  const mismatchReader = Object.freeze({
    async read(statement) {
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        const row = manifestRow(sourceObservations);
        return { rows: [{ ...row, run_snapshot_digest: 'different' }] };
      }
      throw new Error('revision evidence must not be read after manifest mismatch');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(mismatchReader, SNAPSHOT_DIGEST, sourceObservations),
    'STAGING_DURABLE_METADATA_MISMATCH',
  );
});

test('staging revision diagnostic classifies authoritative source drift without reading revisions', async () => {
  const sourceObservations = observations(1);
  const driftReader = Object.freeze({
    calls: [],
    async read(statement) {
      this.calls.push(statement);
      if (statement.text.includes("WHERE r.state = 'STAGING'")) return { rows: [manifestRow(sourceObservations)] };
      throw new Error('revision evidence must not be read after authoritative drift');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(driftReader, 'fresh-source-digest', sourceObservations),
    'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  );
  assert.equal(driftReader.calls.length, 1);
});

test('staging revision diagnostic proves only an exact preserved authoritative prefix after append-only growth', async () => {
  const durableObservations = observations(2);
  const currentObservations = observations(3);
  const prefixReader = reader(durableObservations, async () => {
    throw new Error('revision evidence must not be read after source-prefix classification');
  });

  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(prefixReader, 'fresh-source-digest', currentObservations),
    'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
  );
  assert.equal(prefixReader.calls.length, 1);

  const changedCurrent = Object.freeze([
    Object.freeze({ ...currentObservations[0], digest: 'changed-old-row' }),
    ...currentObservations.slice(1),
  ]);
  const changedReader = reader(durableObservations, async () => {
    throw new Error('revision evidence must not be read after authoritative drift');
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(changedReader, 'fresh-source-digest', changedCurrent),
    'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  );
  assert.equal(changedReader.calls.length, 1);
});

test('durable staging revision diagnostic inspects immutable evidence despite authoritative source drift', async () => {
  const sourceObservations = observations(2);
  const durableReader = reader(sourceObservations, async (statement) => (
    statement.parameters.migration_run_id === undefined
      ? []
      : [revisionRow(sourceObservations[0], 0)]
  ));

  assert.equal(
    await diagnoseInitialBootstrapStagingDurableRevisionEvidence(durableReader),
    'PARTIAL_CURRENT_RUN_ONLY',
  );
  assert.equal(durableReader.calls.length, 3);
  assert.equal(durableReader.calls.every((statement) => statement.kind === 'READ'), true);
});

test('durable staging revision diagnostic rejects non-contiguous partial current-run evidence', async () => {
  const sourceObservations = observations(3);
  const durableReader = reader(
    sourceObservations,
    async (statement) => (
      statement.parameters.migration_run_id === undefined
        ? []
        : [
          revisionRow(sourceObservations[0], 0),
          revisionRow(sourceObservations[2], 2),
        ]
    ),
  );

  assert.equal(
    await diagnoseInitialBootstrapStagingDurableRevisionEvidence(durableReader),
    'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH',
  );
});

test('durable staging revision diagnostic exposes cross-run primary-key collision without Google evidence', async () => {
  const sourceObservations = observations(1);
  const durableReader = reader(
    sourceObservations,
    async (statement) => (
      statement.parameters.migration_run_id === undefined
        ? [revisionRow(sourceObservations[0], 0, OTHER_RUN_ID)]
        : []
    ),
  );

  assert.equal(
    await diagnoseInitialBootstrapStagingDurableRevisionEvidence(durableReader),
    'CROSS_RUN_PK_COLLISION',
  );
});

test('staging revision diagnostic distinguishes authoritative row-count and binding mismatch', async () => {
  const sourceObservations = observations(2);
  const manifestOneRowReader = Object.freeze({
    async read(statement) {
      if (statement.text.includes("WHERE r.state = 'STAGING'")) return { rows: [manifestRow(observations(1))] };
      throw new Error('revision evidence must not be read after source row-count mismatch');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(manifestOneRowReader, SNAPSHOT_DIGEST, sourceObservations),
    'AUTHORITATIVE_ROW_COUNT_MISMATCH',
  );

  const bindingMismatch = Object.freeze([
    Object.freeze({ ...sourceObservations[0], digest: 'different' }),
    sourceObservations[1],
  ]);
  const manifestTwoRowReader = Object.freeze({
    async read(statement) {
      if (statement.text.includes("WHERE r.state = 'STAGING'")) return { rows: [manifestRow(sourceObservations)] };
      throw new Error('revision evidence must not be read after source binding mismatch');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(manifestTwoRowReader, SNAPSHOT_DIGEST, bindingMismatch),
    'AUTHORITATIVE_BINDING_MISMATCH',
  );
});

test('staging revision diagnostic separates malformed and duplicate revision rows', async () => {
  const sourceObservations = observations(1);
  const malformedReader = reader(sourceObservations, async () => [{
    ...revisionRow(sourceObservations[0], 0),
    revision: 0n,
  }]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(malformedReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_ROW_MALFORMED',
  );

  const duplicate = revisionRow(sourceObservations[0], 0);
  const duplicateReader = reader(sourceObservations, async () => [duplicate, duplicate]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(duplicateReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_ROW_DUPLICATE',
  );
});

test('staging revision diagnostic fails closed on extra or mismatched same-run evidence', async () => {
  const sourceObservations = observations(1);
  const extraObservation = Object.freeze({ sourceOrdinal: 9, rowHint: 99, digest: 'synthetic-extra' });
  const extraReader = reader(sourceObservations, async () => [revisionRow(extraObservation, 9)]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(extraReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_ROW_UNEXPECTED_SOURCE',
  );

  const mismatchReader = reader(sourceObservations, async () => [{
    ...revisionRow(sourceObservations[0], 0),
    row_digest: 'different',
  }]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(mismatchReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH',
  );
});

test('exact staging revision diagnostic proves full persisted revision equality read-only', async () => {
  const sourceObservations = exactObservations(2);
  const evidenceReader = reader(sourceObservations, async (statement) => {
    if (!/raw_payload/.test(statement.text)) {
      assert.match(statement.text, /ORDER BY source_record_id$/);
      return sourceObservations.map((item, index) => revisionRow(item, index));
    }
    assert.match(statement.text, /source_record_id >= \$source_record_id_from/);
    assert.match(statement.text, /source_record_id <= \$source_record_id_to/);
    assert.match(statement.text, /migration_run_id = \$migration_run_id/);
    assert.doesNotMatch(statement.text, /AS_TABLE|source_record_id_\d+/);
    return sourceObservations.map((item, index) => revisionRow(item, index));
  });

  assert.equal(
    await diagnoseInitialBootstrapStagingExactRevisionEvidence(
      evidenceReader,
      SNAPSHOT_DIGEST,
      sourceObservations,
    ),
    'EXACT_CURRENT_RUN_MATCH',
  );
  assert.equal(evidenceReader.calls.every((statement) => statement.kind === 'READ'), true);
});

test('exact staging revision diagnostic isolates timestamp and raw-payload mismatch enums', async () => {
  const sourceObservations = exactObservations(1);
  const timestampReader = reader(sourceObservations, async () => [
    revisionRow(sourceObservations[0], 0, RUN_ID, { observed_at: '2026-09-18T08:00:01.000Z' }),
  ]);
  assert.equal(
    await diagnoseInitialBootstrapStagingExactRevisionEvidence(
      timestampReader,
      SNAPSHOT_DIGEST,
      sourceObservations,
    ),
    'EXACT_CURRENT_RUN_OBSERVED_AT_MISMATCH',
  );

  const payloadReader = reader(sourceObservations, async () => [
    revisionRow(sourceObservations[0], 0, RUN_ID, { raw_payload: rawPayload('Different') }),
  ]);
  assert.equal(
    await diagnoseInitialBootstrapStagingExactRevisionEvidence(
      payloadReader,
      SNAPSHOT_DIGEST,
      sourceObservations,
    ),
    'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  );
});

test('exact staging revision diagnostic batches current-run payload reads as constant-size PK ranges', async () => {
  const sourceObservations = Object.freeze(Array.from({ length: 1_000 }, (_, index) => Object.freeze({
    ...observations(1)[0],
    sourceOrdinal: index,
    rowHint: index + 2,
    digest: `synthetic-digest-${index}`,
    rawPayload: rawPayload(`Synthetic ${index} ${'x'.repeat(1024)}`),
  })));
  const calls = [];
  const evidenceReader = reader(sourceObservations, async (statement) => {
    calls.push(statement);
    if (!/raw_payload/.test(statement.text)) {
      assert.match(statement.text, /ORDER BY source_record_id$/);
      return sourceObservations.map((item, index) => revisionRow(item, index));
    }
    const from = statement.parameters.source_record_id_from.value;
    const to = statement.parameters.source_record_id_to.value;
    return sourceObservations
      .map((item, index) => ({ item, index, id: sourceId(index) }))
      .filter(({ id }) => id >= from && id <= to)
      .map(({ item, index }) => revisionRow(item, index, RUN_ID, {
        raw_payload: item.rawPayload,
      }));
  });

  assert.equal(
    await diagnoseInitialBootstrapStagingExactRevisionEvidence(
      evidenceReader,
      SNAPSHOT_DIGEST,
      sourceObservations,
    ),
    'EXACT_CURRENT_RUN_MATCH',
  );
  const payloadReads = calls.filter((statement) => /raw_payload/.test(statement.text));
  assert.equal(payloadReads.length > 1, true);
  assert.equal(payloadReads.length < 10, true);
  assert.equal(new Set(payloadReads.map((statement) => statement.text)).size, 1);
  assert.equal(payloadReads.every((statement) => (
    statement.parameters.migration_run_id.value === RUN_ID
    && /source_record_id >= \$source_record_id_from/.test(statement.text)
    && /source_record_id <= \$source_record_id_to/.test(statement.text)
    && !/AS_TABLE|source_record_id_\d+/.test(statement.text)
    && Object.keys(statement.parameters).sort().join(',') ===
      'migration_run_id,revision,source_record_id_from,source_record_id_to'
  )), true);
  assert.equal(payloadReads[0].parameters.source_record_id_from.value, sourceId(0));
  assert.equal(payloadReads.at(-1).parameters.source_record_id_to.value, sourceId(999));
});

test('exact staging revision ranges follow YDB metadata order instead of Node UUID string order', async () => {
  const sourceObservations = Object.freeze(Array.from({ length: 3 }, (_, index) => Object.freeze({
    ...observations(1)[0],
    sourceOrdinal: index,
    rowHint: index + 2,
    digest: `synthetic-provider-order-${index}`,
    rawPayload: rawPayload(`Synthetic ${index} ${'x'.repeat(300_000)}`),
  })));
  const providerOrder = [2, 0, 1];
  const calls = [];
  const evidenceReader = reader(sourceObservations, async (statement) => {
    calls.push(statement);
    if (!/raw_payload/.test(statement.text)) {
      assert.match(statement.text, /ORDER BY source_record_id$/);
      return providerOrder.map((index) => revisionRow(sourceObservations[index], index, RUN_ID, {
        raw_payload: sourceObservations[index].rawPayload,
      }));
    }
    const from = statement.parameters.source_record_id_from.value;
    const to = statement.parameters.source_record_id_to.value;
    assert.equal(from, to);
    const index = providerOrder.find((candidate) => sourceId(candidate) === from);
    return index === undefined ? [] : [revisionRow(sourceObservations[index], index, RUN_ID, {
      raw_payload: sourceObservations[index].rawPayload,
    })];
  });

  assert.equal(
    await diagnoseInitialBootstrapStagingExactRevisionEvidence(
      evidenceReader,
      SNAPSHOT_DIGEST,
      sourceObservations,
    ),
    'EXACT_CURRENT_RUN_MATCH',
  );

  const payloadReads = calls.filter((statement) => /raw_payload/.test(statement.text));
  assert.deepEqual(
    payloadReads.map((statement) => statement.parameters.source_record_id_from.value),
    providerOrder.map(sourceId),
  );
});

test('exact staging revision diagnostic refuses authoritative drift before payload reads', async () => {
  const sourceObservations = exactObservations(1);
  const driftReader = reader(sourceObservations, async () => {
    throw new Error('exact revision read must not occur after source drift');
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingExactRevisionEvidence(
      driftReader,
      'different-digest',
      sourceObservations,
    ),
    'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN',
  );
  assert.equal(driftReader.calls.length, 1);
});

test('staging revision diagnostic uses one run scan plus one table-parameter collision read at large cardinality', async () => {
  const sourceObservations = observations(1000);
  const evidenceReader = reader(sourceObservations, async (statement) => {
    if (statement.parameters.migration_run_id !== undefined) {
      return sourceObservations.slice(0, 700).map((item, index) => revisionRow(item, index));
    }
    assert.match(statement.text, /INNER JOIN AS_TABLE\(\$source_keys\) AS k/);
    assert.equal(statement.parameters.source_keys.type, 'ListStruct');
    assert.equal(statement.parameters.source_keys.value.rows.length, 300);
    assert.ok(statement.text.length <= PRELIVE_PROMOTION_QUERY_BYTES_LIMIT);
    return [];
  });

  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(evidenceReader, SNAPSHOT_DIGEST, sourceObservations),
    'PARTIAL_CURRENT_RUN_ONLY',
  );
  assert.equal(evidenceReader.calls.length, 3);
  assert.equal(evidenceReader.calls.every((statement) => statement.kind === 'READ'), true);
  assert.match(evidenceReader.calls[1].text, /migration_run_id = \$migration_run_id ORDER BY source_record_id$/);
  assert.doesNotMatch(evidenceReader.calls[2].text, /source_record_id_\d+/);
});
