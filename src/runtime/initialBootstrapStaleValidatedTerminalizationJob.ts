import { timestampParameter } from '../integration/ydb/parameters.js';
import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import { createYdbJsV6MetadataDataClient } from '../integration/ydb/ydbJsV6DataTransport.js';
import { hasInitialBootstrapGateCBlocker } from '../migration/initialBootstrapGateCGuard.js';
import {
  diagnoseInitialBootstrapStaleValidatedTerminalizationDurableOutcome,
  diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome,
  terminalizeInitialBootstrapStaleValidatedRun,
  type InitialBootstrapStaleValidatedDurableOutcome,
  type InitialBootstrapStaleValidatedTerminalizationRecoveryResult,
} from '../migration/initialBootstrapStaleValidatedTerminalization.js';
import {
  readScheduledSyncAdmissionEvidence,
  type ScheduledSyncAdmissionEvidence,
} from '../migration/scheduledSyncAdmissionEvidence.js';
import type { MigrationRun } from '../migration/migrationRunState.js';
import {
  readInitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobEnvironment,
} from './initialBootstrapRecoveryConfig.js';
import {
  runInitialBootstrapRecoveryJob,
  type InitialBootstrapRecoveryJobResult,
} from './initialBootstrapRecoveryJob.js';

export const INITIAL_BOOTSTRAP_STALE_VALIDATED_GATE_B_ENV = Object.freeze({
  finishedAt: 'PRIHRASH_R1_GATE_B_FINISHED_AT',
});

export type InitialBootstrapStaleValidatedGateBReason =
  | 'PREFLIGHT_NOT_OWNER_EXCEPTION_READY'
  | 'TERMINAL_MARKER_ALREADY_PRESENT'
  | 'VALIDATED_RUN_NOT_UNIQUE'
  | 'MARKER_OUTCOME_UNCHANGED_VALIDATED_NO_RETRY'
  | 'MARKER_OUTCOME_RECOVERY_REQUIRED'
  | 'RUNTIME_FAILED';

export type InitialBootstrapStaleValidatedGateBResult =
  | Readonly<{
      status: 'PASS';
      code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED';
      outcome: 'EXACT_FAILED_MARKER';
    }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_BLOCKED';
      reason: Exclude<InitialBootstrapStaleValidatedGateBReason, 'RUNTIME_FAILED'>;
    }>
  | Readonly<{
      status: 'FAIL';
      code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_RUNTIME_FAILED';
      reason: 'RUNTIME_FAILED';
    }>;

export interface InitialBootstrapStaleValidatedGateBYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapStaleValidatedGateBRuntime {
  runRecovery(config: Readonly<InitialBootstrapRecoveryJobConfig>): Promise<Readonly<InitialBootstrapRecoveryJobResult>>;
  createYdbClient(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
  ): Promise<Readonly<InitialBootstrapStaleValidatedGateBYdbClient>>;
  hasTerminalMarker(adapter: YdbAdapter): Promise<boolean>;
  readAdmission(adapter: YdbAdapter): Promise<Readonly<ScheduledSyncAdmissionEvidence>>;
  terminalize(
    adapter: YdbAdapter,
    finishedAt: string,
    expectedValidatedRun: Readonly<MigrationRun>,
  ): Promise<Readonly<MigrationRun>>;
  diagnoseOutcome(
    adapter: YdbAdapter,
    expectedValidatedRun: Readonly<MigrationRun>,
    finishedAt: string,
  ): Promise<InitialBootstrapStaleValidatedTerminalizationRecoveryResult>;
  diagnoseDurableOutcome(adapter: YdbAdapter): Promise<InitialBootstrapStaleValidatedDurableOutcome>;
}

const productionRuntime: Readonly<InitialBootstrapStaleValidatedGateBRuntime> = Object.freeze({
  runRecovery: runInitialBootstrapRecoveryJob,
  createYdbClient(config) {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
  hasTerminalMarker: hasInitialBootstrapGateCBlocker,
  readAdmission: readScheduledSyncAdmissionEvidence,
  terminalize: terminalizeInitialBootstrapStaleValidatedRun,
  diagnoseOutcome: diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome,
  diagnoseDurableOutcome: diagnoseInitialBootstrapStaleValidatedTerminalizationDurableOutcome,
});

function stop(
  reason: Exclude<InitialBootstrapStaleValidatedGateBReason, 'RUNTIME_FAILED'>,
): InitialBootstrapStaleValidatedGateBResult {
  return Object.freeze({
    status: 'STOP' as const,
    code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_BLOCKED' as const,
    reason,
  });
}

function pass(): InitialBootstrapStaleValidatedGateBResult {
  return Object.freeze({
    status: 'PASS' as const,
    code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED' as const,
    outcome: 'EXACT_FAILED_MARKER' as const,
  });
}

function failure(): InitialBootstrapStaleValidatedGateBResult {
  return Object.freeze({
    status: 'FAIL' as const,
    code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_RUNTIME_FAILED' as const,
    reason: 'RUNTIME_FAILED' as const,
  });
}

function readFinishedAt(environment: InitialBootstrapRecoveryJobEnvironment): string {
  const value = environment[INITIAL_BOOTSTRAP_STALE_VALIDATED_GATE_B_ENV.finishedAt];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error('INVALID_GATE_B_FINISHED_AT');
  }
  timestampParameter(value);
  return value;
}

