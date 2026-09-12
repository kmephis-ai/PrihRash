import test from 'node:test';
import assert from 'node:assert/strict';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  createInitialBootstrapDurableReconciliation,
  InitialBootstrapDurableReconciliationError,
} from '../../dist/migration/initialBootstrapDurableReconciliation.js';
import {
  InitialBootstrapPrivateEvidenceError,
  parseInitialBootstrapPrivateHistoricalEvidence,
} from '../../dist/migration/initialBootstrapPrivateEvidence.js';
import { projectInitialSnapshot } from '../../dist/migration/initialSnapshotProjection.js';

const SOURCE = '00000000-0000-0000-0000-000000000101';
const RUN = '00000000-0000-0000-0000-000000000102';
const ACCOUNT = '00000000-0000-0000-0000-000000000201';
const CATEGORY = '00000000-0000-0000-0000-000000000202';
const MEMBER = '00000000-0000-0000-0000-000000000203';
const OBSERVED = '2026-09-12T08:30:00.000Z';

const rawPayload = Object.freeze({
  adapter_schema_version: 3,
  date: Object.freeze({ kind: 'NUMBER', value: '45292.5' }),
  operation_type: Object.freeze({ kind: 'STRING', value: 'Расход' }),
  expense_account: Object.freeze({ kind: 'STRING', value: 'Карта Visa' }),
  expense_category: Object.freeze({ kind: 'STRING', value: 'Synthetic Expense' }),
  description: Object.freeze({ kind: 'STRING', value: 'Synthetic durable evidence' }),
  expense_amount: Object.freeze({ kind: 'NUMBER', value: '12.34' }),
  income_account: null,
  income_category: null,
  income_amount: null,
  vika_flag: null,
  note: null,
});

const serializedRawPayload = JSON.stringify(rawPayload);

const historicalEvidence = parseInitialBootstrapPrivateHistoricalEvidence(JSON.stringify({
  schema_version: 1,
  coarse_expense_ordinal_range: { start_inclusive: 0, end_exclusive: 1 },
  aggregate_period_month_ranges: [
    { start_inclusive: 0, end_exclusive: 1, aggregate_period_month: '2024-01-01' },
  ],
}));

const projectionContext = Object.freeze({
  granularityEvidence: historicalEvidence.granularityEvidence,
  refs: Object.freeze({
    vikaMemberId: MEMBER,
    resolveAccountId(label) { return label === 'Карта Visa' ? ACCOUNT : null; },
    resolveCategoryId(kind, label) {
      return kind === 'EXPENSE' && label === 'Synthetic Expense' ? CATEGORY : null;
    },
  }),
});

function input() {
  const projection = projectInitialSnapshot([
    Object.freeze({
      sourceRecordId: SOURCE,
      sourceOrdinal: 0,
      rawPayload,
      aggregatePeriodMonth: historicalEvidence.aggregatePeriodMonthForSourceOrdinal(0),
    }),
  ], projectionContext);
  return Object.freeze({
    run: Object.freeze({
      id: RUN,
      startedAt: OBSERVED,
      finishedAt: null,
      sourceSnapshotDigest: 'synthetic-snapshot',
      state: 'STAGING',
      rowsSeen: 1,
      rowsNew: 1,
      rowsChanged: 0,
      rowsMissing: 0,
      rowsAmbiguous: 0,
      errorCode: null,
    }),
    projection,
    lineage: Object.freeze({
      records: Object.freeze([]),
      revisions: Object.freeze([
        Object.freeze({
          sourceRecordId: SOURCE,
          revision: 1,
          migrationRunId: RUN,
          observedAt: OBSERVED,
          rowHint: 2,
          rowDigest: 'synthetic-row-digest',
          changeClass: null,
          rawPayload: serializedRawPayload,
        }),
      ]),
    }),
  });
}

