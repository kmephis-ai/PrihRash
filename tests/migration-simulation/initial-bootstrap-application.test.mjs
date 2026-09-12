import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YdbAdapter,
  YdbTransportCommitOutcomeUnknownError,
} from '../../dist/integration/ydb/adapter.js';
import {
  InitialBootstrapApplicationError,
  runInitialBootstrapApplication,
} from '../../dist/migration/initialBootstrapApplication.js';
import { InitialBootstrapIdentityManifestError } from '../../dist/migration/initialBootstrapIdentityManifest.js';
import { InitialBootstrapError } from '../../dist/migration/initialSnapshot.js';
import { INITIAL_RECONCILIATION_CHECKS } from '../../dist/migration/initialValidationGate.js';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SNAPSHOT_ID = id(451001);
const RUN_ID = id(451002);
const SOURCE_1 = id(451003);
const SOURCE_2 = id(451004);
const TX_1 = id(451101);
const TX_2 = id(451102);
const ACCOUNT_ID = id(451201);
const CATEGORY_ID = id(451202);
const VIKA_ID = id(451203);
const DIGEST = 'synthetic-initial-bootstrap-snapshot-digest';
const CAPTURED_AT = '2026-09-12T07:00:00Z';
const STARTED_AT = '2026-09-12T07:00:01Z';
const PROMOTED_AT = '2026-09-12T07:00:02Z';
const FINISHED_AT = '2026-09-12T07:00:03Z';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function expense(description = 'Synthetic bootstrap expense') {
  return {
    adapter_schema_version: 3,
    date: N('45292.5'),
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
  };
}

function observation(rows = [{ rowHint: 2, digest: 'synthetic-row-1', rawPayload: expense(), aggregatePeriodMonth: null }], capturedAt = CAPTURED_AT) {
  return Object.freeze({
    capturedAt,
    snapshotDigest: DIGEST,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  });
}

const projectionContext = Object.freeze({
  refs: Object.freeze({
    vikaMemberId: VIKA_ID,
    resolveAccountId(label) {
      return label === 'Карта Visa' ? ACCOUNT_ID : null;
    },
    resolveCategoryId(kind, label) {
      return kind === 'EXPENSE' && label === 'Synthetic Expense' ? CATEGORY_ID : null;
    },
  }),
  granularityEvidence: Object.freeze({
    coarseExpenseOrdinalRange: Object.freeze({ startInclusive: 100, endExclusive: 110 }),
  }),
});

function matchedReconciliation() {
  return Object.freeze({
    checks: Object.freeze(Object.fromEntries(
      INITIAL_RECONCILIATION_CHECKS.map((check) => [check, 'MATCHED']),
    )),
    unexplainedHighImpactMismatchCount: 0,
  });
}

function clock(...values) {
  let index = 0;
  return Object.freeze({
    now() {
      const value = values[index];
      assert.notEqual(value, undefined, 'unexpected clock read');
      index += 1;
      return value;
    },
    reads() { return index; },
  });
}

function allocator({ sourceIds = [SOURCE_1, SOURCE_2], transactionIds = [TX_1, TX_2], forbid = false } = {}) {
  const calls = [];
  let sourceIndex = 0;
  let transactionIndex = 0;
  function next(kind, values) {
    calls.push(kind);
    if (forbid) throw new Error(`allocator called during resume: ${kind}`);
    const value = values[kind === 'source' ? sourceIndex++ : transactionIndex++];
    assert.notEqual(value, undefined, `missing synthetic ${kind} id`);
    return value;
  }
  return {
    calls,
    value: Object.freeze({
      allocateSnapshotId() {
        calls.push('snapshot');
        if (forbid) throw new Error('allocator called during resume: snapshot');
        return SNAPSHOT_ID;
      },
      allocateMigrationRunId() {
        calls.push('run');
        if (forbid) throw new Error('allocator called during resume: run');
        return RUN_ID;
      },
      allocateSourceRecordId() { return next('source', sourceIds); },
      allocateTransactionId() { return next('transaction', transactionIds); },
    }),
  };
}

function parameter(statement, name) {
  return statement.parameters[name]?.value ?? null;
}

