import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbJsV6DataTransportError } from '../../dist/integration/ydb/ydbJsV6DataTransport.js';
import {
  InitialBootstrapStaleStagingRetirementError,
} from '../../dist/migration/initialBootstrapStaleStagingRetirement.js';
import { MigrationRunStateError } from '../../dist/migration/migrationRunState.js';
import {
  ScheduledSyncAdmissionEvidenceError,
} from '../../dist/migration/scheduledSyncAdmissionEvidence.js';
import {
  MigrationRunLifecycleExecutorError,
} from '../../dist/migration/migrationRunLifecycleExecutor.js';
import {
  executeInitialBootstrapStaleStagingRetirementJob,
  InitialBootstrapStaleStagingRetirementJobError,
  runInitialBootstrapStaleStagingRetirementJobFromEnvironment,
} from '../../dist/runtime/initialBootstrapStaleStagingRetirementJob.js';
import {
  InitialBootstrapReferenceAwareRuntimeError,
} from '../../dist/runtime/initialBootstrapReferenceAwareJob.js';
import {
  executeYandexInitialBootstrapFunction,
  runInitialBootstrapJobWithOneStaleStagingRetirement,
} from '../../dist/runtime/yandexCloudInitialBootstrapFunction.js';

const CONFIG = Object.freeze({
  spreadsheetId: 'synthetic-sheet',
  googleServiceAccountEmail: 'synthetic@example.invalid',
  googleServiceAccountPrivateKey: 'synthetic-private-key',
  ydbConnectionString: 'grpcs://synthetic.invalid/?database=/local',
});

function staleResumeFailure() {
  return new InitialBootstrapReferenceAwareRuntimeError(
    'REFERENCE_APPLICATION_SEMANTIC_FAILED',
    'RESUME_CONTEXT_READ',
  );
}

test('exact resume-context semantic failure retires once and performs exactly one fresh bootstrap retry', async () => {
  const firstFailure = staleResumeFailure();
  let attempts = 0;
  let retirements = 0;

  const result = await runInitialBootstrapJobWithOneStaleStagingRetirement(
    {},
    async () => {
      attempts += 1;
      if (attempts === 1) throw firstFailure;
      return { status: 'COMMITTED' };
    },
    async () => {
      retirements += 1;
    },
  );

  assert.deepEqual(result, { status: 'COMMITTED' });
  assert.equal(attempts, 2);
  assert.equal(retirements, 1);
});

test('retirement refusal exposes one safe failure code and never retries bootstrap', async () => {
  const firstFailure = staleResumeFailure();
  let attempts = 0;
  let retirements = 0;

  await assert.rejects(
    runInitialBootstrapJobWithOneStaleStagingRetirement(
      {},
      async () => {
        attempts += 1;
        throw firstFailure;
      },
      async () => {
        retirements += 1;
        throw new Error('synthetic retirement refusal');
      },
    ),
    (error) => error instanceof InitialBootstrapReferenceAwareRuntimeError
      && error.code === 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED'
      && error.applicationPhase === 'RESUME_CONTEXT_READ',
  );

  assert.equal(attempts, 1);
  assert.equal(retirements, 1);
});


test('retirement semantic refusal preserves its exact bounded stale-retirement cause', async () => {
  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        throw staleResumeFailure();
      },
      async () => {
        throw new InitialBootstrapStaleStagingRetirementError('STALE_SNAPSHOT_NOT_PROVEN');
      },
    ),
  );

  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: null,
    staleRetirementFailureCode: 'STALE_SNAPSHOT_NOT_PROVEN',
  });
});

test('retirement job failure preserves bounded job-stage cause', async () => {
  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        throw staleResumeFailure();
      },
      async () => {
        throw new InitialBootstrapStaleStagingRetirementJobError('SOURCE_READ_FAILED');
      },
    ),
  );

  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: null,
    staleRetirementFailureCode: 'JOB_SOURCE_READ_FAILED',
  });
});

test('retirement admission evidence failure preserves its existing bounded cause', async () => {
  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        throw staleResumeFailure();
      },
      async () => {
        throw new ScheduledSyncAdmissionEvidenceError('MALFORMED_RUN_EVIDENCE');
      },
    ),
  );

  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: null,
    staleRetirementFailureCode: 'ADMISSION_MALFORMED_RUN_EVIDENCE',
  });
});

test('retirement migration-run state failure preserves its existing bounded cause', async () => {
  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        throw staleResumeFailure();
      },
      async () => {
        throw new MigrationRunStateError('COMMITTED', 'FAILED');
      },
    ),
  );

  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: null,
    staleRetirementFailureCode: 'MIGRATION_RUN_STATE_ILLEGAL_MIGRATION_RUN_TRANSITION',
  });
});

test('retirement lifecycle failure preserves bounded metadata cause without exposing raw error text', async () => {
  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        throw staleResumeFailure();
      },
      async () => {
        throw new MigrationRunLifecycleExecutorError('RUN_TRANSITION_EVIDENCE_MISMATCH');
      },
    ),
  );

  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: 'MIGRATION_RUN_LIFECYCLE_RUN_TRANSITION_EVIDENCE_MISMATCH',
  });
});

test('retirement YDB failure preserves bounded transport cause for the existing invoker sanitizer', async () => {
  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        throw staleResumeFailure();
      },
      async () => {
        throw new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_OVERLOADED');
      },
    ),
  );

  assert.deepEqual(result, {
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: null,
    ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_YDB_OVERLOADED',
  });
});

