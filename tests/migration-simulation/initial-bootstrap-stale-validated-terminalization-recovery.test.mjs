import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome,
  INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE,
} from '../../dist/migration/initialBootstrapStaleValidatedTerminalization.js';

const RUN_ID = '00000000-0000-0000-0000-000000000951';
const DIGEST = 'synthetic-stale-validated-snapshot';
const STARTED_AT = '2026-09-20T12:00:00Z';
const FINISHED_AT = '2026-09-20T18:00:00Z';

const VALIDATED = Object.freeze({
  id: RUN_ID,
  startedAt: STARTED_AT,
  finishedAt: null,
  sourceSnapshotDigest: DIGEST,
  state: 'VALIDATED',
  rowsSeen: 2,
  rowsNew: 2,
  rowsChanged: 0,
  rowsMissing: 0,
  rowsAmbiguous: 0,
  errorCode: null,
});

function row(state = 'VALIDATED', overrides = {}) {
  return {
    state,
    finished_at: state === 'FAILED' ? FINISHED_AT : null,
    error_code: state === 'FAILED' ? INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE : null,
    source_snapshot_digest: DIGEST,
    rows_seen: 2n,
    rows_new: 2n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    ...overrides,
  };
}

function fixture({ rows = [row()], sourceCount = 0n, transactionCount = 0n, readFailure = false } = {}) {
  const reads = [];
  const transport = {
    async executeRead(statement) {
      reads.push(statement);
      if (readFailure) throw new Error('synthetic read failure');
      if (statement.text.startsWith('SELECT state, finished_at, error_code')) return { rows };
      if (statement.text === 'SELECT COUNT(*) AS row_count FROM source_records') {
        return { rows: [{ row_count: sourceCount }] };
      }
      if (statement.text === 'SELECT COUNT(*) AS row_count FROM transactions') {
        return { rows: [{ row_count: transactionCount }] };
      }
      throw new Error(`unexpected read: ${statement.text}`);
    },
    async serializableReadWrite() {
      throw new Error('write transaction not allowed in read-only recovery');
    },
  };
  return { adapter: new YdbAdapter(transport), reads };
}

test('unknown marker outcome is APPLIED only for exact FAILED marker plus exact empty current', async () => {
  const f = fixture({ rows: [row('FAILED')] });
  assert.deepEqual(
    await diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome(f.adapter, VALIDATED, FINISHED_AT),
    { verdict: 'APPLIED', reason: 'EXACT_FAILED_MARKER' },
  );
  assert.equal(f.reads.length, 3);
  assert.equal(f.reads.every((statement) => statement.kind === 'READ'), true);
});

test('unchanged exact VALIDATED remains recovery-required and never authorizes automatic retry', async () => {
  const f = fixture();
  assert.deepEqual(
    await diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome(f.adapter, VALIDATED, FINISHED_AT),
    { verdict: 'RECOVERY_REQUIRED', reason: 'UNCHANGED_VALIDATED_NO_RETRY' },
  );
  assert.equal(f.reads.length, 1);
});

test('marker recovery fails closed on missing, ambiguous, mismatched or unreadable terminal evidence', async () => {
  const cases = [
    { fixture: fixture({ rows: [] }), reason: 'TERMINAL_ROW_MISSING' },
    { fixture: fixture({ rows: [row(), row()] }), reason: 'TERMINAL_ROW_AMBIGUOUS' },
    { fixture: fixture({ rows: [row('FAILED', { rows_seen: 3n })] }), reason: 'TERMINAL_ROW_MISMATCH' },
    { fixture: fixture({ readFailure: true }), reason: 'READ_FAILED' },
  ];
  for (const entry of cases) {
    assert.deepEqual(
      await diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome(
        entry.fixture.adapter,
        VALIDATED,
        FINISHED_AT,
      ),
      { verdict: 'RECOVERY_REQUIRED', reason: entry.reason },
    );
  }
});

test('exact FAILED marker is not APPLIED when canonical current is non-empty', async () => {
  for (const f of [
    fixture({ rows: [row('FAILED')], sourceCount: 1n }),
    fixture({ rows: [row('FAILED')], transactionCount: 1n }),
  ]) {
    assert.deepEqual(
      await diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome(f.adapter, VALIDATED, FINISHED_AT),
      { verdict: 'RECOVERY_REQUIRED', reason: 'VERIFIED_CURRENT_STATE_NOT_EMPTY' },
    );
  }
});

test('durable recovery accepts exactly one terminal marker plus empty current', async () => {
  const reads = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      reads.push(statement);
      if (statement.text.includes("state = 'FAILED' AND error_code = 'INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT'")) {
        return { rows: [{ row_count: 1n }] };
      }
      if (statement.text === 'SELECT COUNT(*) AS row_count FROM source_records') return { rows: [{ row_count: 0n }] };
      if (statement.text === 'SELECT COUNT(*) AS row_count FROM transactions') return { rows: [{ row_count: 0n }] };
      throw new Error(`unexpected read: ${statement.text}`);
    },
    async serializableReadWrite() { throw new Error('write not allowed'); },
  });
  const module = await import('../../dist/migration/initialBootstrapStaleValidatedTerminalization.js');
  assert.deepEqual(
    await module.diagnoseInitialBootstrapStaleValidatedTerminalizationDurableOutcome(adapter),
    { verdict: 'APPLIED', reason: 'EXACT_FAILED_MARKER' },
  );
  assert.equal(reads.every((statement) => statement.kind === 'READ'), true);
});

test('durable recovery treats unchanged VALIDATED as no-retry and duplicate markers as ambiguous', async () => {
  const module = await import('../../dist/migration/initialBootstrapStaleValidatedTerminalization.js');
  const validatedAdapter = new YdbAdapter({
    async executeRead(statement) {
      if (statement.text.includes("state = 'FAILED' AND error_code = 'INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT'")) {
        return { rows: [{ row_count: 0n }] };
      }
      if (statement.text.includes("FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
        return { rows: [{
          id: RUN_ID,
          started_at: STARTED_AT,
          finished_at: null,
          source_snapshot_digest: DIGEST,
          state: 'VALIDATED',
          rows_seen: 2n,
          rows_new: 2n,
          rows_changed: 0n,
          rows_missing: 0n,
          rows_ambiguous: 0n,
          error_code: null,
        }] };
      }
      throw new Error(`unexpected read: ${statement.text}`);
    },
    async serializableReadWrite() { throw new Error('write not allowed'); },
  });
  assert.deepEqual(
    await module.diagnoseInitialBootstrapStaleValidatedTerminalizationDurableOutcome(validatedAdapter),
    { verdict: 'RECOVERY_REQUIRED', reason: 'UNCHANGED_VALIDATED_NO_RETRY' },
  );

  const duplicateAdapter = new YdbAdapter({
    async executeRead(statement) {
      if (statement.text.includes("state = 'FAILED' AND error_code = 'INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT'")) {
        return { rows: [{ row_count: 2n }] };
      }
      throw new Error(`unexpected read: ${statement.text}`);
    },
    async serializableReadWrite() { throw new Error('write not allowed'); },
  });
  assert.deepEqual(
    await module.diagnoseInitialBootstrapStaleValidatedTerminalizationDurableOutcome(duplicateAdapter),
    { verdict: 'RECOVERY_REQUIRED', reason: 'TERMINAL_MARKER_AMBIGUOUS' },
  );
});
