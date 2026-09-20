import type { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
} from './initialBootstrapStaleStagingRetirementDiagnostic.js';
import {
  executeMigrationRunLifecycleWriteInTransaction,
  migrationRunLifecycleReadBack,
  migrationRunLifecycleRowMatches,
  type MigrationRunLifecycleReadRow,
} from './migrationRunLifecycleExecutor.js';
import { prepareMigrationRunFailedWrite } from './migrationRunPersistence.js';
import { markMigrationRunFailed, type MigrationRun } from './migrationRunState.js';
import {
  parseScheduledSyncAdmissionEvidence,
  scheduledSyncAdmissionEvidenceStatement,
  type MigrationRunEvidenceRow,
} from './scheduledSyncAdmissionEvidence.js';

export const INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE =
  'INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT';

export type InitialBootstrapStaleValidatedTerminalizationErrorCode =
  | 'INVALID_FINISHED_AT'
  | 'COMMITTED_BASELINE_EXISTS'
  | 'VALIDATED_RUN_NOT_UNIQUE'
  | 'VERIFIED_CURRENT_STATE_NOT_EMPTY';

export class InitialBootstrapStaleValidatedTerminalizationError extends Error {
  readonly code: InitialBootstrapStaleValidatedTerminalizationErrorCode;

  constructor(code: InitialBootstrapStaleValidatedTerminalizationErrorCode) {
    super(code);
    this.name = 'InitialBootstrapStaleValidatedTerminalizationError';
    this.code = code;
  }
}

function requiredFinishedAt(value: string): string {
  if (value.length === 0 || value !== value.trim()) {
    throw new InitialBootstrapStaleValidatedTerminalizationError('INVALID_FINISHED_AT');
  }
  return value;
}

export async function terminalizeInitialBootstrapStaleValidatedRun(
  adapter: YdbAdapter,
  finishedAt: string,
): Promise<Readonly<MigrationRun>> {
  const failureAt = requiredFinishedAt(finishedAt);

  return adapter.serializableReadWrite(async (transaction) => {
    const admissionRows = await transaction.read<MigrationRunEvidenceRow>(
      scheduledSyncAdmissionEvidenceStatement(),
    );
    const admission = parseScheduledSyncAdmissionEvidence(admissionRows.rows);
    if (admission.committedBaselineRun !== null) {
      throw new InitialBootstrapStaleValidatedTerminalizationError('COMMITTED_BASELINE_EXISTS');
    }
    if (admission.incompleteRuns.length !== 1 || admission.incompleteRuns[0]?.state !== 'VALIDATED') {
      throw new InitialBootstrapStaleValidatedTerminalizationError('VALIDATED_RUN_NOT_UNIQUE');
    }
    const validatedRun = admission.incompleteRuns[0];
    if (validatedRun === undefined) {
      throw new InitialBootstrapStaleValidatedTerminalizationError('VALIDATED_RUN_NOT_UNIQUE');
    }

    const currentState = await diagnoseInitialBootstrapStaleStagingRetirementCurrentState(transaction);
    if (currentState !== 'STALE_STAGING_CURRENT_STATE_EMPTY') {
      throw new InitialBootstrapStaleValidatedTerminalizationError('VERIFIED_CURRENT_STATE_NOT_EMPTY');
    }

    const failedRun = markMigrationRunFailed(
      validatedRun,
      failureAt,
      INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE,
    );
    const prepared = prepareMigrationRunFailedWrite(validatedRun, failedRun);
    return executeMigrationRunLifecycleWriteInTransaction(transaction, prepared, failedRun);
  });
}


export type InitialBootstrapStaleValidatedTerminalizationRecoveryReason =
  | 'EXACT_FAILED_MARKER'
  | 'UNCHANGED_VALIDATED_NO_RETRY'
  | 'TERMINAL_ROW_MISSING'
  | 'TERMINAL_ROW_AMBIGUOUS'
  | 'TERMINAL_ROW_MISMATCH'
  | 'VERIFIED_CURRENT_STATE_NOT_EMPTY'
  | 'CURRENT_STATE_DIAGNOSTIC_FAILED'
  | 'READ_FAILED';

export type InitialBootstrapStaleValidatedTerminalizationRecoveryResult =
  | Readonly<{ verdict: 'APPLIED'; reason: 'EXACT_FAILED_MARKER' }>
  | Readonly<{
      verdict: 'RECOVERY_REQUIRED';
      reason: Exclude<InitialBootstrapStaleValidatedTerminalizationRecoveryReason, 'EXACT_FAILED_MARKER'>;
    }>;

export async function diagnoseInitialBootstrapStaleValidatedTerminalizationOutcome(
  adapter: YdbAdapter,
  validatedRun: Readonly<MigrationRun>,
  finishedAt: string,
): Promise<InitialBootstrapStaleValidatedTerminalizationRecoveryResult> {
  const failureAt = requiredFinishedAt(finishedAt);
  if (
    validatedRun.state !== 'VALIDATED'
    || validatedRun.finishedAt !== null
    || validatedRun.errorCode !== null
  ) {
    return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason: 'TERMINAL_ROW_MISMATCH' as const });
  }
  const expectedFailed = markMigrationRunFailed(
    validatedRun,
    failureAt,
    INITIAL_BOOTSTRAP_STALE_VALIDATED_FAILURE_CODE,
  );

  let rows: readonly MigrationRunLifecycleReadRow[];
  try {
    const result = await adapter.read<MigrationRunLifecycleReadRow>(
      migrationRunLifecycleReadBack(validatedRun),
    );
    rows = result.rows;
  } catch {
    return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason: 'READ_FAILED' as const });
  }

  if (rows.length === 0) {
    return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason: 'TERMINAL_ROW_MISSING' as const });
  }
  if (rows.length !== 1) {
    return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason: 'TERMINAL_ROW_AMBIGUOUS' as const });
  }
  const row = rows[0];
  if (row === undefined) {
    return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason: 'TERMINAL_ROW_MISSING' as const });
  }

  if (migrationRunLifecycleRowMatches(row, expectedFailed)) {
    try {
      const currentState = await diagnoseInitialBootstrapStaleStagingRetirementCurrentState(adapter);
      if (currentState === 'STALE_STAGING_CURRENT_STATE_EMPTY') {
        return Object.freeze({ verdict: 'APPLIED' as const, reason: 'EXACT_FAILED_MARKER' as const });
      }
      if (currentState === 'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED') {
        return Object.freeze({
          verdict: 'RECOVERY_REQUIRED' as const,
          reason: 'CURRENT_STATE_DIAGNOSTIC_FAILED' as const,
        });
      }
      return Object.freeze({
        verdict: 'RECOVERY_REQUIRED' as const,
        reason: 'VERIFIED_CURRENT_STATE_NOT_EMPTY' as const,
      });
    } catch {
      return Object.freeze({
        verdict: 'RECOVERY_REQUIRED' as const,
        reason: 'CURRENT_STATE_DIAGNOSTIC_FAILED' as const,
      });
    }
  }

  if (migrationRunLifecycleRowMatches(row, validatedRun)) {
    return Object.freeze({
      verdict: 'RECOVERY_REQUIRED' as const,
      reason: 'UNCHANGED_VALIDATED_NO_RETRY' as const,
    });
  }

  return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason: 'TERMINAL_ROW_MISMATCH' as const });
}
