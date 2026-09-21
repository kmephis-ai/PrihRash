import type {
  InitialControlledRebuildApplicationPhase,
  InitialControlledRebuildRecoveryReason,
  InitialControlledRebuildSwapRecoveryReason,
} from '../migration/initialControlledRebuildApplication.js';
import type { InitialBootstrapApplicationPhase } from '../migration/initialBootstrapApplication.js';
import { InitialBootstrapPrivateEvidenceError } from '../migration/initialBootstrapPrivateEvidence.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  type InitialReconciliationCheck,
  type InitialValidationBlockerCode,
} from '../migration/initialValidationGate.js';
import {
  InitialControlledRebuildJobError,
  runInitialControlledRebuildJobFromEnvironment,
  runInitialControlledRebuildPreparationDiagnosticJobFromEnvironment,
  runInitialControlledRebuildSwapRecoveryDiagnosticJobFromEnvironment,
  type InitialControlledRebuildJobErrorCode,
  type InitialControlledRebuildPreparationDiagnosticFailureCategory,
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
  bootstrapPhase: InitialBootstrapApplicationPhase | null;
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

export type YandexInitialControlledRebuildPreparationDiagnosticFunctionResult =
  | Readonly<{ status: 'PASS'; code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_READY' }>
  | Readonly<{ status: 'NOOP'; code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' }>
  | Readonly<{ status: 'STOP'; code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_VALIDATION_BLOCKED' }>
  | Readonly<{
      status: 'FAIL';
      code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_FAILED';
      category: InitialControlledRebuildPreparationDiagnosticFailureCategory;
      errorCode: string | null;
      bootstrapPhase: InitialBootstrapApplicationPhase | null;
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
      recoveryReason: InitialControlledRebuildSwapRecoveryReason;
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

const PREPARATION_BOOTSTRAP_PHASES = new Set<InitialBootstrapApplicationPhase>([
  'ADMISSION_READ',
  'RESUME_CONTEXT_READ',
  'RESUME_IDENTITY_MANIFEST_READ',
  'RESUME_SNAPSHOT_READ',
  'RESUME_CONTEXT_PREPARATION',
  'LINEAGE_PREPARATION',
  'RECONCILIATION_READ',
  'VALIDATION_EVALUATION',
  'CURRENT_PLAN_PREPARATION',
  'CURRENT_WRITE_PREPARATION',
]);
const PREPARATION_YDB_TRANSPORT_ERROR_CODES = new Set([
  'SDK_SHAPE_INVALID',
  'PARAMETER_VALUE_INVALID',
  'PARAMETER_TYPE_UNSUPPORTED',
  'TIMESTAMP_PRECISION_UNSUPPORTED',
  'QUERY_EXECUTION_FAILED',
  'QUERY_EXECUTION_YDB_BAD_REQUEST',
  'QUERY_EXECUTION_YDB_UNAUTHORIZED',
  'QUERY_EXECUTION_YDB_INTERNAL_ERROR',
  'QUERY_EXECUTION_YDB_ABORTED',
  'QUERY_EXECUTION_YDB_UNAVAILABLE',
  'QUERY_EXECUTION_YDB_OVERLOADED',
  'QUERY_EXECUTION_YDB_SCHEME_ERROR',
  'QUERY_EXECUTION_YDB_GENERIC_ERROR',
  'QUERY_EXECUTION_YDB_TIMEOUT',
  'QUERY_EXECUTION_YDB_BAD_SESSION',
  'QUERY_EXECUTION_YDB_PRECONDITION_FAILED',
  'QUERY_EXECUTION_YDB_ALREADY_EXISTS',
  'QUERY_EXECUTION_YDB_NOT_FOUND',
  'QUERY_EXECUTION_YDB_SESSION_EXPIRED',
  'QUERY_EXECUTION_YDB_CANCELLED',
  'QUERY_EXECUTION_YDB_UNDETERMINED',
  'QUERY_EXECUTION_YDB_UNSUPPORTED',
  'QUERY_EXECUTION_YDB_SESSION_BUSY',
  'QUERY_EXECUTION_YDB_EXTERNAL_ERROR',
  'CLIENT_CONFIG_INVALID',
]);
const PREPARATION_DURABLE_RECONCILIATION_ERROR_CODES = new Set([
  'DURABLE_REVISION_EVIDENCE_INCOMPLETE',
  'DURABLE_RAW_PAYLOAD_INVALID',
  'EXPECTED_RECONCILIATION_NOT_AVAILABLE',
  'INVALID_EXPECTED_REVISION',
  'MIXED_EXPECTED_RUN',
  'MALFORMED_EXISTING_REVISION',
  'DUPLICATE_EXISTING_REVISION',
  'EXTRA_EXISTING_REVISION',
  'EXISTING_REVISION_MISMATCH',
  'UNSUPPORTED_TRANSACTION_TYPE',
  'INVALID_TRANSACTION_SHAPE',
  'INVALID_TRANSACTION_AMOUNT',
  'INVALID_SOURCE_CLASSIFICATION',
]);

const SWAP_RECOVERY_REASONS = new Set<InitialControlledRebuildSwapRecoveryReason>([
  'DURABLE_RUN_NOT_VALIDATED',
  'SETUP_EVIDENCE_MISMATCH',
  'STAGING_RECONCILIATION_MISMATCH',
  'SWAP_DISCRIMINATION_AMBIGUOUS',
]);

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
  bootstrapPhase: InitialBootstrapApplicationPhase | null = null,
): Readonly<YandexInitialControlledRebuildRuntimeFailure> {
  return Object.freeze({
    status: 'FAIL' as const,
    code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED' as const,
    jobCode,
    phase,
    bootstrapPhase,
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

function sanitizePreparationDiagnosticResult(
  value: unknown,
): Readonly<YandexInitialControlledRebuildPreparationDiagnosticFunctionResult> {
  const result = record(value);
  if (result === null || typeof result.status !== 'string') return runtimeFailure('UNCAUGHT');

  if (result.status === 'READY') {
    return Object.freeze({
      status: 'PASS' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_READY' as const,
    });
  }
  if (result.status === 'BASELINE_EXISTS') {
    return Object.freeze({
      status: 'NOOP' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_BASELINE_EXISTS' as const,
    });
  }
  if (result.status === 'VALIDATION_BLOCKED') {
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_VALIDATION_BLOCKED' as const,
    });
  }
  if (result.status !== 'FAILED') return runtimeFailure('UNCAUGHT');

  const bootstrapPhase = result.bootstrapPhase === null
    ? null
    : (
        typeof result.bootstrapPhase === 'string'
        && PREPARATION_BOOTSTRAP_PHASES.has(result.bootstrapPhase as InitialBootstrapApplicationPhase)
          ? result.bootstrapPhase as InitialBootstrapApplicationPhase
          : undefined
      );
  if (bootstrapPhase === undefined || typeof result.category !== 'string') {
    return runtimeFailure('UNCAUGHT');
  }

  if (
    result.category === 'YDB_TRANSPORT'
    && typeof result.errorCode === 'string'
    && PREPARATION_YDB_TRANSPORT_ERROR_CODES.has(result.errorCode)
  ) {
    return Object.freeze({
      status: 'FAIL' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_FAILED' as const,
      category: 'YDB_TRANSPORT' as const,
      errorCode: result.errorCode,
      bootstrapPhase,
    });
  }
  if (
    result.category === 'DURABLE_RECONCILIATION'
    && typeof result.errorCode === 'string'
    && PREPARATION_DURABLE_RECONCILIATION_ERROR_CODES.has(result.errorCode)
  ) {
    return Object.freeze({
      status: 'FAIL' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_FAILED' as const,
      category: 'DURABLE_RECONCILIATION' as const,
      errorCode: result.errorCode,
      bootstrapPhase,
    });
  }
  if (result.category === 'UNKNOWN' && result.errorCode === null) {
    return Object.freeze({
      status: 'FAIL' as const,
      code: 'INITIAL_CONTROLLED_REBUILD_PREPARATION_FAILED' as const,
      category: 'UNKNOWN' as const,
      errorCode: null,
      bootstrapPhase,
    });
  }
  return runtimeFailure('UNCAUGHT');
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
      if (
        typeof result.reason !== 'string'
        || !SWAP_RECOVERY_REASONS.has(result.reason as InitialControlledRebuildSwapRecoveryReason)
      ) return runtimeFailure('UNCAUGHT');
      return Object.freeze({
        status: 'STOP' as const,
        code: 'INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED' as const,
        verdict: 'RECOVERY_REQUIRED' as const,
        recoveryReason: result.reason as InitialControlledRebuildSwapRecoveryReason,
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
    if (error instanceof InitialControlledRebuildJobError) {
      return runtimeFailure(error.code, error.phase, error.bootstrapPhase);
    }
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

export async function executeYandexInitialControlledRebuildPreparationDiagnosticFunction(
  environment: InitialBootstrapJobEnvironment,
  runJob: YandexInitialControlledRebuildJob,
): Promise<Readonly<YandexInitialControlledRebuildPreparationDiagnosticFunctionResult>> {
  try {
    return sanitizePreparationDiagnosticResult(await runJob(environment));
  } catch (error) {
    if (error instanceof InitialControlledRebuildJobError) {
      return runtimeFailure(error.code, error.phase, error.bootstrapPhase);
    }
    if (error instanceof InitialBootstrapPrivateEvidenceError || error instanceof InitialBootstrapJobError) {
      return runtimeFailure('CONFIG_INVALID');
    }
    return runtimeFailure('UNCAUGHT');
  }
}

export async function initialControlledRebuildPreparationDiagnosticHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexInitialControlledRebuildPreparationDiagnosticFunctionResult>> {
  const observer = yandexPhaseObserver();
  return executeYandexInitialControlledRebuildPreparationDiagnosticFunction(
    process.env,
    (environment) => runInitialControlledRebuildPreparationDiagnosticJobFromEnvironment(environment, observer),
  );
}

export async function executeYandexInitialControlledRebuildSwapRecoveryDiagnosticFunction(
  environment: InitialBootstrapJobEnvironment,
  runJob: YandexInitialControlledRebuildJob,
): Promise<Readonly<YandexInitialControlledRebuildSwapRecoveryDiagnosticFunctionResult>> {
  try {
    return sanitizeSwapRecoveryDiagnosticResult(await runJob(environment));
  } catch (error) {
    if (error instanceof InitialControlledRebuildJobError) {
      return runtimeFailure(error.code, error.phase, error.bootstrapPhase);
    }
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
