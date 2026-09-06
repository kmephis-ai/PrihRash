import {
  assessAtomicPromotionWrites,
  type PromotionWrite,
} from './atomicPromotion.js';
import type { PreparedInitialVerifiedCurrentWrite } from './initialVerifiedCurrentPersistence.js';
import type { MigrationRun } from './migrationRunState.js';
import { planInitialBootstrapPromotion } from './initialBootstrapPromotionRoute.js';

export interface ControlledInitialRebuildTablePaths {
  readonly transactions: string;
  readonly sourceRecords: string;
}

export interface ControlledInitialRebuildReplacement {
  readonly source: string;
  readonly destination: 'transactions' | 'source_records';
  readonly replace: true;
}

export interface ControlledInitialRebuildBatch {
  readonly index: number;
  readonly writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[];
  readonly estimatedParameterBytes: number;
}

export interface ControlledInitialRebuildPlan {
  readonly runId: string;
  readonly stagingTables: Readonly<ControlledInitialRebuildTablePaths>;
  readonly batches: readonly Readonly<ControlledInitialRebuildBatch>[];
  readonly replacements: readonly Readonly<ControlledInitialRebuildReplacement>[];
  readonly expectedSourceRecordCount: number;
  readonly expectedTransactionCount: number;
}

export type ControlledInitialRebuildErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'PREVIOUS_VERIFIED_SHADOW_PRESENT'
  | 'ORDINARY_ATOMIC_ROUTE_ELIGIBLE'
  | 'NO_CURRENT_WRITES'
  | 'STAGING_WRITE_TOO_LARGE';

export class ControlledInitialRebuildError extends Error {
  readonly code: ControlledInitialRebuildErrorCode;

  constructor(code: ControlledInitialRebuildErrorCode) {
    super(code);
    this.name = 'ControlledInitialRebuildError';
    this.code = code;
  }
}

function stagingPaths(runId: string): Readonly<ControlledInitialRebuildTablePaths> {
  const compactRunId = runId.toLowerCase().replaceAll('-', '');
  return Object.freeze({
    transactions: `rebuild/r_${compactRunId}/transactions`,
    sourceRecords: `rebuild/r_${compactRunId}/source_records`,
  });
}

function toPromotionWrite(write: Readonly<PreparedInitialVerifiedCurrentWrite>): PromotionWrite {
  return Object.freeze({
    statement: write.statement,
    estimatedParameterBytes: write.estimatedParameterBytes,
  });
}

function chunkStagingWrites(
  writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[],
): readonly Readonly<ControlledInitialRebuildBatch>[] {
  const batches: Readonly<ControlledInitialRebuildBatch>[] = [];
  let current: Readonly<PreparedInitialVerifiedCurrentWrite>[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const assessment = assessAtomicPromotionWrites(current.map(toPromotionWrite));
    if (!assessment.eligible) {
      throw new ControlledInitialRebuildError('STAGING_WRITE_TOO_LARGE');
    }
    batches.push(Object.freeze({
      index: batches.length,
      writes: Object.freeze([...current]),
      estimatedParameterBytes: assessment.totalEstimatedParameterBytes,
    }));
    current = [];
  };

  for (const write of writes) {
    const singleAssessment = assessAtomicPromotionWrites([toPromotionWrite(write)]);
    if (!singleAssessment.eligible) {
      throw new ControlledInitialRebuildError('STAGING_WRITE_TOO_LARGE');
    }

    const candidate = [...current, write];
    const candidateAssessment = assessAtomicPromotionWrites(candidate.map(toPromotionWrite));
    if (!candidateAssessment.eligible) {
      flush();
      current = [write];
    } else {
      current = candidate;
    }
  }
  flush();

  return Object.freeze(batches);
}

export function planControlledInitialRebuild(
  run: Readonly<MigrationRun>,
  writes: readonly Readonly<PreparedInitialVerifiedCurrentWrite>[],
  previousVerifiedRunId: string | null,
): Readonly<ControlledInitialRebuildPlan> {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new ControlledInitialRebuildError('RUN_NOT_VALIDATED');
  }
  if (previousVerifiedRunId !== null) {
    throw new ControlledInitialRebuildError('PREVIOUS_VERIFIED_SHADOW_PRESENT');
  }
  if (writes.length === 0) {
    throw new ControlledInitialRebuildError('NO_CURRENT_WRITES');
  }

  const route = planInitialBootstrapPromotion(writes.map(toPromotionWrite));
  if (route.route !== 'CONTROLLED_REBUILD_REQUIRED') {
    throw new ControlledInitialRebuildError('ORDINARY_ATOMIC_ROUTE_ELIGIBLE');
  }

  const tables = stagingPaths(run.id);
  const expectedSourceRecordCount = writes.filter((write) => write.role === 'SOURCE_RECORD').length;
  const expectedTransactionCount = writes.filter((write) => write.role === 'TRANSACTION').length;

  return Object.freeze({
    runId: run.id.toLowerCase(),
    stagingTables: tables,
    batches: chunkStagingWrites(writes),
    replacements: Object.freeze([
      Object.freeze({ source: tables.transactions, destination: 'transactions' as const, replace: true as const }),
      Object.freeze({ source: tables.sourceRecords, destination: 'source_records' as const, replace: true as const }),
    ]),
    expectedSourceRecordCount,
    expectedTransactionCount,
  });
}
