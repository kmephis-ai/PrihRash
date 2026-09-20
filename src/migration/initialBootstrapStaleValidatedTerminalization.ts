import type { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
} from './initialBootstrapStaleStagingRetirementDiagnostic.js';
import {
  executeMigrationRunLifecycleWriteInTransaction,
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
