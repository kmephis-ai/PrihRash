import type { ControlledInitialRebuildPlan } from './initialControlledRebuild.js';

export interface InitialControlledRebuildSetupEvidence {
  readonly currentTransactionCount: number;
  readonly currentSourceRecordCount: number;
  readonly stagingDirectoryExists: boolean;
  readonly stagingTransactionsExists: boolean;
  readonly stagingSourceRecordsExists: boolean;
}

export interface ControlledRebuildCopyItem {
  readonly source: 'transactions' | 'source_records';
  readonly destination: string;
}

export interface InitialControlledRebuildSetupPlan {
  readonly stagingDirectory: string;
  readonly createDirectory: boolean;
  readonly copyItems: readonly Readonly<ControlledRebuildCopyItem>[];
}

export type InitialControlledRebuildSetupErrorCode =
  | 'INVALID_CURRENT_COUNT_EVIDENCE'
  | 'CURRENT_STATE_NOT_EMPTY'
  | 'STAGING_TABLE_ALREADY_EXISTS'
  | 'INVALID_CONTROLLED_REBUILD_PATHS';

export class InitialControlledRebuildSetupError extends Error {
  readonly code: InitialControlledRebuildSetupErrorCode;

  constructor(code: InitialControlledRebuildSetupErrorCode) {
    super(code);
    this.name = 'InitialControlledRebuildSetupError';
    this.code = code;
  }
}

const RUN_DIRECTORY_PATTERN = /^rebuild\/r_[0-9a-f]{32}$/;

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function runDirectory(plan: Readonly<ControlledInitialRebuildPlan>): string {
  const suffix = '/transactions';
  if (!plan.stagingTables.transactions.endsWith(suffix)) {
    throw new InitialControlledRebuildSetupError('INVALID_CONTROLLED_REBUILD_PATHS');
  }
  const directory = plan.stagingTables.transactions.slice(0, -suffix.length);
  if (
    !RUN_DIRECTORY_PATTERN.test(directory)
    || plan.stagingTables.sourceRecords !== `${directory}/source_records`
  ) {
    throw new InitialControlledRebuildSetupError('INVALID_CONTROLLED_REBUILD_PATHS');
  }
  return directory;
}

export function planInitialControlledRebuildSetup(
  controlled: Readonly<ControlledInitialRebuildPlan>,
  evidence: Readonly<InitialControlledRebuildSetupEvidence>,
): Readonly<InitialControlledRebuildSetupPlan> {
  if (!safeCount(evidence.currentTransactionCount) || !safeCount(evidence.currentSourceRecordCount)) {
    throw new InitialControlledRebuildSetupError('INVALID_CURRENT_COUNT_EVIDENCE');
  }
  if (evidence.currentTransactionCount !== 0 || evidence.currentSourceRecordCount !== 0) {
    throw new InitialControlledRebuildSetupError('CURRENT_STATE_NOT_EMPTY');
  }
  if (evidence.stagingTransactionsExists || evidence.stagingSourceRecordsExists) {
    throw new InitialControlledRebuildSetupError('STAGING_TABLE_ALREADY_EXISTS');
  }

  const directory = runDirectory(controlled);
  return Object.freeze({
    stagingDirectory: directory,
    createDirectory: !evidence.stagingDirectoryExists,
    copyItems: Object.freeze([
      Object.freeze({ source: 'transactions' as const, destination: controlled.stagingTables.transactions }),
      Object.freeze({ source: 'source_records' as const, destination: controlled.stagingTables.sourceRecords }),
    ]),
  });
}
