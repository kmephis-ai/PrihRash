import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE,
  InitialBootstrapStaleValidatedTerminalizationError,
  terminalizeInitialBootstrapStaleValidatedRun,
} from '../../dist/migration/initialBootstrapStaleValidatedTerminalization.js';
import { MigrationRunLifecycleExecutorError } from '../../dist/migration/migrationRunLifecycleExecutor.js';

const RUN_ID = '00000000-0000-0000-0000-000000000941';
const OTHER_RUN_ID = '00000000-0000-0000-0000-000000000942';
const DIGEST = 'synthetic-stale-validated-snapshot';
const STARTED_AT = '2026-09-20T12:00:00Z';
const FINISHED_AT = '2026-09-20T18:00:00Z';

function runRow(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function failedReadback(overrides = {}) {
  return {
    state: 'FAILED',
    finished_at: FINISHED_AT,
    error_code: INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE,
    source_snapshot_digest: DIGEST,
    rows_seen: 2n,
    rows_new: 2n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    ...overrides,
  };
}

function fixture({
  admissionRows = [runRow()],
  sourceCount = 0n,
  transactionCount = 0n,
  readbackRows = [failedReadback()],
} = {}) {
  const events = [];
  const statements = [];
  const transport = {
    async executeRead() {
      throw new Error('standalone read not allowed');
    },
    async serializableReadWrite(work) {
      events.push('begin');
      try {
        const value = await work({
          async execute(statement) {
            statements.push(statement);
            if (statement.text.includes("FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
              events.push('admission');
              return { rows: admissionRows };
            }
            if (statement.text === 'SELECT COUNT(*) AS row_count FROM source_records') {
              events.push('source-count');
              return { rows: [{ row_count: sourceCount }] };
            }
            if (statement.text === 'SELECT COUNT(*) AS row_count FROM transactions') {
              events.push('transaction-count');
              return { rows: [{ row_count: transactionCount }] };
            }
            if (statement.kind === 'WRITE') {
              events.push('marker-write');
              return { rows: [] };
            }
            if (statement.text.startsWith('SELECT state, finished_at, error_code')) {
              events.push('readback');
              return { rows: readbackRows };
            }
            throw new Error(`unexpected statement: ${statement.text}`);
          },
        });
        events.push('commit');
        return value;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  return { adapter: new YdbAdapter(transport), events, statements };
}

async function errorCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.code;
  }
  return null;
}

test('marker-only Gate B terminalization keeps admission, empty-current proof, write and read-back in one transaction', async () => {
  const f = fixture();
  const result = await terminalizeInitialBootstrapStaleValidatedRun(f.adapter, FINISHED_AT);

  assert.equal(result.state, 'FAILED');
  assert.equal(result.id, RUN_ID);
  assert.equal(result.errorCode, INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE);
  assert.equal(result.finishedAt, FINISHED_AT);
  assert.deepEqual(f.events, [
    'begin',
    'admission',
    'source-count',
    'transaction-count',
    'marker-write',
    'readback',
    'commit',
  ]);

  const writes = f.statements.filter((statement) => statement.kind === 'WRITE');
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /^UPDATE migration_runs SET state = \$state/);
  assert.equal(writes[0].parameters.expected_state.value, 'VALIDATED');
  assert.equal(writes[0].parameters.state.value, 'FAILED');
  assert.equal(writes[0].parameters.error_code.value, INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE);
  assert.doesNotMatch(
    writes[0].text,
    /source_records|transactions|source_snapshots|initial_bootstrap_identity_manifests|source_record_revisions|DELETE|UPSERT/i,
  );
});

test('Gate B refuses committed baseline, missing/non-unique VALIDATED and non-empty current before marker write', async () => {
  const cases = [
    {
      fixture: fixture({ admissionRows: [
        runRow({ state: 'COMMITTED', finished_at: FINISHED_AT }),
        runRow({ id: OTHER_RUN_ID }),
      ] }),
      code: 'COMMITTED_BASELINE_EXISTS',
    },
    { fixture: fixture({ admissionRows: [] }), code: 'VALIDATED_RUN_NOT_UNIQUE' },
    {
      fixture: fixture({ admissionRows: [runRow(), runRow({ id: OTHER_RUN_ID })] }),
      code: 'VALIDATED_RUN_NOT_UNIQUE',
    },
    { fixture: fixture({ admissionRows: [runRow({ state: 'STAGING' })] }), code: 'VALIDATED_RUN_NOT_UNIQUE' },
    { fixture: fixture({ sourceCount: 1n }), code: 'VERIFIED_CURRENT_STATE_NOT_EMPTY' },
    { fixture: fixture({ transactionCount: 1n }), code: 'VERIFIED_CURRENT_STATE_NOT_EMPTY' },
  ];

  for (const entry of cases) {
    assert.equal(
      await errorCode(terminalizeInitialBootstrapStaleValidatedRun(entry.fixture.adapter, FINISHED_AT)),
      entry.code,
    );
    assert.equal(entry.fixture.statements.some((statement) => statement.kind === 'WRITE'), false);
  }
});

test('Gate B rejects malformed finished_at before opening transaction', async () => {
  const f = fixture();
  await assert.rejects(
    () => terminalizeInitialBootstrapStaleValidatedRun(f.adapter, ' '),
    (error) => error instanceof InitialBootstrapStaleValidatedTerminalizationError
      && error.code === 'INVALID_FINISHED_AT',
  );
  assert.deepEqual(f.events, []);
});

test('Gate B rolls back when exact terminal row read-back does not match immutable evidence', async () => {
  const f = fixture({ readbackRows: [failedReadback({ rows_seen: 3n })] });
  await assert.rejects(
    () => terminalizeInitialBootstrapStaleValidatedRun(f.adapter, FINISHED_AT),
    (error) => error instanceof MigrationRunLifecycleExecutorError
      && error.code === 'RUN_TRANSITION_EVIDENCE_MISMATCH',
  );
  assert.equal(f.events.at(-1), 'rollback');
  assert.equal(f.events.includes('marker-write'), true);
  assert.equal(f.events.includes('readback'), true);
});
