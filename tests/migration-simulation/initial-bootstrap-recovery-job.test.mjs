import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseInitialBootstrapSourceDecodeEvidence,
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
  privateHistoricalEvidence: '{\"synthetic\":true}',
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
  let stagingDurableDiagnosticCalls = 0;
  let stagingRetirementDiagnosticCalls = 0;
  let stagingExactRevisionDiagnosticCalls = 0;
  let closes = 0;
  let historicalEvidenceParses = 0;
  let referenceReads = 0;
  let historicalProofCalls = 0;
  const result = {
    runtime: {
      createDigest() {
        return Object.freeze({
          digestCanonicalSnapshot: () => 'synthetic-snapshot-digest',
          digestCanonicalRow: () => 'synthetic-row-digest',
        });
      },
      parseHistoricalEvidence(serialized) {
        historicalEvidenceParses += 1;
        assert.equal(serialized, config.privateHistoricalEvidence);
        return Object.freeze({ synthetic: true });
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
          async createSchemeTransport() {
            return Object.freeze({
              async ensureDirectory() { throw new Error('unexpected scheme mutation'); },
              async copyTables() { throw new Error('unexpected scheme mutation'); },
              async renameTables() { throw new Error('unexpected scheme mutation'); },
              async listDirectory() { throw new Error('unexpected direct scheme read'); },
            });
          },
          async close() { closes += 1; },
        });
      },
      async readReferenceResolver() {
        referenceReads += 1;
        return Object.freeze({ synthetic: true });
      },
      async diagnoseHistoricalSwapProof() {
        historicalProofCalls += 1;
        return Object.freeze({
          status: 'PROVEN_NOT_APPLIED',
          evidence: Object.freeze({
            historicalContextProven: true,
            currentStateEmpty: true,
            stagingCandidateExact: true,
            swapProvenNotApplied: true,
          }),
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
      async diagnoseStagingDurableRevisionEvidence() {
        stagingDurableDiagnosticCalls += 1;
        return 'PARTIAL_CURRENT_RUN_ONLY';
      },
      async diagnoseStaleStagingRetirementCurrentState() {
        stagingRetirementDiagnosticCalls += 1;
        return 'STALE_STAGING_CURRENT_STATE_EMPTY';
      },
      async diagnoseStagingExactRevisionEvidence(_adapter, sourceSnapshotDigest, observations) {
        stagingExactRevisionDiagnosticCalls += 1;
        assert.equal(sourceSnapshotDigest, 'synthetic-digest');
        assert.equal(observations.length, 1);
        assert.equal(observations[0].sourceOrdinal, 0);
        assert.equal(observations[0].rowHint, 2);
        assert.equal(observations[0].digest, 'synthetic-row-digest');
        assert.equal(typeof observations[0].rawPayload, 'object');
        return 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH';
      },
      async diagnoseStagingControlledPreparation() {
        return 'READY';
      },
      ...overrides,
    },
    counters: () => ({
      sourceReads,
      reconcileCalls,
      diagnoseCalls,
      stagingDiagnosticCalls,
      stagingDurableDiagnosticCalls,
      stagingRetirementDiagnosticCalls,
      stagingExactRevisionDiagnosticCalls,
      historicalEvidenceParses,
      referenceReads,
      historicalProofCalls,
      closes,
    }),
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
    stagingDurableDiagnosticCalls: 0,
    stagingRetirementDiagnosticCalls: 0,
    stagingExactRevisionDiagnosticCalls: 0,
    historicalEvidenceParses: 0,
    referenceReads: 0,
    historicalProofCalls: 0,
    closes: 1,
  });
});

test('recovery job adds enum-only revision and retirement evidence for a single STAGING run', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
    stagingSourceDecodeEvidence: [],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH',
  });
  assert.equal(fixture.counters().sourceReads, 1);
  assert.equal(fixture.counters().reconcileCalls, 0);
  assert.equal(fixture.counters().stagingDiagnosticCalls, 1);
  assert.equal(fixture.counters().stagingDurableDiagnosticCalls, 1);
  assert.equal(fixture.counters().stagingRetirementDiagnosticCalls, 1);
  assert.equal(fixture.counters().stagingExactRevisionDiagnosticCalls, 1);
  assert.equal(fixture.counters().closes, 1);
});

test('surface-only recovery classifies STAGING without Google or per-revision reads', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime, true), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });
  assert.deepEqual(fixture.counters(), {
    sourceReads: 0,
    reconcileCalls: 0,
    diagnoseCalls: 0,
    stagingDiagnosticCalls: 0,
    stagingDurableDiagnosticCalls: 0,
    stagingRetirementDiagnosticCalls: 0,
    stagingExactRevisionDiagnosticCalls: 0,
    historicalEvidenceParses: 0,
    referenceReads: 0,
    historicalProofCalls: 0,
    closes: 1,
  });
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
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
    stagingSourceDecodeEvidence: [],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH',
  });
  assert.equal(fixture.counters().sourceReads, 1);
  assert.equal(fixture.counters().stagingDurableDiagnosticCalls, 1);
  assert.equal(fixture.counters().stagingRetirementDiagnosticCalls, 1);
  assert.equal(fixture.counters().closes, 1);
});

