import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbJsV6DataTransportError } from '../../dist/integration/ydb/ydbJsV6DataTransport.js';
import { InitialBootstrapApplicationError } from '../../dist/migration/initialBootstrapApplication.js';
import {
  classifyInitialBootstrapControlledPreparationFailure,
  classifyInitialBootstrapControlledPreparationGrpcStatus,
  classifyInitialBootstrapControlledPreparationQueryError,
  createInitialBootstrapControlledPreparationQueryErrorTracker,
  createInitialBootstrapControlledPreparationRetryTracker,
  diagnoseInitialBootstrapSourceDecodeEvidence,
  executeInitialBootstrapRecoveryJob,
  readInitialBootstrapRecoveryJobConfig,
} from '../../dist/runtime/initialBootstrapRecoveryJob.js';

const S = (value) => ({ stringValue: value });
const N = (value) => ({ numberValue: Number(value) });

test('controlled preparation classifier preserves exact existing YDB transport enums', () => {
  assert.equal(
    classifyInitialBootstrapControlledPreparationFailure(
      new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_TIMEOUT'),
    ),
    'YDB_QUERY_TIMEOUT',
  );
  assert.equal(
    classifyInitialBootstrapControlledPreparationFailure(
      new YdbJsV6DataTransportError('QUERY_EXECUTION_FAILED'),
    ),
    'YDB_DATA_QUERY_EXECUTION_FAILED',
  );
  assert.equal(
    classifyInitialBootstrapControlledPreparationFailure(
      new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_UNAVAILABLE'),
    ),
    'YDB_DATA_QUERY_EXECUTION_YDB_UNAVAILABLE',
  );
  assert.equal(
    classifyInitialBootstrapControlledPreparationFailure(
      new InitialBootstrapApplicationError('BOOTSTRAP_OBSERVATION_INVALID'),
    ),
    'APPLICATION_BOOTSTRAP_OBSERVATION_INVALID',
  );
  assert.equal(
    classifyInitialBootstrapControlledPreparationFailure(
      new InitialBootstrapApplicationError('CONTROLLED_CONTINUATION_ROUTE_NOT_REQUIRED'),
    ),
    'APPLICATION_CONTROLLED_CONTINUATION_ROUTE_NOT_REQUIRED',
  );
  assert.equal(
    classifyInitialBootstrapControlledPreparationFailure(new Error('private provider text')),
    'DIAGNOSTIC_FAILED',
  );
});

test('controlled preparation retry tracker reduces only bounded retry outcomes', () => {
  const cases = [
    {
      messages: [],
      expected: 'UNOBSERVED',
    },
    {
      messages: [{ type: 'attempt', value: { attempt: 1, idempotent: true, outcome: 'success' } }],
      expected: 'NO_RETRY',
    },
    {
      messages: [{ type: 'attempt', value: { attempt: 1, idempotent: true, outcome: 'retried' } }],
      expected: 'RETRIED',
    },
    {
      messages: [{ type: 'attempt', value: { attempt: 2, idempotent: true, outcome: 'success' } }],
      expected: 'RETRIED',
    },
    {
      messages: [{ type: 'attempt', value: { attempt: 1, idempotent: false, outcome: 'non_retryable' } }],
      expected: 'NON_RETRYABLE',
    },
    {
      messages: [{ type: 'exhausted', value: { attempts: 3, totalDuration: 125 } }],
      expected: 'EXHAUSTED',
    },
  ];
  for (const { messages, expected } of cases) {
    const tracker = createInitialBootstrapControlledPreparationRetryTracker();
    for (const message of messages) {
      if (message.type === 'attempt') tracker.observeAttemptCompleted(message.value);
      else tracker.observeExhausted(message.value);
    }
    assert.equal(tracker.evidence(), expected);
  }
});