function preflightReady(preflight: Readonly<InitialBootstrapRecoveryJobResult>): boolean {
  return preflight.verdict === 'RECOVERY_REQUIRED'
    && preflight.reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'
    && preflight.validatedSourceEvidence === 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH'
    && preflight.staleValidatedRecoveryGate?.status === 'BLOCKED'
    && preflight.staleValidatedRecoveryGate.blocker === 'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN';
}

function classifyRecovery(
  recovery: InitialBootstrapStaleValidatedDurableOutcome | InitialBootstrapStaleValidatedTerminalizationRecoveryResult,
): InitialBootstrapStaleValidatedGateBResult {
  if (recovery.verdict === 'APPLIED') return pass();
  if (recovery.reason === 'UNCHANGED_VALIDATED_NO_RETRY') {
    return stop('MARKER_OUTCOME_UNCHANGED_VALIDATED_NO_RETRY');
  }
  return stop('MARKER_OUTCOME_RECOVERY_REQUIRED');
}

async function closeClient(
  client: Readonly<InitialBootstrapStaleValidatedGateBYdbClient>,
  suppressFailure: boolean,
): Promise<void> {
  try {
    await client.close();
  } catch {
    if (!suppressFailure) throw new Error('YDB_CLIENT_CLOSE_FAILED');
  }
}

export async function executeInitialBootstrapStaleValidatedTerminalizationRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  runtime: Readonly<InitialBootstrapStaleValidatedGateBRuntime>,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  let client: Readonly<InitialBootstrapStaleValidatedGateBYdbClient> | null = null;
  try {
    client = await runtime.createYdbClient(config);
    return classifyRecovery(await runtime.diagnoseDurableOutcome(new YdbAdapter(client.transport)));
  } catch {
    return failure();
  } finally {
    if (client !== null) await closeClient(client, true);
  }
}

export async function executeInitialBootstrapStaleValidatedTerminalizationJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  finishedAt: string,
  runtime: Readonly<InitialBootstrapStaleValidatedGateBRuntime>,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  try {
    timestampParameter(finishedAt);
    const preflight = await runtime.runRecovery(config);
    if (!preflightReady(preflight)) return stop('PREFLIGHT_NOT_OWNER_EXCEPTION_READY');

    let client: Readonly<InitialBootstrapStaleValidatedGateBYdbClient> | null = null;
    let writeOutcomeUnknown = false;
    try {
      client = await runtime.createYdbClient(config);
      const adapter = new YdbAdapter(client.transport);
      if (await runtime.hasTerminalMarker(adapter)) return stop('TERMINAL_MARKER_ALREADY_PRESENT');

      const admission = await runtime.readAdmission(adapter);
      if (
        admission.committedBaselineRun !== null
        || admission.incompleteRuns.length !== 1
        || admission.incompleteRuns[0]?.state !== 'VALIDATED'
      ) {
        return stop('VALIDATED_RUN_NOT_UNIQUE');
      }
      const validatedRun = admission.incompleteRuns[0];
      if (validatedRun === undefined) return stop('VALIDATED_RUN_NOT_UNIQUE');

      try {
        await runtime.terminalize(adapter, finishedAt, validatedRun);
        try {
          return classifyRecovery(await runtime.diagnoseOutcome(adapter, validatedRun, finishedAt));
        } catch {
          writeOutcomeUnknown = true;
        }
      } catch {
        writeOutcomeUnknown = true;
      }
    } finally {
      if (client !== null) await closeClient(client, writeOutcomeUnknown);
    }

    return await executeInitialBootstrapStaleValidatedTerminalizationRecoveryJob(config, runtime);
  } catch {
    return failure();
  }
}

export function runInitialBootstrapStaleValidatedTerminalizationJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  finishedAt: string,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  return executeInitialBootstrapStaleValidatedTerminalizationJob(config, finishedAt, productionRuntime);
}

export function runInitialBootstrapStaleValidatedTerminalizationRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  return executeInitialBootstrapStaleValidatedTerminalizationRecoveryJob(config, productionRuntime);
}

export function runInitialBootstrapStaleValidatedTerminalizationFromEnvironment(
  environment: InitialBootstrapRecoveryJobEnvironment = process.env,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  const config = readInitialBootstrapRecoveryJobConfig(environment);
  return runInitialBootstrapStaleValidatedTerminalizationJob(config, readFinishedAt(environment));
}

export function runInitialBootstrapStaleValidatedTerminalizationRecoveryFromEnvironment(
  environment: InitialBootstrapRecoveryJobEnvironment = process.env,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  return runInitialBootstrapStaleValidatedTerminalizationRecoveryJob(
    readInitialBootstrapRecoveryJobConfig(environment),
  );
}
