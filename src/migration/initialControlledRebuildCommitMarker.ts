import {
  readStatement,
  YdbAdapter,
  writeStatement,
  type YdbQueryResult,
  type YdbTransaction,
} from '../integration/ydb/adapter.js';
import {
  timestampParameter,
  utf8Parameter,
  uuidParameter,
} from '../integration/ydb/parameters.js';
import { YdbSchemeAdapter } from '../integration/ydb/scheme.js';
import { recoverUnknownControlledInitialSwapOutcome } from './initialControlledRebuildSchemeRecovery.js';
import type { ControlledInitialSwapPlan } from './initialControlledRebuildSwapGate.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';
import {
  markMigrationRunCommitted,
  type MigrationRun,
} from './migrationRunState.js';

export type ControlledInitialCommitMarkerErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'POST_SWAP_VERIFICATION_NOT_MATCHED'
  | 'MARKER_TRANSITION_CONFLICT'
  | 'MALFORMED_MARKER_ROW';

export class ControlledInitialCommitMarkerError extends Error {
  readonly code: ControlledInitialCommitMarkerErrorCode;

  constructor(code: ControlledInitialCommitMarkerErrorCode) {
    super(code);
    this.name = 'ControlledInitialCommitMarkerError';
    this.code = code;
  }
}

interface MigrationRunMarkerRow {
  readonly state?: unknown;
  readonly finished_at?: unknown;
  readonly error_code?: unknown;
}

export type ControlledInitialCommitRecovery =
  | Readonly<{ status: 'COMMITTED' }>
  | Readonly<{ status: 'SWAP_APPLIED_MARKER_PENDING' }>
  | Readonly<{ status: 'RECOVERY_REQUIRED' }>;

function sameRun(runId: string, swapPlan: Readonly<ControlledInitialSwapPlan>): boolean {
  return swapPlan.runId.toLowerCase() === runId.toLowerCase();
}

async function exactPostSwapApplied(
  scheme: YdbSchemeAdapter,
  adapter: YdbAdapter,
  runId: string,
  swapPlan: Readonly<ControlledInitialSwapPlan>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
): Promise<boolean> {
  if (!sameRun(runId, swapPlan)) return false;
  try {
    return (await recoverUnknownControlledInitialSwapOutcome(
      scheme,
      adapter,
      swapPlan,
      verifiedPlan,
    )).verdict === 'APPLIED';
  } catch {
    return false;
  }
}

function markerReadStatement(runId: string) {
  return readStatement(
    'SELECT state, finished_at, error_code FROM migration_runs WHERE id = $id',
    { id: uuidParameter(runId) },
  );
}

function parseSingleRow(result: YdbQueryResult<MigrationRunMarkerRow>): MigrationRunMarkerRow {
  if (result.rows.length !== 1) throw new ControlledInitialCommitMarkerError('MALFORMED_MARKER_ROW');
  const row = result.rows[0];
  if (row === undefined || typeof row.state !== 'string') {
    throw new ControlledInitialCommitMarkerError('MALFORMED_MARKER_ROW');
  }
  if (row.finished_at !== null && typeof row.finished_at !== 'string') {
    throw new ControlledInitialCommitMarkerError('MALFORMED_MARKER_ROW');
  }
  if (row.error_code !== null && typeof row.error_code !== 'string') {
    throw new ControlledInitialCommitMarkerError('MALFORMED_MARKER_ROW');
  }
  return row;
}

async function verifyCommittedInsideTransaction(
  transaction: YdbTransaction,
  runId: string,
  finishedAt: string,
): Promise<void> {
  const row = parseSingleRow(await transaction.execute<MigrationRunMarkerRow>(markerReadStatement(runId)));
  if (row.state !== 'COMMITTED' || row.finished_at !== finishedAt || row.error_code !== null) {
    throw new ControlledInitialCommitMarkerError('MARKER_TRANSITION_CONFLICT');
  }
}

export async function commitControlledInitialRun(
  adapter: YdbAdapter,
  scheme: YdbSchemeAdapter,
  run: Readonly<MigrationRun>,
  swapPlan: Readonly<ControlledInitialSwapPlan>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
  finishedAt: string,
): Promise<Readonly<MigrationRun>> {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new ControlledInitialCommitMarkerError('RUN_NOT_VALIDATED');
  }
  if (!await exactPostSwapApplied(scheme, adapter, run.id, swapPlan, verifiedPlan)) {
    throw new ControlledInitialCommitMarkerError('POST_SWAP_VERIFICATION_NOT_MATCHED');
  }

  const update = writeStatement(
    'UPDATE migration_runs SET state = $state, finished_at = $finished_at, error_code = $error_code '
      + 'WHERE id = $id AND state = $expected_state',
    {
      id: uuidParameter(run.id),
      state: utf8Parameter('COMMITTED'),
      expected_state: utf8Parameter('VALIDATED'),
      finished_at: timestampParameter(finishedAt),
      error_code: utf8Parameter(null),
    },
  );

  await adapter.serializableReadWrite(async (transaction) => {
    await transaction.execute(update);
    await verifyCommittedInsideTransaction(transaction, run.id, finishedAt);
  });

  return markMigrationRunCommitted(run, finishedAt);
}

export async function recoverControlledInitialCommitMarker(
  adapter: YdbAdapter,
  scheme: YdbSchemeAdapter,
  runId: string,
  swapPlan: Readonly<ControlledInitialSwapPlan>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
  expectedFinishedAt: string,
): Promise<ControlledInitialCommitRecovery> {
  timestampParameter(expectedFinishedAt);
  if (!await exactPostSwapApplied(scheme, adapter, runId, swapPlan, verifiedPlan)) {
    return Object.freeze({ status: 'RECOVERY_REQUIRED' as const });
  }

  try {
    const row = parseSingleRow(await adapter.read<MigrationRunMarkerRow>(markerReadStatement(runId)));
    if (row.state === 'COMMITTED') {
      return Object.freeze({
        status: row.finished_at === expectedFinishedAt && row.error_code === null
          ? 'COMMITTED' as const
          : 'RECOVERY_REQUIRED' as const,
      });
    }
    if (row.state === 'VALIDATED' && row.finished_at === null && row.error_code === null) {
      return Object.freeze({ status: 'SWAP_APPLIED_MARKER_PENDING' as const });
    }
    return Object.freeze({ status: 'RECOVERY_REQUIRED' as const });
  } catch {
    return Object.freeze({ status: 'RECOVERY_REQUIRED' as const });
  }
}
