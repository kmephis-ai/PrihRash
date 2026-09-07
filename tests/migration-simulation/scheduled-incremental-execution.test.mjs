import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { INITIAL_RECONCILIATION_CHECKS } from '../../dist/migration/initialValidationGate.js';
import { runPreparedScheduledIncremental } from '../../dist/migration/scheduledIncrementalExecution.js';

const BASELINE_RUN = '00000000-0000-0000-0000-000000007001';
const RUN_ID = '00000000-0000-0000-0000-000000007002';
const SOURCE_ID = '00000000-0000-0000-0000-000000007003';
const TX_ID = '00000000-0000-0000-0000-000000007004';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000007005';
const CATEGORY_ID = '00000000-0000-0000-0000-000000007006';
const MEMBER_ID = '00000000-0000-0000-0000-000000007007';
const LEASED_DIGEST = 'leased-current-snapshot-digest';
const STARTED_AT = '2026-09-07T16:00:00.000Z';
const OBSERVED_AT = '2026-09-07T16:00:01.000Z';
const PROMOTED_AT = '2026-09-07T16:00:02.000Z';
const FINISHED_AT = '2026-09-07T16:00:03.000Z';

const rawPayload = Object.freeze({
  adapter_schema_version: 2,
  date: { kind: 'NUMBER', value: '45500' },
  operation_type: { kind: 'STRING', value: 'Расход' },
  expense_account: { kind: 'STRING', value: 'Карта Visa' },
  expense_category: { kind: 'STRING', value: 'Synthetic Category' },
  description: { kind: 'STRING', value: 'Synthetic Execution' },
  expense_amount: { kind: 'NUMBER', value: '50' },
  income_account: null,
  income_category: null,
  income_amount: null,
  vika_flag: null,
  note: null,
});

const baselineRun = Object.freeze({
  id: BASELINE_RUN,
  startedAt: '2026-09-07T15:00:00.000Z',
  finishedAt: '2026-09-07T15:01:00.000Z',
  sourceSnapshotDigest: 'baseline-digest',
  state: 'COMMITTED',
  rowsSeen: 0,
  rowsNew: 0,
  rowsChanged: 0,
  rowsMissing: 0,
  rowsAmbiguous: 0,
  errorCode: null,
});

function evidenceRow(run) {
  return {
    id: run.id,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    source_snapshot_digest: run.sourceSnapshotDigest,
    state: run.state,
    rows_seen: BigInt(run.rowsSeen),
    rows_new: BigInt(run.rowsNew),
    rows_changed: BigInt(run.rowsChanged),
    rows_missing: BigInt(run.rowsMissing),
    rows_ambiguous: BigInt(run.rowsAmbiguous),
    error_code: run.errorCode,
  };
}

function lifecycleRow(run) {
  return {
    state: run.state,
    finished_at: run.finishedAt,
    error_code: run.errorCode,
    source_snapshot_digest: run.sourceSnapshotDigest,
    rows_seen: BigInt(run.rowsSeen),
    rows_new: BigInt(run.rowsNew),
    rows_changed: BigInt(run.rowsChanged),
    rows_missing: BigInt(run.rowsMissing),
    rows_ambiguous: BigInt(run.rowsAmbiguous),
  };
}

function candidateRun(state = 'STAGING') {
  return Object.freeze({
    id: RUN_ID,
    startedAt: STARTED_AT,
    finishedAt: null,
    sourceSnapshotDigest: LEASED_DIGEST,
    state,
    rowsSeen: 1,
    rowsNew: 1,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
  });
}

function matchedEvidence(overrides = {}) {
  return Object.freeze({
    checks: Object.freeze(Object.fromEntries(
      INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED']),
    )),
    unexplainedHighImpactMismatchCount: 0,
    ...overrides,
  });
}

function makeAdapter() {
  const observed = { transactionCount: 0, statements: [] };
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('OUTSIDE_TRANSACTION_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      observed.transactionCount += 1;
      const transactionNumber = observed.transactionCount;
      return work({
        async execute(statement) {
          observed.statements.push({ transactionNumber, text: statement.text, kind: statement.kind });

          if (transactionNumber === 1) {
            if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
              return { rows: [evidenceRow(baselineRun)] };
            }
            if (statement.text.startsWith('INSERT INTO migration_runs')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return { rows: [evidenceRow(candidateRun())] };
            }
          }

          if (transactionNumber === 2) {
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return { rows: [lifecycleRow(candidateRun('VALIDATED'))] };
            }
          }

          if (transactionNumber === 3) {
            if (statement.text.includes('RETURNING source_record_id')) {
              return { rows: [{ source_record_id: SOURCE_ID }] };
            }
            if (statement.text.startsWith('INSERT INTO transactions')) {
              return { rows: [{ id: TX_ID }] };
            }
            if (statement.text.startsWith('INSERT INTO source_records')) {
              return { rows: [{ id: SOURCE_ID }] };
            }
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) {
              return { rows: [{ id: RUN_ID }] };
            }
          }

          throw new Error(`UNEXPECTED_STATEMENT_${transactionNumber}: ${statement.text}`);
        },
      });
    },
  });
  return { adapter, observed };
}