test('recovery job sanitizes stale retirement current-state diagnostic failure', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
    async diagnoseStaleStagingRetirementCurrentState() {
      throw new Error('synthetic retirement diagnostic failure');
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED',
    stagingSourceDecodeEvidence: [],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH',
  });
});

test('recovery job preserves durable STAGING evidence when the Google-aware diagnostic is stale', async () => {
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
    async diagnoseStagingRevisionEvidence() {
      return 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH';
    },
    async diagnoseStagingDurableRevisionEvidence() {
      return 'CROSS_RUN_PK_COLLISION';
    },
    async diagnoseStaleStagingRetirementCurrentState() {
      return 'STALE_STAGING_CURRENT_STATE_NOT_EMPTY';
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
    stagingDurableRevisionEvidence: 'CROSS_RUN_PK_COLLISION',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
    stagingSourceDecodeEvidence: [],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH',
  });
});

test('recovery job preserves VALIDATED structure and compares source read-only', async () => {
  let controlledDiagnosticCalls = 0;
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_RUN_PRESENT' };
    },
    async diagnoseValidatedControlledRebuildState() {
      controlledDiagnosticCalls += 1;
      return 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY';
    },
    async diagnoseValidatedSourceEvidence(_adapter, digest, observations) {
      assert.equal(digest, 'synthetic-digest');
      assert.deepEqual(observations, [{ sourceOrdinal: 0, rowHint: 2, digest: 'synthetic-row-digest' }]);
      return 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH';
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
    validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
    staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN' },
  });
  assert.equal(controlledDiagnosticCalls, 1);
  assert.equal(fixture.counters().sourceReads, 1);
  assert.equal(fixture.counters().stagingRetirementDiagnosticCalls, 0);
  assert.equal(fixture.counters().reconcileCalls, 0);
  assert.equal(fixture.counters().historicalEvidenceParses, 1);
  assert.equal(fixture.counters().referenceReads, 1);
  assert.equal(fixture.counters().historicalProofCalls, 1);
  assert.equal(fixture.counters().closes, 1);
});