function migrationRunRow(values) {
  return {
    id: values.id,
    started_at: values.started_at,
    finished_at: values.finished_at,
    source_snapshot_digest: values.source_snapshot_digest,
    state: values.state,
    rows_seen: values.rows_seen,
    rows_new: values.rows_new,
    rows_changed: values.rows_changed,
    rows_missing: values.rows_missing,
    rows_ambiguous: values.rows_ambiguous,
    error_code: values.error_code,
  };
}

function createState(seed = {}) {
  const state = {
    sourceSnapshots: new Map(),
    migrationRuns: new Map(),
    manifests: new Map(),
    revisions: new Map(),
    sourceRecords: new Map(),
    transactions: new Map(),
  };
  for (const [name, entries] of Object.entries(seed)) {
    const target = state[name];
    if (!(target instanceof Map)) continue;
    for (const [key, value] of entries) target.set(key, structuredClone(value));
  }
  return state;
}

function replaceState(target, source) {
  for (const key of Object.keys(target)) {
    target[key] = source[key];
  }
}

function admissionRows(state) {
  return [...state.migrationRuns.values()]
    .filter((run) => ['COMMITTED', 'STAGING', 'VALIDATED'].includes(run.state))
    .map(migrationRunRow);
}

function sourceAggregateRows(state) {
  const counts = new Map();
  for (const record of state.sourceRecords.values()) {
    const key = `${record.classification}|${String(record.state)}`;
    const existing = counts.get(key) ?? { classification: record.classification, state: record.state, row_count: 0n };
    existing.row_count += 1n;
    counts.set(key, existing);
  }
  return [...counts.values()];
}

function typeAggregateRows(state) {
  const values = new Map();
  for (const tx of state.transactions.values()) {
    const current = values.get(tx.type) ?? { type: tx.type, row_count: 0n, total_amount_minor: 0n };
    current.row_count += 1n;
    current.total_amount_minor += BigInt(tx.amount_minor);
    values.set(tx.type, current);
  }
  return [...values.values()];
}

function dimensionRows(state, field, requiredType = null) {
  const values = new Map();
  for (const tx of state.transactions.values()) {
    if (requiredType !== null && tx.type !== requiredType) continue;
    const dimension = tx[field];
    const key = `${tx.type}|${dimension}`;
    const current = values.get(key) ?? {
      type: tx.type,
      dimension_id: dimension,
      row_count: 0n,
      total_amount_minor: 0n,
    };
    current.row_count += 1n;
    current.total_amount_minor += BigInt(tx.amount_minor);
    values.set(key, current);
  }
  return [...values.values()];
}

