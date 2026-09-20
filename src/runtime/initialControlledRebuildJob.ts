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
  diagnoseInitialControlledRebuildSwapRecovery,
  runInitialControlledRebuildApplication,
  type InitialControlledRebuildApplicationPhase,
  type InitialControlledRebuildApplicationResult,
  type InitialControlledRebuildSwapRecoveryDiagnosticResult,
} from '../migration/initialControlledRebuildApplication.js';
import { createInitialBootstrapDurableReconciliation } from '../migration/initialBootstrapDurableReconciliation.js';
import type { InitialBootstrapApplicationPhase } from '../migration/initialBootstrapApplication.js';
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

export const INITIAL_CONTROLLED_REBUILD_YDB_READY_TIMEOUT_MS = 10_000 as const;
export const INITIAL_CONTROLLED_REBUILD_YDB_READ_TIMEOUT_MS = 21_000 as const;
export const INITIAL_CONTROLLED_REBUILD_YDB_TRANSACTION_TIMEOUT_MS = 25_000 as const;

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
  readonly bootstrapPhase: InitialBootstrapApplicationPhase | null;

  constructor(
    code: InitialControlledRebuildJobErrorCode,
    phase: InitialControlledRebuildApplicationPhase | null = null,
    bootstrapPhase: InitialBootstrapApplicationPhase | null = null,
  ) {
    super(code);
    this.name = 'InitialControlledRebuildJobError';
    this.code = code;
    this.phase = phase;
    this.bootstrapPhase = bootstrapPhase;
  }
}

export interface InitialControlledRebuildJobYdbClient {
  readonly transport: YdbTransport;
  createSchemeTransport(): Promise<YdbSchemeTransport>;
  close(): Promise<void>;
}

export type InitialControlledRebuildRuntimePhase =
  | 'YDB_CLIENT_CREATE_START'
  | 'YDB_CLIENT_READY'
  | 'SOURCE_READ_START'
  | 'SOURCE_READ_DONE'
  | 'SCHEME_CLIENT_CREATE_START'
  | 'SCHEME_CLIENT_READY'
  | 'REFERENCE_READ_START'
  | 'REFERENCE_READ_DONE'
  | 'APPLICATION_START'
  | `BOOTSTRAP_${InitialBootstrapApplicationPhase}`
  | `CONTROLLED_${InitialControlledRebuildApplicationPhase}`
  | 'APPLICATION_DONE'
  | 'POST_COMMIT_RECONCILIATION_START'
  | 'POST_COMMIT_RECONCILIATION_DONE'
  | 'YDB_CLIENT_CLOSE_START'
  | 'YDB_CLIENT_CLOSE_DONE';

export interface InitialControlledRebuildJobObserver {
  observePhase?(phase: InitialControlledRebuildRuntimePhase): void;
}

function observeRuntimePhase(
  observer: Readonly<InitialControlledRebuildJobObserver>,
  phase: InitialControlledRebuildRuntimePhase,
): void {
  try {
    observer.observePhase?.(phase);
  } catch {
    // Diagnostics must never change controlled rebuild behavior or authority.
  }
}

function reconciliationMatched(evidence: Readonly<InitialReconciliationEvidence>): boolean {
  return Number.isSafeInteger(evidence.unexplainedHighImpactMismatchCount)
    && evidence.unexplainedHighImpactMismatchCount === 0
    && INITIAL_RECONCILIATION_CHECKS.every((check) => evidence.checks[check] === 'MATCHED');
}

async function readInitialControlledRebuildObservation(
  config: Readonly<InitialBootstrapJobConfig>,
  historicalEvidence: ReturnType<typeof parseInitialBootstrapPrivateHistoricalEvidence>,
  now: () => string,
): Promise<ReturnType<typeof buildInitialBootstrapObservation>> {
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

  let lease;
  try {
    lease = await source.readFullSnapshotObservation();
  } catch {
    throw new InitialControlledRebuildJobError('SOURCE_READ_FAILED');
  }

  return buildInitialBootstrapObservation(
    lease,
    digest,
    historicalEvidence,
    now(),
  );
}

