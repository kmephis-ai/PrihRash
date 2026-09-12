import type {
  InitialBootstrapRecoveryReason,
} from '../migration/initialBootstrapApplication.js';
import {
  InitialBootstrapPrivateEvidenceError,
} from '../migration/initialBootstrapPrivateEvidence.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  type InitialReconciliationCheck,
  type InitialValidationBlockerCode,
} from '../migration/initialValidationGate.js';
import {
  runInitialBootstrapReferenceAwareJobFromEnvironment,
} from './initialBootstrapReferenceAwareJob.js';
import {
  InitialBootstrapJobError,
  type InitialBootstrapJobEnvironment,
} from './initialBootstrapJob.js';

export type YandexInitialBootstrapFunctionCode =
  | 'INITIAL_BOOTSTRAP_COMMITTED'
  | 'INITIAL_BOOTSTRAP_BASELINE_EXISTS'
  | 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED'
  | 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED'
  | 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED'
  | 'INITIAL_BOOTSTRAP_CONFIG_INVALID'
  | 'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED'
  | 'INITIAL_BOOTSTRAP_RESULT_INVALID'
  | 'INITIAL_BOOTSTRAP_RUNTIME_FAILED';

export interface YandexInitialBootstrapValidationBlocker {
  readonly code: InitialValidationBlockerCode;
  readonly check?: InitialReconciliationCheck;
}

export type YandexInitialBootstrapFunctionResult =
  | Readonly<{
      status: 'PASS';
      code: 'INITIAL_BOOTSTRAP_COMMITTED';
    }>
  | Readonly<{
      status: 'NOOP';
      code: 'INITIAL_BOOTSTRAP_BASELINE_EXISTS';
    }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED';
      blockers: readonly Readonly<YandexInitialBootstrapValidationBlocker>[];
    }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED';
    }>
  | Readonly<{
      status: 'STOP';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED';
      recoveryReason: InitialBootstrapRecoveryReason;
    }>
  | Readonly<{
      status: 'FAIL';
      code:
        | 'INITIAL_BOOTSTRAP_CONFIG_INVALID'
        | 'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED'
        | 'INITIAL_BOOTSTRAP_RESULT_INVALID'
        | 'INITIAL_BOOTSTRAP_RUNTIME_FAILED';
    }>;

