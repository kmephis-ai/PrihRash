import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ScheduledIncrementalApplicationRunner,
  ScheduledIncrementalApplicationRunnerError,
} from '../../dist/migration/scheduledIncrementalApplicationRunner.js';

const BASELINE_RUN = '00000000-0000-0000-0000-000000009001';
const INFLIGHT_RUN = '00000000-0000-0000-0000-000000009002';
const RUN_ID = '00000000-0000-0000-0000-000000009003';
const SOURCE_ID = '00000000-0000-0000-0000-000000009004';
const TX_ID = '00000000-0000-0000-0000-000000009005';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000009006';
const CATEGORY_ID = '00000000-0000-0000-0000-000000009007';
const MEMBER_ID = '00000000-0000-0000-0000-000000009008';
const LEASED_DIGEST = 'leased-application-snapshot-digest';
const STARTED_AT = '2026-09-07T17:00:00.000Z';
const OBSERVED_AT = '2026-09-07T17:00:01.000Z';
const PROMOTED_AT = '2026-09-07T17:00:02.000Z';
const FINISHED_AT = '2026-09-07T17:00:03.000Z';

const rawPayload = Object.freeze({
  adapter_schema_version: 2,
  date: { kind: 'NUMBER', value: '45500' },
  operation_type: { kind: 'STRING', value: 'Расход' },
  expense_account: { kind: 'STRING', value: 'Карта Visa' },
  expense_category: { kind: 'STRING', value: 'Synthetic Category' },
  description: { kind: 'STRING', value: 'Synthetic Application Runner' },
  expense_amount: { kind: 'NUMBER', value: '50' },
  income_account: null,
  income_category: null,
  income_amount: null,
  vika_flag: null,
  note: null,
});

