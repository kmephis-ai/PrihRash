import type {
  InitialControlledRebuildApplicationPhase,
  InitialControlledRebuildRecoveryReason,
} from '../migration/initialControlledRebuildApplication.js';
import { InitialBootstrapPrivateEvidenceError } from '../migration/initialBootstrapPrivateEvidence.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  type InitialReconciliationCheck,
  type InitialValidationBlockerCode,
} from '../migration/initialValidationGate.js';
import {
  InitialControlledRebuildJobError,
  runInitialControlledRebuildJobFromEnvironment,
  runInitialControlledRebuildSwapRecoveryDiagnosticJobFromEnvironment,
  type InitialControlledRebuildJobErrorCode,
  type InitialControlledRebuildJobObserver,
  type InitialControlledRebuildRuntimePhase,
} from './initialControlledRebuildJob.js';
import {
  InitialBootstrapJobError,
  type InitialBootstrapJobEnvironment,
} from './initialBootstrapJob.js';

export interface YandexInitialControlledRebuildValidationBlocker {
  readonly code: InitialValidationBlockerCode;
  readonly check?: InitialReconciliationCheck;
}

export type YandexInitialControlledRebuildRuntimeFailure = Readonly<{
  status: 'FAIL';
  code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED';
  jobCode: InitialControlledRebuildJobErrorCode | 'CONFIG_INVALID' | 'UNCAUGHT';
  phase: InitialControlledRebuildApplicationPhase | null;
}>;

export type YandexInitialControlledRebuildFunctionResult =
  | Readonly<{ status: 'PASS'; code: 'INITIAL_CONTROLLED_REBUILD_COMMITTED' }>
  | Readonly<{ status: 'NOOP'; code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED';
      blockers: readonly Readonly<YandexInitialControlledRebuildValidationBlocker>[];
    }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED';
      recoveryReason: InitialControlledRebuildRecoveryReason;
    }>
  | YandexInitialControlledRebuildRuntimeFailure;

export type YandexInitialControlledRebuildSwapRecoveryDiagnosticFunctionResult =
  | Readonly<{
      status: 'PASS';
      code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED';
      verdict: 'APPLIED' | 'NOT_APPLIED';
    }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED';
      verdict: 'RECOVERY_REQUIRED';
    }>
  | Readonly<{ status: 'NOOP'; code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED';
      blockers: readonly Readonly<YandexInitialControlledRebuildValidationBlocker>[];
    }>
  | YandexInitialControlledRebuildRuntimeFailure;

