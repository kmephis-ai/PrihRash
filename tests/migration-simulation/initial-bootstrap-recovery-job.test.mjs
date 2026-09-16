import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeInitialBootstrapRecoveryJob,
  readInitialBootstrapRecoveryJobConfig,
} from '../../dist/runtime/initialBootstrapRecoveryJob.js';

const S = (value) => ({ stringValue: value });
const N = (value) => ({ numberValue: Number(value) });

const config = Object.freeze({
  spreadsheetId: 'synthetic-spreadsheet',
  googleServiceAccountEmail: 'synthetic@example.test',
  googleServiceAccountPrivateKey: 'synthetic-private-key',
  ydbConnectionString: 'grpcs://synthetic.example.test/?database=/synthetic',
});

function lease() {
  return Object.freeze({
    snapshotDigest: 'synthetic-digest',
    snapshot: Object.freeze({
      spreadsheetId: config.spreadsheetId,
      spreadsheetTitle: 'ПрихРасхOnline',
      sheetName: 'Ответы на форму (11)',
      locale: 'ru_RU',
      timeZone: 'Europe/Moscow',
      rows: Object.freeze([Object.freeze({
        rowHint: 2,
        values: Object.freeze([
          N('45292'),
          S('Расход'),
          S('Карта Visa'),
          S('Synthetic Food'),
          S('Synthetic'),
          N('10'),
          null,
          null,
          null,
          null,
          null,
        ]),
      })]),
    }),
  });
}

function runtime(overrides = {}) {
  let sourceReads = 0;
  let reconcileCalls = 0;
  let diagnoseCalls = 0;
  let stagingDiagnosticCalls = 0;
  let closes = 0;
  const result = {
    runtime: {
      createDigest() {
        return Object.freeze({
          digestCanonicalSnapshot: () => 'synthetic-snapshot-digest',
          digestCanonicalRow: () => 'synthetic-row-digest',
        });
      },
      createSource() {
        return Object.freeze({
          async readFullSnapshotObservation() {
            sourceReads += 1;
            return lease();
          },
        });
      },
      async createYdbClient() {
        return Object.freeze({
          transport: Object.freeze({
            async executeRead() { return { rows: [] }; },
            async serializableReadWrite() { throw new Error('unexpected write transaction'); },
          }),
          async close() { closes += 1; },
        });
      },
      async diagnoseSurface() {
        diagnoseCalls += 1;
        return { verdict: 'RECOVERY_REQUIRED', reason: 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN' };
      },
      async reconcileReferenceState(_adapter, rows) {
        reconcileCalls += 1;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].sourceOrdinal, 0);
        return {
          verdict: 'RECOVERY_REQUIRED',
          reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
        };
      },
      async diagnoseStagingRevisionEvidence(_adapter, sourceSnapshotDigest, observations) {
        stagingDiagnosticCalls += 1;
        assert.equal(sourceSnapshotDigest, 'synthetic-digest');
        assert.deepEqual(observations, [{
          sourceOrdinal: 0,
          rowHint: 2,
          digest: 'synthetic-row-digest',
        }]);
        return 'PARTIAL_CURRENT_RUN_ONLY';
      },
      ...overrides,
    },
    counters: () => ({ sourceReads, reconcileCalls, diagnoseCalls, stagingDiagnosticCalls, closes }),
  };
  return result;
}

test('recovery job reads fresh authoritative source only for residual reference state', async () => {
  const fixture = runtime();
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  });
  assert.deepEqual(fixture.counters(), {
    sourceReads: 1,
    reconcileCalls: 1,
    diagnoseCalls: 2,
    stagingDiagnosticCalls: 0,
    closes: 1,
  });
});


test('recovery job adds enum-only revision evidence for a single STAGING run', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
  });
  assert.equal(fixture.counters().sourceReads, 1);
  assert.equal(fixture.counters().reconcileCalls, 0);
  assert.equal(fixture.counters().stagingDiagnosticCalls, 1);
  assert.equal(fixture.counters().closes, 1);
});

test('recovery job keeps STAGING classification fail-closed when revision diagnostic cannot be proven', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
    async diagnoseStagingRevisionEvidence() {
      throw new Error('synthetic diagnostic failure');
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED',
  });
  assert.equal(fixture.counters().sourceReads, 1);
  assert.equal(fixture.counters().closes, 1);
});

test('recovery job preserves non-reference classification without touching Google', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'FAILED_RUN_PRESENT' };
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'FAILED_RUN_PRESENT',
  });
  assert.equal(fixture.counters().sourceReads, 0);
  assert.equal(fixture.counters().reconcileCalls, 0);
  assert.equal(fixture.counters().closes, 1);
});

test('recovery job fails closed if durable surface changes during authoritative reconciliation', async () => {
  let call = 0;
  const fixture = runtime({
    async diagnoseSurface() {
      call += 1;
      if (call === 1) {
        return { verdict: 'RECOVERY_REQUIRED', reason: 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN' };
      }
      return { verdict: 'RECOVERY_REQUIRED', reason: 'RESIDUAL_MIXED_STATE_WITHOUT_RUN' };
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'REFERENCE_RECONCILIATION_FAILED',
  });
});

test('recovery config requires read-only Google credentials plus YDB connection', () => {
  assert.deepEqual(readInitialBootstrapRecoveryJobConfig({
    PRIHRASH_GOOGLE_SPREADSHEET_ID: config.spreadsheetId,
    PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL: config.googleServiceAccountEmail,
    PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: config.googleServiceAccountPrivateKey,
    PRIHRASH_YDB_CONNECTION_STRING: config.ydbConnectionString,
  }), config);
  assert.throws(
    () => readInitialBootstrapRecoveryJobConfig({ PRIHRASH_YDB_CONNECTION_STRING: config.ydbConnectionString }),
    (error) => error?.code === 'INVALID_SPREADSHEET_ID',
  );
});
