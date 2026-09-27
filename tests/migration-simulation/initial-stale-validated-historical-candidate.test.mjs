import assert from 'node:assert/strict';
import test from 'node:test';

import { createCanonicalSourceDigest } from '../../dist/integration/google/canonicalSourceDigest.js';
import { parseInitialBootstrapPrivateHistoricalEvidence } from '../../dist/migration/initialBootstrapPrivateEvidence.js';
import {
  matchesInitialBootstrapDurableRevisionEvidenceProof,
  InitialStaleValidatedHistoricalCandidateError,
  reconstructInitialBootstrapDurableObservation,
  reconstructInitialStaleValidatedHistoricalCandidate,
} from '../../dist/migration/initialStaleValidatedHistoricalCandidate.js';
import { serializeRawPayload, serializeRawPayloadForLineageDigest } from '../../dist/migration/rawPayloadProvenance.js';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const RUN_ID = id(676001);
const SNAPSHOT_ID = id(676002);
const SOURCE_ID = id(676003);
const TRANSACTION_ID = id(676004);
const ACCOUNT_ID = id(676005);
const CATEGORY_ID = id(676006);
const VIKA_ID = id(676007);
const CAPTURED_AT = '2026-09-19T18:00:00.000Z';
const STARTED_AT = '2026-09-19T18:00:01.000Z';
const SNAPSHOT_DIGEST = 'synthetic-historical-snapshot-a';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function payload(description = 'Historical A') {
  return Object.freeze({
    adapter_schema_version: 3,
    date: N('45292'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Expense'),
    description: S(description),
    expense_amount: N('12.34'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  });
}

function rowDigest(value = payload()) {
  return createCanonicalSourceDigest().digestCanonicalRow(serializeRawPayloadForLineageDigest(value));
}

function run(overrides = {}) {
  return Object.freeze({
    id: RUN_ID,
    startedAt: STARTED_AT,
    finishedAt: null,
    sourceSnapshotDigest: SNAPSHOT_DIGEST,
    state: 'VALIDATED',
    rowsSeen: 1,
    rowsNew: 1,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
    ...overrides,
  });
}

function evidence() {
  return parseInitialBootstrapPrivateHistoricalEvidence(JSON.stringify({
    schema_version: 1,
    coarse_expense_ordinal_range: { start_inclusive: 0, end_exclusive: 1 },
    aggregate_period_month_ranges: [
      { start_inclusive: 0, end_exclusive: 1, aggregate_period_month: '2024-01-01' },
    ],
  }));
}

function revisionPage(statement, rows) {
  const cursor = statement.parameters.source_record_id_after?.value ?? null;
  const limit = Number(statement.text.match(/LIMIT (\d+)$/)?.[1]);
  assert.ok(Number.isSafeInteger(limit) && limit > 0);
  return rows
    .filter((row) => row.migration_run_id === RUN_ID && row.revision === 1n)
    .filter((row) => cursor === null || row.source_record_id > cursor)
    .slice(0, limit);
}

const refs = Object.freeze({
  vikaMemberId: VIKA_ID,
  resolveAccountId(label) {
    return label === 'Карта Visa' ? ACCOUNT_ID : null;
  },
  resolveCategoryId(kind, label) {
    return kind === 'EXPENSE' && label === 'Synthetic Expense' ? CATEGORY_ID : null;
  },
});

function fixture(overrides = {}) {
  const raw = overrides.rawPayload ?? payload();
  const digest = overrides.rowDigest ?? rowDigest(raw);
  const binding = {
    source_ordinal: 0,
    row_hint: 2,
    row_digest: digest,
    source_record_id: SOURCE_ID,
    transaction_id: TRANSACTION_ID,
    ...(overrides.binding ?? {}),
  };
  const manifestRow = {
    source_snapshot_id: SNAPSHOT_ID,
    source_snapshot_digest: SNAPSHOT_DIGEST,
    binding_count: 1n,
    bindings: { schema_version: 1, bindings: [binding] },
    run_state: overrides.runState ?? 'VALIDATED',
    run_snapshot_digest: SNAPSHOT_DIGEST,
    snapshot_digest: overrides.manifestSnapshotDigest ?? SNAPSHOT_DIGEST,
    snapshot_row_count: 1n,
  };
  const snapshotRow = {
    captured_at: new Date(CAPTURED_AT),
    snapshot_digest: SNAPSHOT_DIGEST,
    row_count: 1n,
  };
  const revisionRows = overrides.revisionRows ?? [{
    source_record_id: SOURCE_ID,
    revision: 1n,
    migration_run_id: RUN_ID,
    observed_at: new Date(CAPTURED_AT),
    row_hint: 2n,
    row_digest: digest,
    change_class: null,
    raw_payload: serializeRawPayload(raw),
  }];
  const reads = [];
  return Object.freeze({
    reads,
    reader: Object.freeze({
      async read(statement) {
        reads.push(statement.text);
        if (statement.text.includes('FROM initial_bootstrap_identity_manifests AS m')) {
          return { rows: [manifestRow] };
        }
        if (statement.text.includes('FROM source_snapshots WHERE id = $id')) {
          return { rows: [snapshotRow] };
        }
        if (statement.text.includes('VIEW idx_source_record_revisions_run_revision')) {
          return { rows: revisionPage(statement, revisionRows) };
        }
        throw new Error(`unexpected read: ${statement.text}`);
      },
    }),
  });
}

test('durable STAGING reconstruction verifies paged payload rows and returns an exact proof', async () => {
  const f = fixture({ runState: 'STAGING' });
  const stagingRun = run({ state: 'STAGING' });
  const readStages = [];
  const reconstructed = await reconstructInitialBootstrapDurableObservation(
    f.reader,
    stagingRun,
    evidence(),
    undefined,
    (stage) => readStages.push(stage),
  );

  assert.equal(reconstructed.rows.length, 1);
  assert.deepEqual(readStages, [
    'RESUME_IDENTITY_MANIFEST_READ',
    'RESUME_SNAPSHOT_READ',
    'REVISION_EVIDENCE_PREPARATION',
  ]);
  assert.equal(f.reads.length, 3);
  assert.match(f.reads[2], /VIEW idx_source_record_revisions_run_revision/);
  assert.match(f.reads[2], /ORDER BY source_record_id LIMIT 2/);
  assert.doesNotMatch(f.reads[2], /source_record_id >=|source_record_id <=/);
  assert.match(f.reads[2], /migration_run_id = \$migration_run_id/);
  assert.match(f.reads[2], /raw_payload/);

  const exactRevision = Object.freeze({
    sourceRecordId: SOURCE_ID,
    revision: 1,
    migrationRunId: RUN_ID,
    observedAt: CAPTURED_AT,
    rowHint: 2,
    rowDigest: rowDigest(),
    changeClass: null,
    rawPayload: serializeRawPayload(payload()),
  });
  assert.equal(matchesInitialBootstrapDurableRevisionEvidenceProof(
    reconstructed.revisionEvidenceProof,
    stagingRun,
    [exactRevision],
  ), true);
  assert.equal(matchesInitialBootstrapDurableRevisionEvidenceProof(
    reconstructed.revisionEvidenceProof,
    stagingRun,
    [Object.freeze({ ...exactRevision, rawPayload: serializeRawPayload(payload('Changed')) })],
  ), false);
});

test('large durable reconstruction streams one indexed payload scan without a duplicate metadata pass', async () => {
  const rowCount = 27;
  const historicalEvidence = parseInitialBootstrapPrivateHistoricalEvidence(JSON.stringify({
    schema_version: 1,
    coarse_expense_ordinal_range: { start_inclusive: 0, end_exclusive: rowCount },
    aggregate_period_month_ranges: [
      { start_inclusive: 0, end_exclusive: rowCount, aggregate_period_month: '2024-01-01' },
    ],
  }));
  const revisionRows = Array.from({ length: rowCount }, (_, index) => {
    const raw = payload(`Historical ${index + 1}`);
    return Object.freeze({
      source_record_id: id(700_000 + index),
      revision: 1n,
      migration_run_id: RUN_ID,
      observed_at: new Date(CAPTURED_AT),
      row_hint: BigInt(index + 2),
      row_digest: rowDigest(raw),
      change_class: null,
      raw_payload: serializeRawPayload(raw),
    });
  });
  const bindings = revisionRows.map((revision, index) => ({
    source_ordinal: index,
    row_hint: revision.row_hint,
    row_digest: revision.row_digest,
    source_record_id: revision.source_record_id,
    transaction_id: id(800_000 + index),
  }));
  const manifestRow = {
    source_snapshot_id: SNAPSHOT_ID,
    source_snapshot_digest: SNAPSHOT_DIGEST,
    binding_count: BigInt(rowCount),
    bindings: { schema_version: 1, bindings },
    run_state: 'STAGING',
    run_snapshot_digest: SNAPSHOT_DIGEST,
    snapshot_digest: SNAPSHOT_DIGEST,
    snapshot_row_count: BigInt(rowCount),
  };
  const snapshotRow = {
    captured_at: new Date(CAPTURED_AT),
    snapshot_digest: SNAPSHOT_DIGEST,
    row_count: BigInt(rowCount),
  };
  const statements = [];
  const reader = Object.freeze({
    async read(statement) {
      statements.push(statement);
      if (statement.text.includes('FROM initial_bootstrap_identity_manifests AS m')) {
        return { rows: [manifestRow] };
      }
      if (statement.text.includes('FROM source_snapshots WHERE id = $id')) {
        return { rows: [snapshotRow] };
      }
      if (statement.text.includes('VIEW idx_source_record_revisions_run_revision')) {
        return { rows: revisionPage(statement, revisionRows) };
      }
      throw new Error(`unexpected read: ${statement.text}`);
    },
  });
  const waitedUnits = [];
  const reconstructed = await reconstructInitialBootstrapDurableObservation(
    reader,
    run({ state: 'STAGING', rowsSeen: rowCount, rowsNew: rowCount }),
    historicalEvidence,
    async (units) => { waitedUnits.push(units); },
  );

  const payloadReads = statements.filter((statement) => (
    statement.text.includes('raw_payload')
  ));
  assert.equal(payloadReads.length, 4);
  for (const statement of payloadReads) {
    assert.doesNotMatch(statement.text, /source_record_id >=|source_record_id <=/);
    assert.match(statement.text, /VIEW idx_source_record_revisions_run_revision/);
    assert.match(statement.text, /ORDER BY source_record_id LIMIT (?:9|1)$/);
  }
  assert.deepEqual(waitedUnits, [9, 9, 9, 1]);
  assert.equal(reconstructed.rows.length, rowCount);
  assert.equal(matchesInitialBootstrapDurableRevisionEvidenceProof(
    reconstructed.revisionEvidenceProof,
    run({ state: 'STAGING', rowsSeen: rowCount, rowsNew: rowCount }),
    revisionRows.map((revision, index) => Object.freeze({
      sourceRecordId: revision.source_record_id,
      revision: 1,
      migrationRunId: RUN_ID,
      observedAt: CAPTURED_AT,
      rowHint: index + 2,
      rowDigest: revision.row_digest,
      changeClass: null,
      rawPayload: revision.raw_payload,
    })),
  ), true);
});

test('reconstructs exact historical candidate from durable evidence without any current Google observation', async () => {
  const f = fixture();
  const result = await reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run(), refs, evidence());

  assert.equal(result.run.id, RUN_ID);
  assert.equal(result.verifiedPlan.sourceRecords.length, 1);
  assert.equal(result.verifiedPlan.sourceRecords[0].id, SOURCE_ID);
  assert.equal(result.verifiedPlan.sourceRecords[0].transactionId, TRANSACTION_ID);
  assert.equal(result.verifiedPlan.transactions.length, 1);
  assert.equal(result.verifiedPlan.transactions[0].transactionId, TRANSACTION_ID);
  assert.equal(result.verifiedPlan.transactions[0].transaction.amountMinor, 1234);
  assert.equal(f.reads.length, 3);
  assert.equal(f.reads.some((sql) => /google|sheets/i.test(sql)), false);
});

test('fails closed when durable revision payload no longer proves its stored row digest', async () => {
  const originalDigest = rowDigest(payload());
  const f = fixture({
    rawPayload: payload('Changed payload'),
    rowDigest: originalDigest,
  });
  await assert.rejects(
    () => reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run(), refs, evidence()),
    (error) => error instanceof InitialStaleValidatedHistoricalCandidateError
      && error.code === 'REVISION_PAYLOAD_DIGEST_MISMATCH',
  );
});