export interface YandexInitialControlledRebuildJob {
  (environment: InitialBootstrapJobEnvironment): Promise<unknown>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

export const INITIAL_CONTROLLED_REBUILD_PHASE_MARKER_PREFIX = 'R1_CONTROLLED_PHASE:';

export function formatInitialControlledRebuildPhaseMarker(
  phase: InitialControlledRebuildRuntimePhase,
): string {
  return `${INITIAL_CONTROLLED_REBUILD_PHASE_MARKER_PREFIX}${phase}`;
}

function yandexPhaseObserver(): Readonly<InitialControlledRebuildJobObserver> {
  return Object.freeze({
    observePhase(phase: InitialControlledRebuildRuntimePhase) {
      process.stdout.write(`${formatInitialControlledRebuildPhaseMarker(phase)}\n`);
    },
  });
}

const RECOVERY_REASONS = new Set<InitialControlledRebuildRecoveryReason>([
  'VALIDATION_TRANSITION_OUTCOME_UNKNOWN',
  'SETUP_STATE_AMBIGUOUS',
  'SETUP_OUTCOME_NOT_APPLIED',
  'SETUP_OUTCOME_AMBIGUOUS',
  'STAGING_MATERIALIZATION_INCOMPLETE',
  'SWAP_OUTCOME_NOT_APPLIED',
  'SWAP_OUTCOME_AMBIGUOUS',
  'COMMIT_MARKER_PENDING',
  'COMMIT_MARKER_OUTCOME_AMBIGUOUS',
  'POST_SWAP_VERIFICATION_MISMATCH',
  'POST_COMMIT_VERIFICATION_MISMATCH',
]);
const VALIDATION_BLOCKER_CODES = new Set<InitialValidationBlockerCode>([
  'RUN_NOT_STAGING',
  'INITIAL_RUN_COUNTERS_INCONSISTENT',
  'PROJECTION_COUNTERS_INCONSISTENT',
  'RUN_ROW_COUNT_MISMATCH',
  'RUN_AMBIGUOUS_COUNT_MISMATCH',
  'INVALID_ROWS_PRESENT',
  'PROJECTION_FAILURES_PRESENT',
  'TRANSACTION_COVERAGE_MISMATCH',
  'INVALID_RECONCILIATION_EVIDENCE',
  'RECONCILIATION_CHECK_NOT_MATCHED',
  'UNEXPLAINED_HIGH_IMPACT_MISMATCH',
]);
const RECONCILIATION_CHECKS = new Set<InitialReconciliationCheck>(INITIAL_RECONCILIATION_CHECKS);

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function runtimeFailure(
  jobCode: InitialControlledRebuildJobErrorCode | 'CONFIG_INVALID' | 'UNCAUGHT',
  phase: InitialControlledRebuildApplicationPhase | null = null,
): Readonly<YandexInitialControlledRebuildRuntimeFailure> {
  return Object.freeze({
    status: 'FAIL' as const,
    code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED' as const,
    jobCode,
    phase,
  });
}

function validationBlocker(value: unknown): Readonly<YandexInitialControlledRebuildValidationBlocker> | null {
  const object = record(value);
  if (
    object === null
    || typeof object.code !== 'string'
    || !VALIDATION_BLOCKER_CODES.has(object.code as InitialValidationBlockerCode)
  ) return null;

  const code = object.code as InitialValidationBlockerCode;
  if (code === 'RECONCILIATION_CHECK_NOT_MATCHED') {
    if (
      typeof object.check !== 'string'
      || !RECONCILIATION_CHECKS.has(object.check as InitialReconciliationCheck)
    ) return null;
    return Object.freeze({ code, check: object.check as InitialReconciliationCheck });
  }
  if (object.check !== undefined) return null;
  return Object.freeze({ code });
}

function validationBlockers(value: unknown): readonly Readonly<YandexInitialControlledRebuildValidationBlocker>[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return null;
  const blockers: Readonly<YandexInitialControlledRebuildValidationBlocker>[] = [];
  for (const entry of value) {
    const parsed = validationBlocker(entry);
    if (parsed === null) return null;
    blockers.push(parsed);
  }
  return Object.freeze(blockers);
}

function sanitizeSwapRecoveryDiagnosticResult(
  value: unknown,
): Readonly<YandexInitialControlledRebuildSwapRecoveryDiagnosticFunctionResult> {
  const result = record(value);
  if (result === null || typeof result.status !== 'string') return runtimeFailure('UNCAUGHT');

  if (result.status === 'CLASSIFIED') {
    if (result.verdict === 'APPLIED' || result.verdict === 'NOT_APPLIED') {
      return Object.freeze({
        status: 'PASS' as const,
        code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED' as const,
        verdict: result.verdict,
      });
    }
    if (result.verdict === 'RECOVERY_REQUIRED') {
      return Object.freeze({
        status: 'STOP' as const,
        code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED' as const,
        verdict: 'RECOVERY_REQUIRED' as const,
      });
    }
    return runtimeFailure('UNCAUGHT');
  }
  if (result.status === 'BASELINE_EXISTS') {
    return Object.freeze({ status: 'NOOP' as const, code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' as const });
  }
  if (result.status === 'VALIDATION_BLOCKED') {
    const blockers = validationBlockers(result.blockers);
    if (blockers === null) return runtimeFailure('UNCAUGHT');
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED' as const,
      blockers,
    });
  }
  return runtimeFailure('UNCAUGHT');
}

function sanitizeApplicationResult(value: unknown): Readonly<YandexInitialControlledRebuildFunctionResult> {
  const result = record(value);
  if (result === null || typeof result.status !== 'string') return runtimeFailure('UNCAUGHT');

  if (result.status === 'COMMITTED') {
    return Object.freeze({ status: 'PASS' as const, code: 'INITIAL_CONTROLLED_REBUILD_COMMITTED' as const });
  }
  if (result.status === 'BASELINE_EXISTS') {
    return Object.freeze({ status: 'NOOP' as const, code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' as const });
  }
  if (result.status === 'RECOVERY_REQUIRED') {
    if (
      typeof result.reason !== 'string'
      || !RECOVERY_REASONS.has(result.reason as InitialControlledRebuildRecoveryReason)
    ) return runtimeFailure('UNCAUGHT');
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED' as const,
      recoveryReason: result.reason as InitialControlledRebuildRecoveryReason,
    });
  }
  if (result.status === 'VALIDATION_BLOCKED') {
    const blockers = validationBlockers(result.blockers);
    if (blockers === null) return runtimeFailure('UNCAUGHT');
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_VALIDATION_BLOCKED' as const,
      blockers,
    });
  }
  return runtimeFailure('UNCAUGHT');
}

export async function executeYandexInitialControlledRebuildFunction(
  environment: InitialBootstrapJobEnvironment,
  runJob: YandexInitialControlledRebuildJob,
): Promise<Readonly<YandexInitialControlledRebuildFunctionResult>> {
  try {
    return sanitizeApplicationResult(await runJob(environment));
  } catch (error) {
    if (error instanceof InitialControlledRebuildJobError) return runtimeFailure(error.code, error.phase);
    if (error instanceof InitialBootstrapPrivateEvidenceError || error instanceof InitialBootstrapJobError) {
      return runtimeFailure('CONFIG_INVALID');
    }
    return runtimeFailure('UNCAUGHT');
  }
}

export async function initialControlledRebuildHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexInitialControlledRebuildFunctionResult>> {
  const observer = yandexPhaseObserver();
  return executeYandexInitialControlledRebuildFunction(
    process.env,
    (environment) => runInitialControlledRebuildJobFromEnvironment(environment, observer),
  );
}

export async function executeYandexInitialControlledRebuildSwapRecoveryDiagnosticFunction(
  environment: InitialBootstrapJobEnvironment,
  runJob: YandexInitialControlledRebuildJob,
): Promise<Readonly<YandexInitialControlledRebuildSwapRecoveryDiagnosticFunctionResult>> {
  try {
    return sanitizeSwapRecoveryDiagnosticResult(await runJob(environment));
  } catch (error) {
    if (error instanceof InitialControlledRebuildJobError) return runtimeFailure(error.code, error.phase);
    if (error instanceof InitialBootstrapPrivateEvidenceError || error instanceof InitialBootstrapJobError) {
      return runtimeFailure('CONFIG_INVALID');
    }
    return runtimeFailure('UNCAUGHT');
  }
}

export async function initialControlledRebuildSwapRecoveryDiagnosticHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexInitialControlledRebuildSwapRecoveryDiagnosticFunctionResult>> {
  const observer = yandexPhaseObserver();
  return executeYandexInitialControlledRebuildSwapRecoveryDiagnosticFunction(
    process.env,
    (environment) => runInitialControlledRebuildSwapRecoveryDiagnosticJobFromEnvironment(environment, observer),
  );
}