function matchingTransport({ includeRevision = true } = {}) {
  return {
    async executeRead(statement) {
      if (!statement.text.includes('FROM source_record_revisions')) throw new Error(`unexpected read: ${statement.text}`);
      return {
        rows: includeRevision ? [{
          source_record_id: SOURCE,
          revision: 1n,
          migration_run_id: RUN,
          observed_at: OBSERVED,
          row_hint: 2n,
          row_digest: 'synthetic-row-digest',
          change_class: null,
          raw_payload: serializedRawPayload,
        }] : [],
      };
    },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          const text = statement.text;
          if (text.includes('FROM `source_records` GROUP BY classification, state')) {
            return { rows: [{ classification: 'FINANCIAL_RECORD', state: null, row_count: 1n }] };
          }
          if (text.includes('category_id AS dimension_id')) {
            return { rows: [{ type: 'EXPENSE', dimension_id: CATEGORY, row_count: 1n, total_amount_minor: 1234n }] };
          }
          if (text.includes("from_account_id AS dimension_id") && text.includes("WHERE type = 'EXPENSE'")) {
            return { rows: [{ type: 'EXPENSE', dimension_id: ACCOUNT, row_count: 1n, total_amount_minor: 1234n }] };
          }
          if (text.includes("to_account_id AS dimension_id") && text.includes("WHERE type = 'INCOME'")) {
            return { rows: [] };
          }
          if (text.includes('FROM `transactions` GROUP BY type')) {
            return { rows: [{ type: 'EXPENSE', row_count: 1n, total_amount_minor: 1234n }] };
          }
          throw new Error(`unexpected transaction read: ${text}`);
        },
      });
    },
  };
}

test('durable initial reconciliation reconstructs from persisted revision evidence and verifies committed current', async () => {
  const adapter = new YdbAdapter(matchingTransport());
  const reconciliation = createInitialBootstrapDurableReconciliation(
    adapter,
    projectionContext,
    historicalEvidence,
  );

  const prePromotion = await reconciliation.port.reconcile(input());
  assert.equal(prePromotion.unexplainedHighImpactMismatchCount, 0);
  assert.equal(Object.values(prePromotion.checks).every((status) => status === 'MATCHED'), true);

  const postCommit = await reconciliation.verifyCommittedCurrent();
  assert.equal(postCommit.unexplainedHighImpactMismatchCount, 0);
  assert.equal(Object.values(postCommit.checks).every((status) => status === 'MATCHED'), true);
});

test('durable initial reconciliation refuses to infer MATCHED when persisted revision evidence is incomplete', async () => {
  const adapter = new YdbAdapter(matchingTransport({ includeRevision: false }));
  const reconciliation = createInitialBootstrapDurableReconciliation(
    adapter,
    projectionContext,
    historicalEvidence,
  );

  await assert.rejects(
    () => reconciliation.port.reconcile(input()),
    (error) => error instanceof InitialBootstrapDurableReconciliationError
      && error.code === 'DURABLE_REVISION_EVIDENCE_INCOMPLETE',
  );
});

test('durable initial reconciliation rejects private historical evidence outside the leased source row count', async () => {
  const incompatibleEvidence = parseInitialBootstrapPrivateHistoricalEvidence(JSON.stringify({
    schema_version: 1,
    coarse_expense_ordinal_range: { start_inclusive: 10, end_exclusive: 11 },
    aggregate_period_month_ranges: [
      { start_inclusive: 10, end_exclusive: 11, aggregate_period_month: '2024-01-01' },
    ],
  }));
  const adapter = new YdbAdapter(matchingTransport());
  const reconciliation = createInitialBootstrapDurableReconciliation(
    adapter,
    Object.freeze({ ...projectionContext, granularityEvidence: incompatibleEvidence.granularityEvidence }),
    incompatibleEvidence,
  );

  await assert.rejects(
    () => reconciliation.port.reconcile(input()),
    (error) => error instanceof InitialBootstrapPrivateEvidenceError
      && error.code === 'COARSE_RANGE_OUTSIDE_SOURCE',
  );
});