test('fails closed for missing revision evidence', async () => {
  const f = fixture({ revisionRows: [] });
  await assert.rejects(
    () => reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run(), refs, evidence()),
    (error) => error instanceof InitialStaleValidatedHistoricalCandidateError
      && error.code === 'REVISION_EVIDENCE_INVALID',
  );
});

test('fails closed when the indexed historical revision scan finds an unmanifested row', async () => {
  const exactPayload = payload();
  const extraPayload = payload('Unmanifested revision');
  const f = fixture({
    revisionRows: [
      {
        source_record_id: SOURCE_ID,
        revision: 1n,
        migration_run_id: RUN_ID,
        observed_at: new Date(CAPTURED_AT),
        row_hint: 2n,
        row_digest: rowDigest(exactPayload),
        change_class: null,
        raw_payload: serializeRawPayload(exactPayload),
      },
      {
        source_record_id: id(676008),
        revision: 1n,
        migration_run_id: RUN_ID,
        observed_at: new Date(CAPTURED_AT),
        row_hint: 3n,
        row_digest: rowDigest(extraPayload),
        change_class: null,
        raw_payload: serializeRawPayload(extraPayload),
      },
    ],
  });

  await assert.rejects(
    () => reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run(), refs, evidence()),
    (error) => error instanceof InitialStaleValidatedHistoricalCandidateError
      && error.code === 'REVISION_EVIDENCE_INVALID',
  );
});