test('unrelated bootstrap failures never cross the retirement authority boundary', async () => {
  const unrelated = new InitialBootstrapReferenceAwareRuntimeError(
    'REFERENCE_APPLICATION_YDB_DATA_FAILED',
    'REVISION_EVIDENCE_WRITE',
  );
  let retirements = 0;

  await assert.rejects(
    runInitialBootstrapJobWithOneStaleStagingRetirement(
      {},
      async () => {
        throw unrelated;
      },
      async () => {
        retirements += 1;
      },
    ),
    (error) => error === unrelated,
  );

  assert.equal(retirements, 0);
});

test('a failed fresh retry is propagated without a second retirement or third bootstrap attempt', async () => {
  const firstFailure = staleResumeFailure();
  const secondFailure = new InitialBootstrapReferenceAwareRuntimeError(
    'REFERENCE_APPLICATION_YDB_DATA_FAILED',
    'FRESH_CLAIM_WRITE',
  );
  let attempts = 0;
  let retirements = 0;

  await assert.rejects(
    runInitialBootstrapJobWithOneStaleStagingRetirement(
      {},
      async () => {
        attempts += 1;
        if (attempts === 1) throw firstFailure;
        throw secondFailure;
      },
      async () => {
        retirements += 1;
      },
    ),
    (error) => error === secondFailure,
  );

  assert.equal(attempts, 2);
  assert.equal(retirements, 1);
});

test('Yandex function sanitizes the successful stale-retirement path as normal bootstrap commit', async () => {
  const firstFailure = staleResumeFailure();
  let attempts = 0;

  const result = await executeYandexInitialBootstrapFunction(
    {},
    (environment) => runInitialBootstrapJobWithOneStaleStagingRetirement(
      environment,
      async () => {
        attempts += 1;
        if (attempts === 1) throw firstFailure;
        return { status: 'COMMITTED' };
      },
      async () => {},
    ),
  );

  assert.deepEqual(result, {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_COMMITTED',
  });
  assert.equal(attempts, 2);
});

test('retirement job folds config/source/client/close preparation failures into bounded stage codes', async (t) => {
  assert.throws(
    () => runInitialBootstrapStaleStagingRetirementJobFromEnvironment({}),
    (error) => error instanceof InitialBootstrapStaleStagingRetirementJobError
      && error.code === 'CONFIG_INVALID',
  );

  const baseRuntime = {
    createDigest() {
      return { digest: () => 'synthetic' };
    },
    createSource() {
      return {
        async readFullSnapshotObservation() {
          return { snapshotDigest: 'fresh-authoritative-digest' };
        },
      };
    },
    async createYdbClient() {
      return {
        transport: {
          async executeRead() {
            throw new Error('unexpected read');
          },
          async serializableReadWrite() {
            throw new Error('unexpected write');
          },
        },
        async close() {},
      };
    },
    now() {
      return '2026-09-16T08:30:00.000Z';
    },
    async retire() {},
  };

  await t.test('source read', async () => {
    await assert.rejects(
      executeInitialBootstrapStaleStagingRetirementJob(CONFIG, {
        ...baseRuntime,
        createSource() {
          return {
            async readFullSnapshotObservation() {
              throw new Error('synthetic private source error');
            },
          };
        },
      }),
      (error) => error instanceof InitialBootstrapStaleStagingRetirementJobError
        && error.code === 'SOURCE_READ_FAILED',
    );
  });

  await t.test('YDB client create', async () => {
    await assert.rejects(
      executeInitialBootstrapStaleStagingRetirementJob(CONFIG, {
        ...baseRuntime,
        async createYdbClient() {
          throw new Error('synthetic private YDB error');
        },
      }),
      (error) => error instanceof InitialBootstrapStaleStagingRetirementJobError
        && error.code === 'YDB_CLIENT_CREATE_FAILED',
    );
  });

  await t.test('YDB client close', async () => {
    await assert.rejects(
      executeInitialBootstrapStaleStagingRetirementJob(CONFIG, {
        ...baseRuntime,
        async createYdbClient() {
          const client = await baseRuntime.createYdbClient();
          return {
            ...client,
            async close() {
              throw new Error('synthetic private close error');
            },
          };
        },
      }),
      (error) => error instanceof InitialBootstrapStaleStagingRetirementJobError
        && error.code === 'YDB_CLIENT_CLOSE_FAILED',
    );
  });
});

test('retirement job uses one fresh authoritative digest, one YDB client and always closes it', async () => {
  const observations = [];
  const closes = [];
  const runtime = {
    createDigest() {
      return { digest: () => 'synthetic' };
    },
    createSource() {
      return {
        async readFullSnapshotObservation() {
          return { snapshotDigest: 'fresh-authoritative-digest' };
        },
      };
    },
    async createYdbClient() {
      return {
        transport: {
          async executeRead() {
            throw new Error('unexpected read');
          },
          async serializableReadWrite() {
            throw new Error('unexpected write');
          },
        },
        async close() {
          closes.push('closed');
        },
      };
    },
    now() {
      return '2026-09-16T08:30:00.000Z';
    },
    async retire(_adapter, authoritativeSnapshotDigest, finishedAt) {
      observations.push({ authoritativeSnapshotDigest, finishedAt });
    },
  };

  await executeInitialBootstrapStaleStagingRetirementJob(CONFIG, runtime);

  assert.deepEqual(observations, [{
    authoritativeSnapshotDigest: 'fresh-authoritative-digest',
    finishedAt: '2026-09-16T08:30:00.000Z',
  }]);
  assert.deepEqual(closes, ['closed']);
});