export function runInitialControlledRebuildJob(
  config: Readonly<InitialBootstrapJobConfig>,
  observer?: Readonly<InitialControlledRebuildJobObserver>,
): Promise<InitialControlledRebuildApplicationResult>;
export function runInitialControlledRebuildJob(
  config: Readonly<InitialBootstrapJobConfig>,
  observer: Readonly<InitialControlledRebuildJobObserver>,
  mode: 'SWAP_RECOVERY_DIAGNOSTIC',
): Promise<InitialControlledRebuildSwapRecoveryDiagnosticResult>;
export async function runInitialControlledRebuildJob(
  config: Readonly<InitialBootstrapJobConfig>,
  observer: Readonly<InitialControlledRebuildJobObserver> = Object.freeze({}),
  mode: 'CONTROLLED' | 'SWAP_RECOVERY_DIAGNOSTIC' = 'CONTROLLED',
): Promise<InitialControlledRebuildApplicationResult | InitialControlledRebuildSwapRecoveryDiagnosticResult> {
  const historicalEvidence = parseInitialBootstrapPrivateHistoricalEvidence(config.privateHistoricalEvidence);
  const primitives = createNodeInitialBootstrapRuntimePrimitives();

  let ydbClient: Readonly<YdbJsDataClient>;
  observeRuntimePhase(observer, 'YDB_CLIENT_CREATE_START');
  try {
    ydbClient = await createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
      readyTimeoutMs: INITIAL_CONTROLLED_REBUILD_YDB_READY_TIMEOUT_MS,
      readTimeoutMs: INITIAL_CONTROLLED_REBUILD_YDB_READ_TIMEOUT_MS,
      transactionTimeoutMs: INITIAL_CONTROLLED_REBUILD_YDB_TRANSACTION_TIMEOUT_MS,
    });
    observeRuntimePhase(observer, 'YDB_CLIENT_READY');
  } catch {
    throw new InitialControlledRebuildJobError('YDB_CLIENT_CREATE_FAILED');
  }

  let primaryError: unknown = null;
  let controlledPhase: InitialControlledRebuildApplicationPhase | null = null;
  let bootstrapPhase: InitialBootstrapApplicationPhase | null = null;
  try {
    observeRuntimePhase(observer, 'SOURCE_READ_START');
    const observation = await readInitialControlledRebuildObservation(
      config,
      historicalEvidence,
      () => primitives.clock.now(),
    );
    observeRuntimePhase(observer, 'SOURCE_READ_DONE');
    const adapter = new YdbAdapter(ydbClient.transport);

    let schemeTransport: YdbSchemeTransport;
    observeRuntimePhase(observer, 'SCHEME_CLIENT_CREATE_START');
    try {
      schemeTransport = await ydbClient.createSchemeTransport();
      observeRuntimePhase(observer, 'SCHEME_CLIENT_READY');
    } catch {
      throw new InitialControlledRebuildJobError('SCHEME_CLIENT_CREATE_FAILED');
    }
    const scheme = new YdbSchemeAdapter(schemeTransport);

    let refs;
    observeRuntimePhase(observer, 'REFERENCE_READ_START');
    try {
      refs = await readYdbReferenceResolverSnapshot(adapter);
      observeRuntimePhase(observer, 'REFERENCE_READ_DONE');
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

    let result: InitialControlledRebuildApplicationResult | InitialControlledRebuildSwapRecoveryDiagnosticResult;
    observeRuntimePhase(observer, 'APPLICATION_START');
    const applicationDependencies = Object.freeze({
      adapter,
      scheme,
      identityAllocator: primitives.identityAllocator,
      projectionContext,
      reconciliation: reconciliation.port,
      clock: primitives.clock,
      observePhase(nextPhase: InitialBootstrapApplicationPhase) {
        bootstrapPhase = nextPhase;
        observeRuntimePhase(observer, `BOOTSTRAP_${nextPhase}`);
      },
      observeControlledPhase(nextPhase: InitialControlledRebuildApplicationPhase) {
        controlledPhase = nextPhase;
        if (nextPhase !== 'PREPARATION') bootstrapPhase = null;
        observeRuntimePhase(observer, `CONTROLLED_${nextPhase}`);
      },
    });
    try {
      result = mode === 'SWAP_RECOVERY_DIAGNOSTIC'
        ? await diagnoseInitialControlledRebuildSwapRecovery(observation, applicationDependencies)
        : await runInitialControlledRebuildApplication(observation, applicationDependencies);
    } catch {
      throw new InitialControlledRebuildJobError('APPLICATION_FAILED', controlledPhase, bootstrapPhase);
    }
    observeRuntimePhase(observer, 'APPLICATION_DONE');

    if (mode === 'CONTROLLED' && result.status === 'COMMITTED') {
      observeRuntimePhase(observer, 'POST_COMMIT_RECONCILIATION_START');
      if (!reconciliationMatched(await reconciliation.verifyCommittedCurrent())) {
        throw new InitialControlledRebuildJobError(
          'POST_COMMIT_RECONCILIATION_MISMATCH',
          'POST_COMMIT_VERIFICATION',
        );
      }
      observeRuntimePhase(observer, 'POST_COMMIT_RECONCILIATION_DONE');
    }
    return result;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    observeRuntimePhase(observer, 'YDB_CLIENT_CLOSE_START');
    try {
      await ydbClient.close();
      observeRuntimePhase(observer, 'YDB_CLIENT_CLOSE_DONE');
    } catch {
      if (primaryError === null) {
        throw new InitialControlledRebuildJobError('YDB_CLIENT_CLOSE_FAILED', controlledPhase);
      }
    }
  }
}

export function runInitialControlledRebuildJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
  observer: Readonly<InitialControlledRebuildJobObserver> = Object.freeze({}),
): Promise<InitialControlledRebuildApplicationResult> {
  return runInitialControlledRebuildJob(readInitialBootstrapJobConfig(environment), observer);
}

export function runInitialControlledRebuildSwapRecoveryDiagnosticJobFromEnvironment(
  environment: InitialBootstrapJobEnvironment = process.env,
  observer: Readonly<InitialControlledRebuildJobObserver> = Object.freeze({}),
): Promise<InitialControlledRebuildSwapRecoveryDiagnosticResult> {
  return runInitialControlledRebuildJob(
    readInitialBootstrapJobConfig(environment),
    observer,
    'SWAP_RECOVERY_DIAGNOSTIC',
  );
}