test('controlled preparation retry tracker is non-throwing, fail-closed and ignores lastError', () => {
  const malformed = createInitialBootstrapControlledPreparationRetryTracker();
  assert.doesNotThrow(() => malformed.observeAttemptCompleted({ attempt: 0, idempotent: true, outcome: 'success' }));
  assert.equal(malformed.evidence(), 'DIAGNOSTIC_FAILED');

  const ignoredLastError = createInitialBootstrapControlledPreparationRetryTracker();
  const exhausted = {
    attempts: 2,
    totalDuration: 50,
    get lastError() {
      throw new Error('private provider error must not be read');
    },
  };
  assert.doesNotThrow(() => ignoredLastError.observeExhausted(exhausted));
  assert.equal(ignoredLastError.evidence(), 'EXHAUSTED');

  const priority = createInitialBootstrapControlledPreparationRetryTracker();
  priority.observeAttemptCompleted({ attempt: 2, idempotent: true, outcome: 'retried' });
  priority.observeAttemptCompleted({ attempt: 3, idempotent: true, outcome: 'non_retryable' });
  priority.observeExhausted({ attempts: 3, totalDuration: 75 });
  assert.equal(priority.evidence(), 'EXHAUSTED');
  priority.markDiagnosticFailed();
  assert.equal(priority.evidence(), 'DIAGNOSTIC_FAILED');
});

test('controlled preparation query-error classifier exposes only bounded error classes', () => {
  const abortError = new Error('private');
  abortError.name = 'AbortError';
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError(abortError), 'ABORT_TIMEOUT');

  const timeoutError = new Error('private');
  timeoutError.name = 'TimeoutError';
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError(timeoutError), 'ABORT_TIMEOUT');

  class YDBError extends Error {
    constructor() {
      super('private');
      this.code = 400000;
    }
  }
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError(new YDBError()), 'YDB_STATUS');

  class ClientError extends Error {
    constructor() {
      super('private');
      this.code = 14;
    }
  }
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError(new ClientError()), 'GRPC_STATUS');
  assert.equal(
    classifyInitialBootstrapControlledPreparationQueryError({ name: 'ClientError', code: 14 }),
    'CLIENT_ERROR',
  );
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError(new Error('private')), 'OTHER');
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError({ code: '14' }), 'OTHER');

  const malformed = Object.create(null, {
    name: {
      get() { throw new Error('private getter must stay contained'); },
    },
  });
  assert.equal(classifyInitialBootstrapControlledPreparationQueryError(malformed), 'DIAGNOSTIC_FAILED');
});

test('controlled preparation gRPC classifier exposes only standard status names', () => {
  class ClientError extends Error {
    constructor(code) {
      super('private');
      this.code = code;
      Object.defineProperty(this, 'details', {
        get() { throw new Error('details must not be read'); },
      });
      Object.defineProperty(this, 'metadata', {
        get() { throw new Error('metadata must not be read'); },
      });
    }
  }
  const cases = [
    [1, 'CANCELLED'],
    [2, 'UNKNOWN'],
    [3, 'INVALID_ARGUMENT'],
    [4, 'DEADLINE_EXCEEDED'],
    [5, 'NOT_FOUND'],
    [6, 'ALREADY_EXISTS'],
    [7, 'PERMISSION_DENIED'],
    [8, 'RESOURCE_EXHAUSTED'],
    [9, 'FAILED_PRECONDITION'],
    [10, 'ABORTED'],
    [11, 'OUT_OF_RANGE'],
    [12, 'UNIMPLEMENTED'],
    [13, 'INTERNAL'],
    [14, 'UNAVAILABLE'],
    [15, 'DATA_LOSS'],
    [16, 'UNAUTHENTICATED'],
  ];
  for (const [code, expected] of cases) {
    assert.equal(classifyInitialBootstrapControlledPreparationGrpcStatus(new ClientError(code)), expected);
  }
  assert.equal(classifyInitialBootstrapControlledPreparationGrpcStatus(new ClientError(99)), 'UNRECOGNIZED');
  assert.equal(classifyInitialBootstrapControlledPreparationGrpcStatus(new Error('private')), 'NON_GRPC');
  assert.equal(
    classifyInitialBootstrapControlledPreparationGrpcStatus({ name: 'ClientError', code: 14 }),
    'NON_GRPC',
  );

  class MalformedClientError extends Error {
    get code() { throw new Error('private code access failure'); }
  }
  Object.defineProperty(MalformedClientError, 'name', { value: 'ClientError' });
  assert.equal(
    classifyInitialBootstrapControlledPreparationGrpcStatus(new MalformedClientError()),
    'DIAGNOSTIC_FAILED',
  );
});