test('recovery job rejects non-exact source drift before historical reconstruction', async () => {
  const fixture = runtime({
    async diagnoseSurface() { return { verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_RUN_PRESENT' }; },
    async diagnoseValidatedControlledRebuildState() { return 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'; },
    async diagnoseValidatedSourceEvidence() { return 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY'; },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
    validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
    staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'SOURCE_DRIFT_NOT_PROVEN' },
  });
  assert.equal(fixture.counters().historicalEvidenceParses, 0);
  assert.equal(fixture.counters().referenceReads, 0);
  assert.equal(fixture.counters().historicalProofCalls, 0);
});

test('recovery job maps historical proof failure to the next exact Gate A blocker', async () => {
  const fixture = runtime({
    async diagnoseSurface() { return { verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_RUN_PRESENT' }; },
    async diagnoseValidatedControlledRebuildState() { return 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'; },
    async diagnoseValidatedSourceEvidence() { return 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH'; },
    async diagnoseHistoricalSwapProof() {
      return Object.freeze({
        status: 'STOP',
        reason: 'CURRENT_STATE_NOT_EMPTY',
        evidence: Object.freeze({
          historicalContextProven: true,
          currentStateEmpty: false,
          stagingCandidateExact: false,
          swapProvenNotApplied: false,
        }),
      });
    },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
    validatedSourceEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
    staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'CURRENT_STATE_NOT_EMPTY' },
  });
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
  assert.equal(fixture.counters().stagingRetirementDiagnosticCalls, 0);
  assert.equal(fixture.counters().stagingExactRevisionDiagnosticCalls, 0);
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

test('recovery source decode diagnostic exposes only distinct canonical error-code and field pairs', () => {
  const base = {
    adapter_schema_version: 3,
    date: { kind: 'NUMBER', value: '45292' },
    operation_type: { kind: 'STRING', value: 'Расход' },
    expense_account: { kind: 'STRING', value: 'Карта Visa' },
    expense_category: { kind: 'STRING', value: 'Synthetic Food' },
    description: { kind: 'NUMBER', value: '7' },
    expense_amount: { kind: 'NUMBER', value: '10' },
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  };
  const evidence = diagnoseInitialBootstrapSourceDecodeEvidence([
    { rawPayload: base },
    { rawPayload: base },
    { rawPayload: { ...base, description: { kind: 'STRING', value: 'Synthetic' }, date: { kind: 'STRING', value: '2024-01-01' } } },
  ]);
  assert.deepEqual(evidence, [
    { errorCode: 'INVALID_DATE_CELL', field: 'date' },
    { errorCode: 'INVALID_TEXT_CELL', field: 'description' },
  ]);
});

test('recovery config requires read-only Google credentials plus YDB connection', () => {
  assert.deepEqual(readInitialBootstrapRecoveryJobConfig({
    PRIHRASH_GOOGLE_SPREADSHEET_ID: config.spreadsheetId,
    PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL: config.googleServiceAccountEmail,
    PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: config.googleServiceAccountPrivateKey,
    PRIHRASH_YDB_CONNECTION_STRING: config.ydbConnectionString,
    PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE: config.privateHistoricalEvidence,
  }), config);
  assert.throws(
    () => readInitialBootstrapRecoveryJobConfig({ PRIHRASH_YDB_CONNECTION_STRING: config.ydbConnectionString }),
    (error) => error?.code === 'INVALID_SPREADSHEET_ID',
  );
  const { privateHistoricalEvidence: _privateHistoricalEvidence, ...baseConfig } = config;
  assert.deepEqual(readInitialBootstrapRecoveryJobConfig({
    PRIHRASH_GOOGLE_SPREADSHEET_ID: config.spreadsheetId,
    PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL: config.googleServiceAccountEmail,
    PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: config.googleServiceAccountPrivateKey,
    PRIHRASH_YDB_CONNECTION_STRING: config.ydbConnectionString,
  }), baseConfig);
});


test('VALIDATED source diagnostic failure preserves structure and recovery boundary', async () => {
  const fixture = runtime({
    async diagnoseSurface() { return { verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_RUN_PRESENT' }; },
    async diagnoseValidatedControlledRebuildState() { return 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'; },
    createSource() { throw new Error('private source failure'); },
  });
  assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), {
    verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
    validatedSourceEvidence: 'VALIDATED_SOURCE_DIAGNOSTIC_FAILED',
    staleValidatedRecoveryGate: { status: 'BLOCKED', blocker: 'VALIDATED_RUN_METADATA_INVALID' },
  });
  assert.equal(fixture.counters().closes, 1);
  assert.equal(fixture.counters().stagingRetirementDiagnosticCalls, 0);
});

test('other VALIDATED structures and surface-only mode never read the authoritative source', async () => {
  for (const reason of ['VALIDATED_CURRENT_EMPTY_STAGING_EMPTY', 'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT', 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS']) {
    const fixture = runtime({
      async diagnoseSurface() { return { verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_RUN_PRESENT' }; },
      async diagnoseValidatedControlledRebuildState() { return reason; },
    });
    assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime), { verdict: 'RECOVERY_REQUIRED', reason });
    assert.equal(fixture.counters().sourceReads, 0);
    assert.deepEqual(await executeInitialBootstrapRecoveryJob(config, fixture.runtime, true), { verdict: 'RECOVERY_REQUIRED', reason: 'VALIDATED_RUN_PRESENT' });
    assert.equal(fixture.counters().sourceReads, 0);
  }
});


test('controlled-preparation-only recovery stays read-only and exposes one bounded enum', async () => {
  let controlledPreparationCalls = 0;
  const fixture = runtime({
    async diagnoseSurface() {
      return { verdict: 'RECOVERY_REQUIRED', reason: 'STAGING_RUN_PRESENT' };
    },
    async diagnoseStagingControlledPreparation(_config, receivedLease, digest) {
      controlledPreparationCalls += 1;
      assert.equal(receivedLease.snapshotDigest, 'synthetic-digest');
      assert.equal(typeof digest.digestCanonicalSnapshot, 'function');
      return 'YDB_QUERY_TIMEOUT';
    },
  });
  assert.deepEqual(
    await executeInitialBootstrapRecoveryJob(config, fixture.runtime, false, true),
    {
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingControlledPreparationEvidence: 'YDB_QUERY_TIMEOUT',
    },
  );
  assert.equal(controlledPreparationCalls, 1);
  assert.equal(fixture.counters().sourceReads, 1);
  assert.equal(fixture.counters().stagingDiagnosticCalls, 0);
  assert.equal(fixture.counters().stagingDurableDiagnosticCalls, 0);
  assert.equal(fixture.counters().stagingRetirementDiagnosticCalls, 0);
  assert.equal(fixture.counters().stagingExactRevisionDiagnosticCalls, 0);
  assert.equal(fixture.counters().closes, 1);
});

test('recovery rejects conflicting surface-only and controlled-preparation-only modes before provider access', async () => {
  const fixture = runtime();
  await assert.rejects(
    () => executeInitialBootstrapRecoveryJob(config, fixture.runtime, true, true),
    (error) => error?.code === 'INVALID_RECOVERY_MODE',
  );
  assert.equal(fixture.counters().diagnoseCalls, 0);
  assert.equal(fixture.counters().sourceReads, 0);
  assert.equal(fixture.counters().closes, 0);
});