test('fails closed when run/manifest/snapshot digest evidence diverges', async () => {
  const f = fixture({ manifestSnapshotDigest: 'different-snapshot' });
  await assert.rejects(
    () => reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run(), refs, evidence()),
    (error) => error instanceof InitialStaleValidatedHistoricalCandidateError
      && error.code === 'MANIFEST_EVIDENCE_INVALID',
  );
});

test('fails closed when current reference context cannot reproduce historical projection', async () => {
  const f = fixture();
  const changedRefs = Object.freeze({
    ...refs,
    resolveCategoryId() { return null; },
  });
  await assert.rejects(
    () => reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run(), changedRefs, evidence()),
    (error) => error instanceof InitialStaleValidatedHistoricalCandidateError
      && error.code === 'IDENTITY_MANIFEST_RECONSTRUCTION_MISMATCH',
  );
});

test('rejects non-VALIDATED lifecycle before reading durable evidence', async () => {
  const f = fixture();
  await assert.rejects(
    () => reconstructInitialStaleValidatedHistoricalCandidate(f.reader, run({ state: 'STAGING' }), refs, evidence()),
    (error) => error instanceof InitialStaleValidatedHistoricalCandidateError
      && error.code === 'RUN_NOT_VALIDATED',
  );
  assert.equal(f.reads.length, 0);
});
