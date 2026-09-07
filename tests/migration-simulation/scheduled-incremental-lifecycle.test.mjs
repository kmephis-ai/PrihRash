import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { INITIAL_RECONCILIATION_CHECKS } from '../../dist/migration/initialValidationGate.js';
import { runScheduledIncrementalLifecycle } from '../../dist/migration/scheduledIncrementalLifecycle.js';

const BASELINE_ID = '00000000-0000-0000-0000-000000009001';
const RUN_ID = '00000000-0000-0000-0000-000000009002';
const TX_ID = '00000000-0000-0000-0000-000000009003';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000009004';
const CATEGORY_ID = '00000000-0000-0000-0000-000000009005';

const baseline = Object.freeze({
  id: BASELINE_ID,
  startedAt: '2026-09-07T12:00:00.000Z',
  finishedAt: '2026-09-07T12:01:00.000Z',
  sourceSnapshotDigest: 'baseline-digest',
  state: 'COMMITTED',
  rowsSeen: 0,
  rowsNew: 0,
  rowsChanged: 0,
  rowsMissing: 0,
  rowsAmbiguous: 0,
  errorCode: null,
});

const candidate = Object.freeze({
  id: RUN_ID,
  startedAt: '2026-09-07T13:00:00.000Z',
  finishedAt: null,
  sourceSnapshotDigest: 'current-digest',
  state: 'STAGING',
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

function matchedReconciliation(overrides = {}) {
  return Object.freeze({
    checks: Object.freeze(Object.fromEntries(INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED']))),
    unexplainedHighImpactMismatchCount: 0,
    ...overrides,
  });
}

const sourceDelta = Object.freeze({ intents: Object.freeze([]), unresolvedBlocks: Object.freeze([]) });
const reconciliationPlan = Object.freeze({ expected: Object.freeze({}), promotionBlocker: null });
const emptyCurrentDelta = Object.freeze({
  sourceIntents: Object.freeze([]),
  transactionIntents: Object.freeze([]),
  promotionBlocker: null,
});
const emptyRevisions = Object.freeze({ revisions: Object.freeze([]) });

function makeAdapter(mode) {
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
              return { rows: [evidenceRow(baseline)] };
            }
            if (statement.text.startsWith('INSERT INTO migration_runs')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return { rows: [evidenceRow(candidate)] };
            }
          }

          if (transactionNumber === 2) {
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return { rows: [lifecycleRow({ ...candidate, state: 'VALIDATED' })] };
            }
          }

          if (transactionNumber === 3 && mode === 'COMMIT') {
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) {
              return { rows: [{ id: RUN_ID }] };
            }
          }

          if (transactionNumber === 3 && mode === 'FAILED_PRECHECK') {
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return {
                rows: [lifecycleRow({
                  ...candidate,
                  state: 'FAILED',
                  finishedAt: '2026-09-07T13:02:00.000Z',
                  errorCode: 'PROMOTION_TOO_LARGE',
                })],
              };
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
    expectedBaseline: baseline,
    candidateRun: candidate,
    sourceDelta,
    reconciliationPlan,
    reconciliationEvidence: matchedReconciliation(),
    currentDelta: emptyCurrentDelta,
    revisions: emptyRevisions,
    promotedAt: '2026-09-07T13:01:00.000Z',
    finishedAt: '2026-09-07T13:02:00.000Z',
    ...overrides,
  };
}

test('claims first and leaves a validation-blocked run in recoverable STAGING without financial writes', async () => {
  const { adapter, observed } = makeAdapter('BLOCKED');
  const reconciliationEvidence = matchedReconciliation({
    checks: Object.freeze({
      ...Object.fromEntries(INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED'])),
      [INITIAL_RECONCILIATION_CHECKS[0]]: 'NOT_CHECKED',
    }),
  });

  const result = await runScheduledIncrementalLifecycle(adapter, baseInput({ reconciliationEvidence }));

  assert.equal(result.status, 'VALIDATION_BLOCKED');
  assert.equal(result.run.state, 'STAGING');
  assert.equal(observed.transactionCount, 1);
  assert.equal(observed.statements.some((item) => item.text.includes('transactions SET')), false);
  assert.equal(observed.statements.some((item) => item.text.startsWith('INSERT INTO transactions')), false);
});

test('persists VALIDATED before delegating the atomic commit marker', async () => {
  const { adapter, observed } = makeAdapter('COMMIT');

  const result = await runScheduledIncrementalLifecycle(adapter, baseInput());

  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.run.state, 'COMMITTED');
  assert.equal(observed.transactionCount, 3);
  assert.equal(observed.statements[0].transactionNumber, 1);
  assert.equal(observed.statements.some((item) => item.transactionNumber === 2 && item.text.includes('expected_state')), true);
  assert.equal(observed.statements.some((item) => item.transactionNumber === 3 && item.text.includes('RETURNING id')), true);
});

test('durably closes an already VALIDATED run when promotion preflight is too large', async () => {
  const { adapter, observed } = makeAdapter('FAILED_PRECHECK');
  const hugeDescription = 'x'.repeat(600 * 1024);
  const hugeCurrentDelta = Object.freeze({
    sourceIntents: Object.freeze([]),
    transactionIntents: Object.freeze([Object.freeze({
      kind: 'CREATE_TRANSACTION',
      candidate: Object.freeze({
        id: TX_ID,
        version: 1,
        transaction: Object.freeze({
          type: 'EXPENSE',
          occurredOn: '2026-09-07',
          recordGranularity: 'TRANSACTION',
          datePrecision: 'DAY',
          aggregatePeriodMonth: null,
          financialPeriodId: null,
          periodAssignmentQuality: 'UNASSIGNED',
          amountMinor: 100,
          currency: 'RUB',
          fromAccountId: ACCOUNT_ID,
          toAccountId: null,
          categoryId: CATEGORY_ID,
          paidByMemberId: null,
          description: hugeDescription,
          note: null,
          status: 'ACTIVE',
          analyticsState: 'INCLUDED',
          flowKind: 'NORMAL',
        }),
      }),
    })]),
    promotionBlocker: null,
  });

  const result = await runScheduledIncrementalLifecycle(adapter, baseInput({ currentDelta: hugeCurrentDelta }));

  assert.equal(result.status, 'FAILED_PRECHECK');
  assert.equal(result.errorCode, 'PROMOTION_TOO_LARGE');
  assert.equal(result.run.state, 'FAILED');
  assert.equal(result.run.errorCode, 'PROMOTION_TOO_LARGE');
  assert.equal(observed.transactionCount, 3);
  assert.equal(observed.statements.some((item) => item.text.startsWith('INSERT INTO transactions')), false);
});
