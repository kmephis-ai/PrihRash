import {
  createCanonicalSourceDigest,
  type CanonicalSourceDigest,
} from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsFullSnapshotLease,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  runInitialBootstrapApplication,
} from '../migration/initialBootstrapApplication.js';
import {
  createInitialBootstrapDurableReconciliation,
} from '../migration/initialBootstrapDurableReconciliation.js';
import {
  parseInitialBootstrapPrivateHistoricalEvidence,
} from '../migration/initialBootstrapPrivateEvidence.js';
import {
  createNodeInitialBootstrapRuntimePrimitives,
  type InitialBootstrapRuntimePrimitives,
} from '../migration/initialBootstrapRuntimePrimitives.js';
import { projectGoogleSnapshotForIncrementalMigration } from '../migration/googleSnapshotProjection.js';
import { readScheduledSyncAdmissionEvidence } from '../migration/scheduledSyncAdmissionEvidence.js';
import {
  planInitialReferenceBootstrap,
  type InitialReferenceBootstrapPlan,
} from '../reference/initialBootstrapReferencePlan.js';
import { createInitialBootstrapReferenceClaimAdapter } from './initialBootstrapReferenceClaimAdapter.js';
import {
  executeInitialBootstrapJob,
  readInitialBootstrapJobConfig,
  type InitialBootstrapJobConfig,
  type InitialBootstrapJobEnvironment,
  type InitialBootstrapJobRuntime,
} from './initialBootstrapJob.js';

export type InitialBootstrapReferenceAwareRuntimeErrorCode =
  | 'REFERENCE_RUNTIME_STATE_INVALID'
  | 'REFERENCE_BOOTSTRAP_RESUME_UNSAFE';

export class InitialBootstrapReferenceAwareRuntimeError extends Error {
  readonly code: InitialBootstrapReferenceAwareRuntimeErrorCode;

  constructor(code: InitialBootstrapReferenceAwareRuntimeErrorCode) {
    super(code);
    this.name = 'InitialBootstrapReferenceAwareRuntimeError';
    this.code = code;
  }
}

function createReferenceAwareRuntime(): Readonly<InitialBootstrapJobRuntime> {
  let lease: Readonly<GoogleSheetsFullSnapshotLease> | null = null;
  let digest: Readonly<CanonicalSourceDigest> | null = null;
  let primitives: Readonly<InitialBootstrapRuntimePrimitives> | null = null;
  let referencePlan: Readonly<InitialReferenceBootstrapPlan> | null = null;

  const runtime: InitialBootstrapJobRuntime = {
    createDigest(): Readonly<CanonicalSourceDigest> {
      digest = createCanonicalSourceDigest();
      return digest;
    },
    parseHistoricalEvidence: parseInitialBootstrapPrivateHistoricalEvidence,
    createSource(
      config: Readonly<InitialBootstrapJobConfig>,
      receivedDigest: Readonly<CanonicalSourceDigest>,
    ) {
      const accessTokenProvider = createGoogleServiceAccountSheetsAccessTokenProvider({
        clientEmail: config.googleServiceAccountEmail,
        privateKey: config.googleServiceAccountPrivateKey,
      });
      const reader = new GoogleSheetsFullSnapshotReader({
        spreadsheetId: config.spreadsheetId,
        fetch: async (input, init) => fetch(input, init),
        accessTokenProvider,
        digest: receivedDigest,
      });
      return Object.freeze({
        async readFullSnapshotObservation() {
          lease = await reader.readFullSnapshotObservation();
          return lease;
        },
      });
    },
    createRuntimePrimitives(): Readonly<InitialBootstrapRuntimePrimitives> {
      primitives = createNodeInitialBootstrapRuntimePrimitives();
      return primitives;
    },
    createYdbClient(config: Readonly<InitialBootstrapJobConfig>): Promise<Readonly<YdbJsDataClient>> {
      return createYdbJsV6MetadataDataClient({
        connectionString: config.ydbConnectionString,
        poolMaxSize: 1,
      });
    },
    async readReferenceResolver(adapter: YdbAdapter) {
      if (lease === null || digest === null || primitives === null) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_RUNTIME_STATE_INVALID');
      }
      const projected = projectGoogleSnapshotForIncrementalMigration(lease.snapshot, digest);
      referencePlan = await planInitialReferenceBootstrap(
        adapter,
        projected.rows.map((row, sourceOrdinal) => Object.freeze({
          sourceOrdinal,
          rawPayload: row.rawPayload,
        })),
        primitives.referenceIdentityAllocator,
      );
      return referencePlan.resolver;
    },
    createReconciliation(adapter, projectionContext, historicalEvidence) {
      return createInitialBootstrapDurableReconciliation(
        adapter,
        projectionContext,
        historicalEvidence,
      );
    },
    async runApplication(observation, dependencies) {
      if (referencePlan === null) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_RUNTIME_STATE_INVALID');
      }
      if (referencePlan.writes.length === 0) {
        return runInitialBootstrapApplication(observation, dependencies);
      }

      const admission = await readScheduledSyncAdmissionEvidence(dependencies.adapter);
      if (admission.committedBaselineRun !== null || admission.incompleteRuns.length !== 0) {
        throw new InitialBootstrapReferenceAwareRuntimeError('REFERENCE_BOOTSTRAP_RESUME_UNSAFE');
      }
      const adapter = createInitialBootstrapReferenceClaimAdapter(
        dependencies.adapter,
        referencePlan,
      );
      return runInitialBootstrapApplication(observation, Object.freeze({
        ...dependencies,
        adapter,
      }));
    },
  };
  return Object.freeze(runtime);
}

export function runInitialBootstrapReferenceAwareJob(
  config: Readonly<InitialBootstrapJobConfig>,
) {
  return executeInitialBootstrapJob(config, createReferenceAwareRuntime());
}

export function runInitialBootstrapReferenceAwareJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
) {
  return runInitialBootstrapReferenceAwareJob(readInitialBootstrapJobConfig(environment));
}