test('controlled preparation query-error tracker reads only context.error and fails closed', () => {
  const tracker = createInitialBootstrapControlledPreparationQueryErrorTracker();
  assert.equal(tracker.evidence(), 'UNOBSERVED');
  assert.equal(tracker.grpcStatusEvidence(), 'UNOBSERVED');

  class YDBError extends Error {
    constructor() {
      super('private');
      this.code = 500000;
    }
  }
  const context = {
    error: new YDBError(),
    get text() { throw new Error('query text must not be read'); },
    get query() { throw new Error('query must not be read'); },
    get parameters() { throw new Error('parameters must not be read'); },
    get sessionId() { throw new Error('sessionId must not be read'); },
    get nodeId() { throw new Error('nodeId must not be read'); },
    get txId() { throw new Error('txId must not be read'); },
    get driver() { throw new Error('driver must not be read'); },
  };
  assert.doesNotThrow(() => tracker.observeErrorContext(context));
  assert.equal(tracker.evidence(), 'YDB_STATUS');
  assert.equal(tracker.grpcStatusEvidence(), 'NON_GRPC');

  class ClientError extends Error {
    constructor() {
      super('private');
      this.code = 14;
      Object.defineProperty(this, 'details', {
        get() { throw new Error('details must not be read'); },
      });
      Object.defineProperty(this, 'metadata', {
        get() { throw new Error('metadata must not be read'); },
      });
    }
  }
  tracker.observeErrorContext({ error: new ClientError() });
  assert.equal(tracker.evidence(), 'GRPC_STATUS');
  assert.equal(tracker.grpcStatusEvidence(), 'UNAVAILABLE');

  const timeoutError = new Error('private');
  timeoutError.name = 'TimeoutError';
  tracker.observeErrorContext({ error: timeoutError });
  assert.equal(tracker.evidence(), 'ABORT_TIMEOUT');
  assert.equal(tracker.grpcStatusEvidence(), 'NON_GRPC');

  tracker.observeErrorContext({});
  assert.equal(tracker.evidence(), 'DIAGNOSTIC_FAILED');
  assert.equal(tracker.grpcStatusEvidence(), 'DIAGNOSTIC_FAILED');
  tracker.observeErrorContext({ error: new Error('later event cannot clear fail-closed state') });
  assert.equal(tracker.evidence(), 'DIAGNOSTIC_FAILED');
  assert.equal(tracker.grpcStatusEvidence(), 'DIAGNOSTIC_FAILED');
});

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
        return Object.freeze({
          preparationEvidence: 'READY',
          retryEvidence: 'UNOBSERVED',
          queryErrorEvidence: 'UNOBSERVED',
        grpcStatusEvidence: 'UNOBSERVED',
        });
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
      return Object.freeze({
        preparationEvidence: 'YDB_QUERY_TIMEOUT',
        retryEvidence: 'RETRIED',
        queryErrorEvidence: 'YDB_STATUS',
        grpcStatusEvidence: 'NON_GRPC',
      });
    },
  });
  assert.deepEqual(
    await executeInitialBootstrapRecoveryJob(config, fixture.runtime, false, true),
    {
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingControlledPreparationEvidence: 'YDB_QUERY_TIMEOUT',
      stagingControlledPreparationRetryEvidence: 'RETRIED',
      stagingControlledPreparationQueryErrorEvidence: 'YDB_STATUS',
      stagingControlledPreparationGrpcStatusEvidence: 'NON_GRPC',
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