export interface YandexInitialBootstrapJob {
  (environment: InitialBootstrapJobEnvironment): Promise<unknown>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

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

const RECOVERY_REASONS = new Set<InitialBootstrapRecoveryReason>([
  'CLAIM_OUTCOME_UNKNOWN',
  'REVISION_EVIDENCE_OUTCOME_UNKNOWN',
  'COUNTER_REFINEMENT_OUTCOME_UNKNOWN',
  'VALIDATION_TRANSITION_OUTCOME_UNKNOWN',
  'PROMOTION_OUTCOME_UNKNOWN',
  'VALIDATED_RUN_REQUIRES_RECOVERY',
]);

const RECONCILIATION_CHECKS = new Set<InitialReconciliationCheck>(INITIAL_RECONCILIATION_CHECKS);

function record(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function failure(
  code:
    | 'INITIAL_BOOTSTRAP_CONFIG_INVALID'
    | 'INITIAL_BOOTSTRAP_RECONCILIATION_FAILED'
    | 'INITIAL_BOOTSTRAP_RESULT_INVALID'
    | 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
): Readonly<YandexInitialBootstrapFunctionResult> {
  return Object.freeze({ status: 'FAIL' as const, code });
}

function validationBlocker(value: unknown): Readonly<YandexInitialBootstrapValidationBlocker> | null {
  const object = record(value);
  if (
    object === null
    || typeof object.code !== 'string'
    || !VALIDATION_BLOCKER_CODES.has(object.code as InitialValidationBlockerCode)
  ) {
    return null;
  }
  const code = object.code as InitialValidationBlockerCode;
  if (code === 'RECONCILIATION_CHECK_NOT_MATCHED') {
    if (
      typeof object.check !== 'string'
      || !RECONCILIATION_CHECKS.has(object.check as InitialReconciliationCheck)
    ) {
      return null;
    }
    return Object.freeze({ code, check: object.check as InitialReconciliationCheck });
  }
  if (object.check !== undefined) return null;
  return Object.freeze({ code });
}

function validationBlockers(value: unknown): readonly Readonly<YandexInitialBootstrapValidationBlocker>[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return null;
  const blockers: Readonly<YandexInitialBootstrapValidationBlocker>[] = [];
  for (const entry of value) {
    const blocker = validationBlocker(entry);
    if (blocker === null) return null;
    blockers.push(blocker);
  }
  return Object.freeze(blockers);
}

function sanitizeApplicationResult(value: unknown): Readonly<YandexInitialBootstrapFunctionResult> {
  const result = record(value);
  if (result === null || typeof result.status !== 'string') {
    return failure('INITIAL_BOOTSTRAP_RESULT_INVALID');
  }

  if (result.status === 'COMMITTED') {
    return Object.freeze({
      status: 'PASS' as const,
      code: 'INITIAL_BOOTSTRAP_COMMITTED' as const,
    });
  }
  if (result.status === 'BASELINE_EXISTS') {
    return Object.freeze({
      status: 'NOOP' as const,
      code: 'INITIAL_BOOTSTRAP_BASELINE_EXISTS' as const,
    });
  }
  if (result.status === 'CONTROLLED_REBUILD_REQUIRED') {
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED' as const,
    });
  }
  if (result.status === 'RECOVERY_REQUIRED') {
    if (
      typeof result.reason !== 'string'
      || !RECOVERY_REASONS.has(result.reason as InitialBootstrapRecoveryReason)
    ) {
      return failure('INITIAL_BOOTSTRAP_RESULT_INVALID');
    }
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_BOOTSTRAP_RECOVERY_REQUIRED' as const,
      recoveryReason: result.reason as InitialBootstrapRecoveryReason,
    });
  }
  if (result.status === 'VALIDATION_BLOCKED') {
    const blockers = validationBlockers(result.blockers);
    if (blockers === null) return failure('INITIAL_BOOTSTRAP_RESULT_INVALID');
    return Object.freeze({
      status: 'STOP' as const,
      code: 'INITIAL_BOOTSTRAP_VALIDATION_BLOCKED' as const,
      blockers,
    });
  }
  return failure('INITIAL_BOOTSTRAP_RESULT_INVALID');
}

function isConfigError(code: InitialBootstrapJobError['code']): boolean {
  return code === 'INVALID_SPREADSHEET_ID'
    || code === 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'
    || code === 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
    || code === 'INVALID_YDB_CONNECTION_STRING'
    || code === 'INVALID_PRIVATE_HISTORICAL_EVIDENCE';
}

export async function executeYandexInitialBootstrapFunction(
  environment: InitialBootstrapJobEnvironment,
  runJob: YandexInitialBootstrapJob,
): Promise<Readonly<YandexInitialBootstrapFunctionResult>> {
  try {
    return sanitizeApplicationResult(await runJob(environment));
  } catch (error) {
    if (error instanceof InitialBootstrapPrivateEvidenceError) {
      return failure('INITIAL_BOOTSTRAP_CONFIG_INVALID');
    }
    if (error instanceof InitialBootstrapJobError) {
      if (isConfigError(error.code)) return failure('INITIAL_BOOTSTRAP_CONFIG_INVALID');
      if (error.code === 'COMMITTED_RECONCILIATION_MISMATCH') {
        return failure('INITIAL_BOOTSTRAP_RECONCILIATION_FAILED');
      }
      return failure('INITIAL_BOOTSTRAP_RUNTIME_FAILED');
    }
    return failure('INITIAL_BOOTSTRAP_RUNTIME_FAILED');
  }
}

export async function initialBootstrapHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexInitialBootstrapFunctionResult>> {
  return executeYandexInitialBootstrapFunction(
    process.env,
    runInitialBootstrapReferenceAwareJobFromEnvironment,
  );
}
