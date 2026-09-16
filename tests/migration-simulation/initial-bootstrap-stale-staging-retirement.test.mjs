import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE,
  retireInitialBootstrapStaleStagingRun,
} from '../../dist/migration/initialBootstrapStaleStagingRetirement.js';

const RUN_ID = '00000000-0000-0000-0000-000000000901';
const OLD_DIGEST = 'synthetic-old-snapshot';
const FRESH_DIGEST = 'synthetic-fresh-snapshot';
const STARTED_AT = '2026-09-16T05:00:00Z';
const FINISHED_AT = '2026-09-16T07:45:00Z';

function stagingRunRow(overrides = {}) {
  return {
    id: RUN_ID,
    started_at: STARTED_AT,
    finished_at: null,
    source_snapshot_digest: OLD_DIGEST,
    state: 'STAGING',
    rows_seen: 0n,
    rows_new: 0n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
    ...overrides,
  };
}

function manifestRow(overrides = {}) {
  return {
    migration_run_id: RUN_ID,
    run_state: 'STAGING',
    run_snapshot_digest: OLD_DIGEST,
    rows_seen: 0n,
    manifest_snapshot_digest: OLD_DIGEST,
    binding_count: 0n,
    bindings: { schema_version: 1, bindings: [] },
    snapshot_digest: OLD_DIGEST,
    snapshot_row_count: 0n,
    ...overrides,
  };
}

function failedReadbackRow() {
  return {
    state: 'FAILED',
    finished_at: FINISHED_AT,
    error_code: INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE,
    source_snapshot_digest: OLD_DIGEST,
    rows_seen: 0n,
    rows_new: 0n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
  };
}

function fixture({ admissionRows, manifestRows, currentSourceRows = [], currentTransactionRows = [] } = {}) {
  const readStatements = [];
  const transactionStatements = [];
  const transport = {
    async executeRead(statement) {
      readStatements.push(statement);
      if (statement.text.includes("FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
        return { rows: admissionRows ?? [stagingRunRow()] };
      }
      if (statement.text.includes("WHERE r.state = 'STAGING' LIMIT 2")) {
        return { rows: manifestRows ?? [manifestRow()] };
      }
      throw new Error(`unexpected read: ${statement.text}`);
    },
    async serializableReadWrite(callback) {
      return callback({
        async execute(statement) {
          transactionStatements.push(statement);
          if (statement.text.includes('FROM `source_records` GROUP BY classification, state')) {
            return { rows: currentSourceRows };
          }
          if (statement.text.includes('FROM `transactions` GROUP BY type, category_id')) return { rows: [] };
          if (statement.text.includes("FROM `transactions` WHERE type = 'EXPENSE'")) return { rows: [] };
          if (statement.text.includes("FROM `transactions` WHERE type = 'INCOME'")) return { rows: [] };
          if (statement.text.includes('FROM `transactions` GROUP BY type')) {
            return { rows: currentTransactionRows };
          }
          if (statement.text.startsWith('UPDATE migration_runs SET state = $state')) return { rows: [] };
          if (statement.text.startsWith('SELECT state, finished_at, error_code')) {
            return { rows: [failedReadbackRow()] };
          }
          throw new Error(`unexpected transaction statement: ${statement.text}`);
        },
      });
    },
  };
  return {
    adapter: new YdbAdapter(transport),
    readStatements,
    transactionStatements,
  };
}

async function errorCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.code;
  }
  return null;
}

test('stale STAGING retirement marks only the exact run FAILED and preserves all evidence rows', async () => {
  const f = fixture();
  const result = await retireInitialBootstrapStaleStagingRun(f.adapter, FRESH_DIGEST, FINISHED_AT);

  assert.equal(result.state, 'FAILED');
  assert.equal(result.id, RUN_ID);
  assert.equal(result.sourceSnapshotDigest, OLD_DIGEST);
  assert.equal(result.errorCode, INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE);
  assert.equal(result.finishedAt, FINISHED_AT);

  const writes = f.transactionStatements.filter((statement) => statement.kind === 'WRITE');
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /^UPDATE migration_runs SET state = \$state/);
  assert.doesNotMatch(writes[0].text, /DELETE|UPSERT|source_snapshots|initial_bootstrap_identity_manifests|source_record_revisions/i);
  assert.equal(writes[0].parameters.expected_state.value, 'STAGING');
  assert.equal(writes[0].parameters.source_snapshot_digest.value, OLD_DIGEST);
});

test('stale STAGING retirement refuses the same authoritative snapshot', async () => {
  const f = fixture();
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(f.adapter, OLD_DIGEST, FINISHED_AT)),
    'STALE_SNAPSHOT_NOT_PROVEN',
  );
  assert.equal(f.transactionStatements.length, 0);
});

test('stale STAGING retirement refuses malformed durable manifest context', async () => {
  const f = fixture({ manifestRows: [manifestRow({ manifest_snapshot_digest: 'different' })] });
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(f.adapter, FRESH_DIGEST, FINISHED_AT)),
    'STALE_SNAPSHOT_NOT_PROVEN',
  );
  assert.equal(f.transactionStatements.length, 0);
});

test('stale STAGING retirement refuses non-empty verified current state', async () => {
  const f = fixture({
    currentSourceRows: [{ classification: 'FINANCIAL_RECORD', state: null, row_count: 1n }],
  });
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(f.adapter, FRESH_DIGEST, FINISHED_AT)),
    'VERIFIED_CURRENT_STATE_NOT_EMPTY',
  );
  assert.equal(f.transactionStatements.some((statement) => statement.kind === 'WRITE'), false);
});

test('stale STAGING retirement refuses a committed baseline or non-unique incomplete run', async () => {
  const committed = stagingRunRow({
    id: '00000000-0000-0000-0000-000000000902',
    state: 'COMMITTED',
    finished_at: '2026-09-16T06:00:00Z',
  });
  const withCommitted = fixture({ admissionRows: [committed, stagingRunRow()] });
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(withCommitted.adapter, FRESH_DIGEST, FINISHED_AT)),
    'COMMITTED_BASELINE_EXISTS',
  );

  const multiple = fixture({
    admissionRows: [
      stagingRunRow(),
      stagingRunRow({ id: '00000000-0000-0000-0000-000000000903' }),
    ],
  });
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(multiple.adapter, FRESH_DIGEST, FINISHED_AT)),
    'STAGING_RUN_NOT_UNIQUE',
  );
});

test('stale STAGING retirement validates exact non-blank runtime inputs before reads', async () => {
  const f = fixture();
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(f.adapter, ' ', FINISHED_AT)),
    'INVALID_AUTHORITATIVE_SNAPSHOT_DIGEST',
  );
  assert.equal(
    await errorCode(retireInitialBootstrapStaleStagingRun(f.adapter, FRESH_DIGEST, ' ')),
    'INVALID_FINISHED_AT',
  );
  assert.equal(f.readStatements.length, 0);
});
