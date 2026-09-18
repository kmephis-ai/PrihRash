import { createCanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import { GoogleSheetsFullSnapshotReader } from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import { YdbSchemeAdapter, type YdbSchemeTransport } from '../integration/ydb/scheme.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  runInitialControlledRebuildApplication,
  type InitialControlledRebuildApplicationPhase,
  type InitialControlledRebuildApplicationResult,
} from '../migration/initialControlledRebuildApplication.js';
import { createInitialBootstrapDurableReconciliation } from '../migration/initialBootstrapDurableReconciliation.js';
import { parseInitialBootstrapPrivateHistoricalEvidence } from '../migration/initialBootstrapPrivateEvidence.js';
import { createNodeInitialBootstrapRuntimePrimitives } from '../migration/initialBootstrapRuntimePrimitives.js';
import type { InitialSnapshotProjectionContext } from '../migration/initialSnapshotProjection.js';
import { INITIAL_RECONCILIATION_CHECKS, type InitialReconciliationEvidence } from '../migration/initialValidationGate.js';
import { readYdbReferenceResolverSnapshot } from '../reference/ydbReferenceEvidenceReader.js';
import {
  buildInitialBootstrapObservation,
  readInitialBootstrapJobConfig,
  type InitialBootstrapJobConfig,
  type InitialBootstrapJobEnvironment,
} from './initialBootstrapJob.js';

export type InitialControlledRebuildJobErrorCode =
  | 'SOURCE_READ_FAILED'
  | 'YDB_CLIENT_CREATE_FAILED'
  | 'SCHEME_CLIENT_CREATE_FAILED'
  | 'REFERENCE_READ_FAILED'
  | 'APPLICATION_FAILED'
  | 'POST_COMMIT_RECONCILIATION_MISMATCH'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class InitialControlledRebuildJobError extends Error {
  readonly code: InitialControlledRebuildJobErrorCode;
  readonly phase: InitialControlledRebuildApplicationPhase | null;

  constructor(
    code: InitialControlledRebuildJobErrorCode,
    phase: InitialControlledRebuildApplicationPhase | null = null,
  ) {
    super(code);
    this.name = 'InitialControlledRebuildJobError';
    this.code = code;
    this.phase = phase;
  }
}

export interface InitialControlledRebuildJobYdbClient {
  readonly transport: YdbTransport;
  createSchemeTransport(): Promise<YdbSchemeTransport>;
  close(): Promise<void>;
}

function reconciliationMatched(evidence: Readonly<InitialReconciliationEvidence>): boolean {
  return Number.isSafeInteger(evidence.unexplainedHighImpactMismatchCount)
    && evidence.unexplainedHighImpactMismatchCount === 0
    && INITIAL_RECONCILIATION_CHECKS.every((check) => evidence.checks[check] === 'MATCHED');
}

export async function runInitialControlledRebuildJob(
  config: Readonly<InitialBootstrapJobConfig>,
): Promise<InitialControlledRebuildApplicationResult> {
  const historicalEvidence = parseInitialBootstrapPrivateHistoricalEvidence(config.privateHistoricalEvidence);
  const digest = createCanonicalSourceDigest();
  const accessTokenProvider = createGoogleServiceAccountSheetsAccessTokenProvider({
    clientEmail: config.googleServiceAccountEmail,
    privateKey: config.googleServiceAccountPrivateKey,
  });
  const source = new GoogleSheetsFullSnapshotReader({
    spreadsheetId: config.spreadsheetId,
    fetch: async (input, init) => fetch(input, init),
    accessTokenProvider,
    digest,
  });
  const primitives = createNodeInitialBootstrapRuntimePrimitives();

  let ydbClient: Readonly<YdbJsDataClient>;
  try {
    ydbClient = await createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  } catch {
    throw new InitialControlledRebuildJobError('YDB_CLIENT_CREATE_FAILED');
  }

  let primaryError: unknown = null;
  let controlledPhase: InitialControlledRebuildApplicationPhase | null = null;
  try {
    let lease;
    try {
      lease = await source.readFullSnapshotObservation();
    } catch {
      throw new InitialControlledRebuildJobError('SOURCE_READ_FAILED');
    }
    const observation = buildInitialBootstrapObservation(
      lease,
      digest,
      historicalEvidence,
      primitives.clock.now(),
    );
    const adapter = new YdbAdapter(ydbClient.transport);

    let schemeTransport: YdbSchemeTransport;
    try {
      schemeTransport = await ydbClient.createSchemeTransport();
    } catch {
      throw new InitialControlledRebuildJobError('SCHEME_CLIENT_CREATE_FAILED');
    }
    const scheme = new YdbSchemeAdapter(schemeTransport);

    let refs;
    try {
      refs = await readYdbReferenceResolverSnapshot(adapter);
    } catch {
      throw new InitialControlledRebuildJobError('REFERENCE_READ_FAILED');
    }
    const projectionContext: Readonly<InitialSnapshotProjectionContext> = Object.freeze({
      granularityEvidence: historicalEvidence.granularityEvidence,
      refs,
    });
    const reconciliation = createInitialBootstrapDurableReconciliation(
      adapter,
      projectionContext,
      historicalEvidence,
    );

    let result: InitialControlledRebuildApplicationResult;
    try {
      result = await runInitialControlledRebuildApplication(observation, {
        adapter,
        scheme,
        identityAllocator: primitives.identityAllocator,
        projectionContext,
        reconciliation: reconciliation.port,
        clock: primitives.clock,
        observeControlledPhase(nextPhase) {
          controlledPhase = nextPhase;
        },
      });
    } catch {
      throw new InitialControlledRebuildJobError('APPLICATION_FAILED', controlledPhase);
    }

    if (result.status === 'COMMITTED') {
      if (!reconciliationMatched(await reconciliation.verifyCommittedCurrent())) {
        throw new InitialControlledRebuildJobError(
          'POST_COMMIT_RECONCILIATION_MISMATCH',
          'POST_COMMIT_VERIFICATION',
        );
      }
    }
    return result;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) {
        throw new InitialControlledRebuildJobError('YDB_CLIENT_CLOSE_FAILED', controlledPhase);
      }
    }
  }
}

export function runInitialControlledRebuildJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
): Promise<InitialControlledRebuildApplicationResult> {
  return runInitialControlledRebuildJob(readInitialBootstrapJobConfig(environment));
}