function statementRows(statement, state) {
  const text = statement.text;
  if (text.includes("FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
    return admissionRows(state);
  }
  if (text.includes('FROM initial_bootstrap_identity_manifests AS m')) {
    const runId = parameter(statement, 'migration_run_id');
    const manifest = state.manifests.get(runId);
    const run = state.migrationRuns.get(runId);
    const snapshot = manifest === undefined ? undefined : state.sourceSnapshots.get(manifest.source_snapshot_id);
    if (manifest === undefined || run === undefined || snapshot === undefined) return [];
    return [{
      source_snapshot_id: manifest.source_snapshot_id,
      source_snapshot_digest: manifest.source_snapshot_digest,
      binding_count: manifest.binding_count,
      bindings: manifest.bindings,
      run_state: run.state,
      run_snapshot_digest: run.source_snapshot_digest,
      snapshot_digest: snapshot.snapshot_digest,
      snapshot_row_count: snapshot.row_count,
    }];
  }
  if (text.includes('FROM source_snapshots WHERE id = $id')) {
    const snapshot = state.sourceSnapshots.get(parameter(statement, 'id'));
    return snapshot === undefined ? [] : [{ ...snapshot }];
  }
  if (text.includes('FROM source_record_revisions') && text.includes('migration_run_id = $migration_run_id')) {
    const runId = parameter(statement, 'migration_run_id');
    return [...state.revisions.values()].filter((revision) => revision.migration_run_id === runId);
  }
  if (text.includes('FROM migration_runs WHERE id = $id')) {
    const run = state.migrationRuns.get(parameter(statement, 'id'));
    return run === undefined ? [] : [migrationRunRow(run)];
  }
  if (text.includes('FROM `source_records` GROUP BY classification, state')) return sourceAggregateRows(state);
  if (text.includes('FROM `transactions` GROUP BY type')) return typeAggregateRows(state);
  if (text.includes('category_id AS dimension_id')) return dimensionRows(state, 'category_id');
  if (text.includes("from_account_id AS dimension_id") && text.includes("WHERE type = 'EXPENSE'")) {
    return dimensionRows(state, 'from_account_id', 'EXPENSE');
  }
  if (text.includes("to_account_id AS dimension_id") && text.includes("WHERE type = 'INCOME'")) {
    return dimensionRows(state, 'to_account_id', 'INCOME');
  }
  throw new Error(`unexpected read: ${text}`);
}

function applyWrite(statement, state) {
  const text = statement.text;
  if (text.startsWith('INSERT INTO source_snapshots')) {
    state.sourceSnapshots.set(parameter(statement, 'id'), {
      captured_at: parameter(statement, 'captured_at'),
      source_sheet: parameter(statement, 'source_sheet'),
      snapshot_digest: parameter(statement, 'snapshot_digest'),
      row_count: BigInt(parameter(statement, 'row_count')),
    });
    return [];
  }
  if (text.startsWith('INSERT INTO migration_runs')) {
    state.migrationRuns.set(parameter(statement, 'id'), {
      id: parameter(statement, 'id'),
      started_at: parameter(statement, 'started_at'),
      finished_at: parameter(statement, 'finished_at'),
      source_snapshot_digest: parameter(statement, 'source_snapshot_digest'),
      state: parameter(statement, 'state'),
      rows_seen: BigInt(parameter(statement, 'rows_seen')),
      rows_new: BigInt(parameter(statement, 'rows_new')),
      rows_changed: BigInt(parameter(statement, 'rows_changed')),
      rows_missing: BigInt(parameter(statement, 'rows_missing')),
      rows_ambiguous: BigInt(parameter(statement, 'rows_ambiguous')),
      error_code: parameter(statement, 'error_code'),
    });
    return [];
  }
  if (text.startsWith('INSERT INTO initial_bootstrap_identity_manifests')) {
    state.manifests.set(parameter(statement, 'migration_run_id'), {
      source_snapshot_id: parameter(statement, 'source_snapshot_id'),
      source_snapshot_digest: parameter(statement, 'source_snapshot_digest'),
      binding_count: BigInt(parameter(statement, 'binding_count')),
      bindings: parameter(statement, 'bindings'),
    });
    return [];
  }
  if (text.startsWith('INSERT INTO source_record_revisions')) {
    const sourceRecordId = parameter(statement, 'source_record_id');
    const revision = Number(parameter(statement, 'revision'));
    const key = `${sourceRecordId}|${revision}`;
    if (state.revisions.has(key)) throw new Error('synthetic duplicate revision');
    state.revisions.set(key, {
      source_record_id: sourceRecordId,
      revision: BigInt(revision),
      migration_run_id: parameter(statement, 'migration_run_id'),
      observed_at: parameter(statement, 'observed_at'),
      row_hint: BigInt(parameter(statement, 'row_hint')),
      row_digest: parameter(statement, 'row_digest'),
      change_class: parameter(statement, 'change_class'),
      raw_payload: parameter(statement, 'raw_payload'),
    });
    return [];
  }
  if (text.startsWith('UPDATE migration_runs SET rows_ambiguous')) {
    const run = state.migrationRuns.get(parameter(statement, 'id'));
    if (run !== undefined && run.state === parameter(statement, 'expected_state')) {
      run.rows_ambiguous = BigInt(parameter(statement, 'rows_ambiguous'));
    }
    return [];
  }
  if (text.startsWith('UPDATE migration_runs SET state = $state')) {
    const run = state.migrationRuns.get(parameter(statement, 'id'));
    if (run === undefined || run.state !== parameter(statement, 'expected_state')) return [];
    run.state = parameter(statement, 'state');
    run.finished_at = parameter(statement, 'finished_at');
    run.error_code = parameter(statement, 'error_code');
    return text.includes('RETURNING id') ? [{ id: run.id }] : [];
  }
  if (text.startsWith('UPSERT INTO transactions')) {
    const values = Object.fromEntries(Object.entries(statement.parameters).map(([key, value]) => [key, value.value]));
    state.transactions.set(values.id, values);
    return [];
  }
  if (text.startsWith('UPSERT INTO source_records')) {
    const values = Object.fromEntries(Object.entries(statement.parameters).map(([key, value]) => [key, value.value]));
    state.sourceRecords.set(values.id, values);
    return [];
  }
  throw new Error(`unexpected write: ${text}`);
}

function fakeDatabase({ seed = {}, unknownCommitAt = null } = {}) {
  const state = createState(seed);
  const events = [];
  let transactionCount = 0;
  const transport = {
    async executeRead(statement) {
      events.push(`read:${statement.text.slice(0, 24)}`);
      return { rows: statementRows(statement, state) };
    },
    async serializableReadWrite(work) {
      transactionCount += 1;
      const currentTransaction = transactionCount;
      const working = structuredClone(state);
      events.push(`tx:${currentTransaction}:begin`);
      const transaction = {
        async execute(statement) {
          if (statement.kind === 'READ') return { rows: statementRows(statement, working) };
          return { rows: applyWrite(statement, working) };
        },
      };
      try {
        const result = await work(transaction);
        replaceState(state, working);
        events.push(`tx:${currentTransaction}:commit`);
        if (unknownCommitAt === currentTransaction) {
          throw new YdbTransportCommitOutcomeUnknownError(new Error('synthetic unknown commit'));
        }
        return result;
      } catch (error) {
        if (error instanceof YdbTransportCommitOutcomeUnknownError) throw error;
        events.push(`tx:${currentTransaction}:rollback`);
        throw error;
      }
    },
  };
  return { state, events, adapter: new YdbAdapter(transport) };
}

function dependencies(db, ids, lifecycleClock, overrides = {}) {
  return Object.freeze({
    adapter: db.adapter,
    identityAllocator: ids.value,
    projectionContext: overrides.projectionContext ?? projectionContext,
    reconciliation: overrides.reconciliation ?? Object.freeze({
      async reconcile() {
        assert.ok(db.state.revisions.size > 0, 'reconciliation must run after durable revision evidence');
        assert.equal(db.state.sourceRecords.size, 0, 'verified current must still be untouched before reconciliation');
        assert.equal(db.state.transactions.size, 0, 'verified current must still be untouched before reconciliation');
        return matchedReconciliation();
      },
    }),
    clock: lifecycleClock,
  });
}

function stagingSeed({ state = 'STAGING', capturedAt = CAPTURED_AT } = {}) {
  const run = {
    id: RUN_ID,
    started_at: STARTED_AT,
    finished_at: null,
    source_snapshot_digest: DIGEST,
    state,
    rows_seen: 1n,
    rows_new: 1n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
  };
  return {
    migrationRuns: [[RUN_ID, run]],
    sourceSnapshots: [[SNAPSHOT_ID, {
      captured_at: capturedAt,
      source_sheet: 'Ответы на форму (11)',
      snapshot_digest: DIGEST,
      row_count: 1n,
    }]],
    manifests: [[RUN_ID, {
      source_snapshot_id: SNAPSHOT_ID,
      source_snapshot_digest: DIGEST,
      binding_count: 1n,
      bindings: JSON.stringify({
        schema_version: 1,
        bindings: [{
          source_ordinal: 0,
          row_hint: 2,
          row_digest: 'synthetic-row-1',
          source_record_id: SOURCE_1,
          transaction_id: TX_1,
        }],
      }),
    }]],
  };
}

test('fresh synthetic financial bootstrap claims evidence, validates and atomically commits verified current', async () => {
  const db = fakeDatabase();
  const ids = allocator();
  const lifecycleClock = clock(STARTED_AT, PROMOTED_AT, FINISHED_AT);

  const result = await runInitialBootstrapApplication(
    observation(),
    dependencies(db, ids, lifecycleClock),
  );

  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.run.state, 'COMMITTED');
  assert.equal(db.state.migrationRuns.get(RUN_ID).state, 'COMMITTED');
  assert.equal(db.state.revisions.size, 1);
  assert.equal(db.state.sourceRecords.get(SOURCE_1).transaction_id, TX_1);
  assert.equal(db.state.transactions.get(TX_1).amount_minor, 1234n);
  assert.deepEqual(ids.calls, ['source', 'snapshot', 'run', 'transaction']);
  assert.equal(lifecycleClock.reads(), 3);
});