const baselineRun = Object.freeze({
  id: BASELINE_RUN,
  startedAt: '2026-09-07T16:00:00.000Z',
  finishedAt: '2026-09-07T16:01:00.000Z',
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

function observation() {
  return Object.freeze({
    snapshotDigest: LEASED_DIGEST,
    snapshot: Object.freeze({ leaseId: 'synthetic-lease' }),
  });
}

function referenceResolver() {
  return Object.freeze({
    vikaMemberId: MEMBER_ID,
    resolveAccountId(label) {
      return label === 'Карта Visa' ? ACCOUNT_ID : null;
    },
    resolveCategoryId(kind, label) {
      return kind === 'EXPENSE' && label === 'Synthetic Category' ? CATEGORY_ID : null;
    },
  });
}

function dependencies(calls) {
  return Object.freeze({
    projectObservation(received) {
      calls.project += 1;
      calls.order.push('project');
      assert.equal(received, calls.expectedObservation);
      return Object.freeze({
        projection: Object.freeze({
          rows: Object.freeze([Object.freeze({ rowHint: 2, digest: 'row-digest', rawPayload })]),
        }),
        observedAt: OBSERVED_AT,
      });
    },
    createRunContext() {
      calls.context += 1;
      calls.order.push('context');
      return Object.freeze({
        runId: RUN_ID,
        startedAt: STARTED_AT,
      });
    },
    lifecycleClock: Object.freeze({
      now() {
        calls.clock += 1;
        if (calls.clock === 1) {
          calls.order.push('clock-promoted');
          return PROMOTED_AT;
        }
        if (calls.clock === 2) {
          calls.order.push('clock-finished');
          return FINISHED_AT;
        }
        throw new Error('UNEXPECTED_CLOCK_CALL');
      },
    }),
    async readReferenceResolver() {
      calls.referenceRead += 1;
      calls.order.push('read-refs');
      if (calls.referenceError !== null) throw calls.referenceError;
      return referenceResolver();
    },
    sourceIdentityAllocator: Object.freeze({
      async allocate(requests) {
        calls.sourceAllocate += 1;
        calls.order.push('source-allocate');
        return Object.freeze(requests.map((request) => Object.freeze({
          currentRowHint: request.currentRowHint,
          sourceRecordId: SOURCE_ID,
        })));
      },
    }),
    transactionIdentityAllocator: Object.freeze({
      async allocate(requests) {
        calls.transactionAllocate += 1;
        calls.order.push('transaction-allocate');
        return Object.freeze(requests.map((request) => Object.freeze({
          sourceRecordId: request.sourceRecordId,
          transactionId: TX_ID,
        })));
      },
    }),
  });
}

function newCalls() {
  return {
    project: 0,
    context: 0,
    referenceRead: 0,
    referenceError: null,
    sourceAllocate: 0,
    transactionAllocate: 0,
    clock: 0,
    order: [],
    expectedObservation: observation(),
  };
}

function emptyCurrentEvidence(statement) {
  if (statement.text.includes('FROM source_records WHERE')) return { rows: [] };
  if (statement.text.includes('FROM source_record_revisions AS r')) return { rows: [] };
  if (statement.text.includes('FROM transactions')) return { rows: [] };
  return null;
}

test('dependencies expose no injectable reconciliation evidence provider', () => {
  const calls = newCalls();
  const configured = dependencies(calls);
  assert.equal(Object.hasOwn(configured, 'readReconciliationEvidence'), false);
});

test('changed admission fails closed before reference read, projection, allocators, clock or lifecycle writes', async () => {
  const calls = newCalls();
  let transactionCount = 0;
  let writeCount = 0;
  const inFlight = Object.freeze({
    id: INFLIGHT_RUN,
    startedAt: '2026-09-07T16:30:00.000Z',
    finishedAt: null,
    sourceSnapshotDigest: 'other-digest',
    state: 'STAGING',
    rowsSeen: 0,
    rowsNew: 0,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
  });
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('OUTSIDE_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      transactionCount += 1;
      return work({
        async execute(statement) {
          if (statement.kind === 'WRITE') writeCount += 1;
          if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
            return { rows: [evidenceRow(baselineRun), evidenceRow(inFlight)] };
          }
          const current = emptyCurrentEvidence(statement);
          if (current !== null) return current;
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });
  const runner = new ScheduledIncrementalApplicationRunner(adapter, dependencies(calls));

  await assert.rejects(
    () => runner.runIncremental(calls.expectedObservation),
    (error) => error instanceof ScheduledIncrementalApplicationRunnerError
      && error.code === 'ADMISSION_CHANGED_BEFORE_CANDIDATE',
  );

  assert.equal(transactionCount, 1);
  assert.equal(writeCount, 0);
  assert.equal(calls.referenceRead, 0);
  assert.equal(calls.clock, 0);
  assert.deepEqual(calls.order, []);
  assert.equal(runner.lastResult, null);
});

test('reference resolver failure is retried fresh on each admitted invocation and blocks planning/writes', async () => {
  const calls = newCalls();
  calls.referenceError = new Error('SYNTHETIC_REFERENCE_READ_FAILURE');
  let transactionCount = 0;
  let writeCount = 0;
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('OUTSIDE_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      transactionCount += 1;
      return work({
        async execute(statement) {
          if (statement.kind === 'WRITE') writeCount += 1;
          if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
            return { rows: [evidenceRow(baselineRun)] };
          }
          const current = emptyCurrentEvidence(statement);
          if (current !== null) return current;
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });
  const runner = new ScheduledIncrementalApplicationRunner(adapter, dependencies(calls));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => runner.runIncremental(calls.expectedObservation),
      /SYNTHETIC_REFERENCE_READ_FAILURE/,
    );
  }

  assert.equal(transactionCount, 2);
  assert.equal(writeCount, 0);
  assert.equal(calls.referenceRead, 2);
  assert.equal(calls.project, 0);
  assert.equal(calls.context, 0);
  assert.equal(calls.sourceAllocate, 0);
  assert.equal(calls.transactionAllocate, 0);
  assert.equal(calls.clock, 0);
  assert.deepEqual(calls.order, ['read-refs', 'read-refs']);
  assert.equal(runner.lastResult, null);
});

test('happy path reads one fresh resolver after admission before projection and planning', async () => {
  const calls = newCalls();
  const observed = { transactionCount: 0, statements: [] };
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('OUTSIDE_TRANSACTION_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      observed.transactionCount += 1;
      const transactionNumber = observed.transactionCount;
      calls.order.push(`tx-${transactionNumber}`);
      return work({
        async execute(statement) {
          observed.statements.push({ transactionNumber, text: statement.text, kind: statement.kind });

          if (transactionNumber === 1) {
            if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
              return { rows: [evidenceRow(baselineRun)] };
            }
            const current = emptyCurrentEvidence(statement);
            if (current !== null) return current;
          }

          if (transactionNumber === 2) {
            if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
              return { rows: [evidenceRow(baselineRun)] };
            }
            if (statement.text.startsWith('INSERT INTO migration_runs')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return { rows: [evidenceRow(candidateRun())] };
            }
          }

          if (transactionNumber === 3) {
            if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) return { rows: [] };
            if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
              return { rows: [lifecycleRow(candidateRun('VALIDATED'))] };
            }
          }

          if (transactionNumber === 4) {
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
  const runner = new ScheduledIncrementalApplicationRunner(adapter, dependencies(calls));

  await runner.runIncremental(calls.expectedObservation);

  assert.deepEqual(calls.order, [
    'tx-1',
    'read-refs',
    'project',
    'context',
    'source-allocate',
    'transaction-allocate',
    'tx-2',
    'tx-3',
    'clock-promoted',
    'clock-finished',
    'tx-4',
  ]);
  assert.equal(calls.referenceRead, 1);
  assert.equal(calls.clock, 2);
  assert.equal(runner.lastResult?.lifecycle.status, 'COMMITTED');
  assert.equal(runner.lastResult?.candidateRun.sourceSnapshotDigest, LEASED_DIGEST);
  assert.equal(runner.lastResult?.lifecycle.run.finishedAt, FINISHED_AT);
  assert.equal(observed.transactionCount, 4);
  assert.deepEqual(
    observed.statements.filter((item) => item.transactionNumber === 1).map((item) => item.kind),
    ['READ', 'READ', 'READ', 'READ'],
  );
  assert.equal(
    observed.statements.some(
      (item) => item.transactionNumber === 4 && item.text.startsWith('INSERT INTO transactions'),
    ),
    true,
  );
  assert.equal(
    observed.statements.some(
      (item) => item.transactionNumber === 4 && item.text.startsWith('INSERT INTO source_records'),
    ),
    true,
  );
});