function baseInput(overrides = {}) {
  return {
    baselineRun,
    sourceEvidence: Object.freeze({ lineageRecords: Object.freeze([]), sourceCurrent: Object.freeze([]) }),
    revisionEvidence: Object.freeze({ previousRevisionEvidence: Object.freeze([]), currentRevisionPayloads: Object.freeze([]) }),
    previousTransactions: Object.freeze([]),
    projection: Object.freeze({ rows: Object.freeze([Object.freeze({ rowHint: 2, digest: 'row-digest', rawPayload })]) }),
    leasedSnapshotDigest: LEASED_DIGEST,
    runId: RUN_ID,
    startedAt: STARTED_AT,
    observedAt: OBSERVED_AT,
    promotedAt: PROMOTED_AT,
    finishedAt: FINISHED_AT,
    refs: Object.freeze({
      vikaMemberId: MEMBER_ID,
      resolveAccountId(label) {
        return label === 'Карта Visa' ? ACCOUNT_ID : null;
      },
      resolveCategoryId(kind, label) {
        return kind === 'EXPENSE' && label === 'Synthetic Category' ? CATEGORY_ID : null;
      },
    }),
    sourceIdentityAllocator: Object.freeze({
      async allocate(requests) {
        return Object.freeze(requests.map((request) => Object.freeze({
          currentRowHint: request.currentRowHint,
          sourceRecordId: SOURCE_ID,
        })));
      },
    }),
    transactionIdentityAllocator: Object.freeze({
      async allocate(requests) {
        return Object.freeze(requests.map((request) => Object.freeze({
          sourceRecordId: request.sourceRecordId,
          transactionId: TX_ID,
        })));
      },
    }),
    reconciliationEvidence: matchedEvidence(),
    ...overrides,
  };
}

test('binds the prepared run to the leased digest and commits through the existing lifecycle', async () => {
  const { adapter, observed } = makeAdapter();
  const result = await runPreparedScheduledIncremental(adapter, baseInput());

  assert.equal(result.candidateRun.sourceSnapshotDigest, LEASED_DIGEST);
  assert.equal(result.candidateRun.rowsSeen, 1);
  assert.equal(result.candidateRun.rowsNew, 1);
  assert.equal(result.sourceAssignmentRequestCount, 1);
  assert.equal(result.transactionAssignmentRequestCount, 1);
  assert.equal(result.lifecycle.status, 'COMMITTED');
  assert.equal(result.lifecycle.run.state, 'COMMITTED');
  assert.equal(result.lifecycle.run.sourceSnapshotDigest, LEASED_DIGEST);
  assert.equal(observed.transactionCount, 3);
  assert.equal(observed.statements.some((item) => item.transactionNumber === 3 && item.text.startsWith('INSERT INTO transactions')), true);
  assert.equal(observed.statements.some((item) => item.transactionNumber === 3 && item.text.includes('RETURNING source_record_id')), true);
  assert.equal(observed.statements.some((item) => item.transactionNumber === 3 && item.text.startsWith('INSERT INTO source_records')), true);
  assert.equal(observed.statements.some((item) => item.transactionNumber === 3 && item.text.startsWith('UPDATE migration_runs SET state = $state')), true);
  assert.equal(Object.isFrozen(result), true);
});

test('validation-blocked handoff stops after claim and performs no financial current-state writes', async () => {
  const { adapter, observed } = makeAdapter();
  const checks = Object.fromEntries(INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED']));
  checks[INITIAL_RECONCILIATION_CHECKS[0]] = 'NOT_CHECKED';

  const result = await runPreparedScheduledIncremental(adapter, baseInput({
    reconciliationEvidence: matchedEvidence({ checks: Object.freeze(checks) }),
  }));

  assert.equal(result.lifecycle.status, 'VALIDATION_BLOCKED');
  assert.equal(result.lifecycle.run.state, 'STAGING');
  assert.equal(observed.transactionCount, 1);
  assert.equal(observed.statements.some((item) => item.text.startsWith('INSERT INTO transactions')), false);
  assert.equal(observed.statements.some((item) => item.text.includes('UPDATE transactions SET')), false);
  assert.equal(observed.statements.some((item) => item.text.startsWith('INSERT INTO source_records')), false);
});
