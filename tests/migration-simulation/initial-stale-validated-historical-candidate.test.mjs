import assert from 'node:assert/strict';
import test from 'node:test';

import { createCanonicalSourceDigest } from '../../dist/integration/google/canonicalSourceDigest.js';
import { parseInitialBootstrapPrivateHistoricalEvidence } from '../../dist/migration/initialBootstrapPrivateEvidence.js';
import {
  InitialStaleValidatedHistoricalCandidateError,
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
    run_state: 'VALIDATED',
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
        if (statement.text.includes('FROM source_record_revisions')) {
          return { rows: revisionRows };
        }
        throw new Error(`unexpected read: ${statement.text}`);
      },
    }),
  });
}

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