test('exact STAGING claim resumes durable identities without allocator reuse and preserves original captured_at', async () => {
  const db = fakeDatabase({ seed: stagingSeed() });
  const ids = allocator({ forbid: true });
  const lifecycleClock = clock(PROMOTED_AT, FINISHED_AT);
  const retryObservation = observation(undefined, '2026-09-12T07:30:00Z');

  const result = await runInitialBootstrapApplication(
    retryObservation,
    dependencies(db, ids, lifecycleClock),
  );

  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(ids.calls, []);
  assert.equal(db.state.revisions.get(`${SOURCE_1}|1`).observed_at, CAPTURED_AT);
  assert.equal(db.state.sourceRecords.get(SOURCE_1).transaction_id, TX_1);
});



test('existing COMMITTED baseline blocks a second initial bootstrap before any new identity allocation', async () => {
  const committed = {
    id: RUN_ID,
    started_at: STARTED_AT,
    finished_at: FINISHED_AT,
    source_snapshot_digest: DIGEST,
    state: 'COMMITTED',
    rows_seen: 1n,
    rows_new: 1n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
  };
  const db = fakeDatabase({ seed: { migrationRuns: [[RUN_ID, committed]] } });
  const ids = allocator({ forbid: true });
  const lifecycleClock = clock();

  const result = await runInitialBootstrapApplication(
    observation(),
    dependencies(db, ids, lifecycleClock),
  );

  assert.equal(result.status, 'BASELINE_EXISTS');
  assert.equal(result.run.id, RUN_ID);
  assert.deepEqual(ids.calls, []);
});

