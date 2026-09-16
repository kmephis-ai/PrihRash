import type { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
} from './initialBootstrapStaleStagingRetirementDiagnostic.js';
import {
  diagnoseInitialBootstrapStagingRevisionEvidence,
  type InitialBootstrapStagingRevisionDiagnostic,
} from './initialBootstrapStagingRevisionDiagnostic.js';
import {
  prepareMigrationRunFailedWrite,
} from './migrationRunPersistence.js';
import { executeMigrationRunLifecycleWrite } from './migrationRunLifecycleExecutor.js';
import {
  markMigrationRunFailed,
  type MigrationRun,
} from './migrationRunState.js';
import { readScheduledSyncAdmissionEvidence } from './scheduledSyncAdmissionEvidence.js';

export const INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE =
  'INITIAL_BOOTSTRAP_STALE_AUTHORITATIVE_SNAPSHOT';

export type InitialBootstrapStaleStagingRetirementErrorCode =
  | 'INVALID_AUTHORITATIVE_SNAPSHOT_DIGEST'
  | 'INVALID_FINISHED_AT'
  | 'COMMITTED_BASELINE_EXISTS'
  | 'STAGING_RUN_NOT_UNIQUE'
  | 'STALE_SNAPSHOT_NOT_PROVEN'
  | 'VERIFIED_CURRENT_STATE_NOT_EMPTY';

export class InitialBootstrapStaleStagingRetirementError extends Error {
  readonly code: InitialBootstrapStaleStagingRetirementErrorCode;
  readonly diagnostic: InitialBootstrapStagingRevisionDiagnostic | null;

  constructor(
    code: InitialBootstrapStaleStagingRetirementErrorCode,
    diagnostic: InitialBootstrapStagingRevisionDiagnostic | null = null,
  ) {
    super(code);
    this.name = 'InitialBootstrapStaleStagingRetirementError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function requiredExactText(
  value: string,
  code: 'INVALID_AUTHORITATIVE_SNAPSHOT_DIGEST' | 'INVALID_FINISHED_AT',
): string {
  if (value.length === 0 || value !== value.trim()) {
    throw new InitialBootstrapStaleStagingRetirementError(code);
  }
  return value;
}

async function assertVerifiedCurrentStateEmpty(adapter: YdbAdapter): Promise<void> {
  const diagnostic = await adapter.serializableReadWrite((transaction) =>
    diagnoseInitialBootstrapStaleStagingRetirementCurrentState(transaction));
  if (diagnostic !== 'STALE_STAGING_CURRENT_STATE_EMPTY') {
    throw new InitialBootstrapStaleStagingRetirementError('VERIFIED_CURRENT_STATE_NOT_EMPTY');
  }
}

export async function retireInitialBootstrapStaleStagingRun(
  adapter: YdbAdapter,
  authoritativeSnapshotDigest: string,
  finishedAt: string,
): Promise<Readonly<MigrationRun>> {
  const freshDigest = requiredExactText(
    authoritativeSnapshotDigest,
    'INVALID_AUTHORITATIVE_SNAPSHOT_DIGEST',
  );
  const failureAt = requiredExactText(finishedAt, 'INVALID_FINISHED_AT');

  const admission = await readScheduledSyncAdmissionEvidence(adapter);
  if (admission.committedBaselineRun !== null) {
    throw new InitialBootstrapStaleStagingRetirementError('COMMITTED_BASELINE_EXISTS');
  }
  if (admission.incompleteRuns.length !== 1 || admission.incompleteRuns[0]?.state !== 'STAGING') {
    throw new InitialBootstrapStaleStagingRetirementError('STAGING_RUN_NOT_UNIQUE');
  }
  const stagingRun = admission.incompleteRuns[0];
  if (stagingRun === undefined) {
    throw new InitialBootstrapStaleStagingRetirementError('STAGING_RUN_NOT_UNIQUE');
  }

  // For a proven snapshot-digest mismatch the staging diagnostic stops before row-level
  // binding/revision comparison. Empty observations therefore cannot authorize retirement;
  // only the exact AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH enum can cross this gate.
  const diagnostic = await diagnoseInitialBootstrapStagingRevisionEvidence(adapter, freshDigest, []);
  if (diagnostic !== 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH') {
    throw new InitialBootstrapStaleStagingRetirementError('STALE_SNAPSHOT_NOT_PROVEN', diagnostic);
  }

  await assertVerifiedCurrentStateEmpty(adapter);

  const failedRun = markMigrationRunFailed(
    stagingRun,
    failureAt,
    INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE,
  );
  const prepared = prepareMigrationRunFailedWrite(stagingRun, failedRun);
  return executeMigrationRunLifecycleWrite(adapter, prepared, failedRun);
}