test('STAGING resume with changed immutable row evidence fails closed without reallocating identity', async () => {
  const db = fakeDatabase({ seed: stagingSeed() });
  const ids = allocator({ forbid: true });
  const lifecycleClock = clock();
  const changed = observation([
    { rowHint: 2, digest: 'changed-row-digest', rawPayload: expense(), aggregatePeriodMonth: null },
  ]);

  await assert.rejects(
    () => runInitialBootstrapApplication(changed, dependencies(db, ids, lifecycleClock)),
    (error) => error instanceof InitialBootstrapIdentityManifestError
      && error.code === 'MANIFEST_EVIDENCE_MISMATCH',
  );
  assert.deepEqual(ids.calls, []);
  assert.equal(db.state.sourceRecords.size, 0);
  assert.equal(db.state.transactions.size, 0);
});

test('unknown account fails closed after durable claim/evidence and never promotes guessed current state', async () => {
  const db = fakeDatabase();
  const ids = allocator();
  const lifecycleClock = clock(STARTED_AT);
  const unknownRefs = Object.freeze({
    ...projectionContext,
    refs: Object.freeze({
      ...projectionContext.refs,
      resolveAccountId() { return null; },
    }),
  });

  const result = await runInitialBootstrapApplication(
    observation(),
    dependencies(db, ids, lifecycleClock, { projectionContext: unknownRefs }),
  );

  assert.equal(result.status, 'VALIDATION_BLOCKED');
  assert.equal(result.blockers.some((blocker) => blocker.code === 'PROJECTION_FAILURES_PRESENT'), true);
  assert.equal(db.state.migrationRuns.get(RUN_ID).state, 'STAGING');
  assert.equal(db.state.sourceRecords.size, 0);
  assert.equal(db.state.transactions.size, 0);
  assert.deepEqual(ids.calls, ['source', 'snapshot', 'run']);
});

test('duplicate allocated SourceRecord identity fails before durable claim instead of deduping rows', async () => {
  const db = fakeDatabase();
  const ids = allocator({ sourceIds: [SOURCE_1, SOURCE_1], transactionIds: [TX_1, TX_2] });
  const lifecycleClock = clock(STARTED_AT);
  const duplicateRows = observation([
    { rowHint: 2, digest: 'synthetic-row-1', rawPayload: expense(), aggregatePeriodMonth: null },
    { rowHint: 3, digest: 'synthetic-row-2', rawPayload: expense(), aggregatePeriodMonth: null },
  ]);

  await assert.rejects(
    () => runInitialBootstrapApplication(duplicateRows, dependencies(db, ids, lifecycleClock)),
    (error) => error instanceof InitialBootstrapError && error.code === 'DUPLICATE_SOURCE_RECORD_ID',
  );
  assert.equal(db.state.migrationRuns.size, 0);
  assert.equal(db.state.sourceRecords.size, 0);
});

test('pre-existing canonical current evidence blocks initial bootstrap before identity allocation', async () => {
  const db = fakeDatabase();
  db.state.sourceRecords.set(SOURCE_2, {
    id: SOURCE_2,
    classification: 'NON_FINANCIAL',
    state: null,
  });
  const ids = allocator({ forbid: true });
  const lifecycleClock = clock();

  await assert.rejects(
    () => runInitialBootstrapApplication(observation(), dependencies(db, ids, lifecycleClock)),
    (error) => error instanceof InitialBootstrapApplicationError && error.code === 'CURRENT_STATE_NOT_EMPTY',
  );
  assert.deepEqual(ids.calls, []);
  assert.equal(db.state.migrationRuns.size, 0);
});

test('oversized ordinary promotion is surfaced as CONTROLLED_REBUILD_REQUIRED with current state untouched', async () => {
  const db = fakeDatabase();
  const ids = allocator();
  const lifecycleClock = clock(STARTED_AT, PROMOTED_AT);
  const largeDescription = 'x'.repeat(300_000);
  const largeObservation = observation([
    { rowHint: 2, digest: 'synthetic-large-row-1', rawPayload: expense(largeDescription), aggregatePeriodMonth: null },
    { rowHint: 3, digest: 'synthetic-large-row-2', rawPayload: expense(largeDescription), aggregatePeriodMonth: null },
  ]);

  const result = await runInitialBootstrapApplication(
    largeObservation,
    dependencies(db, ids, lifecycleClock),
  );

  assert.equal(result.status, 'CONTROLLED_REBUILD_REQUIRED');
  assert.equal(result.preflight.eligible, false);
  assert.equal(db.state.migrationRuns.get(RUN_ID).state, 'STAGING');
  assert.equal(db.state.sourceRecords.size, 0);
  assert.equal(db.state.transactions.size, 0);
});

test('unknown claim commit returns explicit recovery-required without touching verified current', async () => {
  const db = fakeDatabase({ unknownCommitAt: 2 });
  const ids = allocator();
  const lifecycleClock = clock(STARTED_AT);

  const result = await runInitialBootstrapApplication(
    observation(),
    dependencies(db, ids, lifecycleClock),
  );

  assert.deepEqual(result, {
    status: 'RECOVERY_REQUIRED',
    run: null,
    reason: 'CLAIM_OUTCOME_UNKNOWN',
  });
  assert.equal(db.state.sourceRecords.size, 0);
  assert.equal(db.state.transactions.size, 0);
});

test('unknown atomic promotion commit is never reported as success and is not blindly replayed', async () => {
  const db = fakeDatabase({ unknownCommitAt: 6 });
  const ids = allocator();
  const lifecycleClock = clock(STARTED_AT, PROMOTED_AT, FINISHED_AT);

  const result = await runInitialBootstrapApplication(
    observation(),
    dependencies(db, ids, lifecycleClock),
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.reason, 'PROMOTION_OUTCOME_UNKNOWN');
  // Synthetic transport deliberately committed before losing the ACK: durable state may be committed,
  // but the application refuses to infer success from an unknown transport outcome.
  assert.equal(db.state.migrationRuns.get(RUN_ID).state, 'COMMITTED');
  assert.equal(db.state.sourceRecords.size, 1);
  assert.equal(db.state.transactions.size, 1);
});

test('durable VALIDATED run requires explicit recovery and cannot re-enter promotion', async () => {
  const db = fakeDatabase({ seed: stagingSeed({ state: 'VALIDATED' }) });
  const ids = allocator({ forbid: true });
  const lifecycleClock = clock();

  const result = await runInitialBootstrapApplication(
    observation(),
    dependencies(db, ids, lifecycleClock),
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.reason, 'VALIDATED_RUN_REQUIRES_RECOVERY');
  assert.equal(db.state.sourceRecords.size, 0);
  assert.equal(db.state.transactions.size, 0);
  assert.deepEqual(ids.calls, []);
});
