import { YdbAdapter } from '../integration/ydb/adapter.js';
import { YdbSchemeAdapter, type YdbSchemeDirectoryEntry } from '../integration/ydb/scheme.js';
import type { ControlledInitialRebuildPlan } from './initialControlledRebuild.js';
import { readControlledRebuildCurrentEvidence } from './initialControlledRebuildEvidenceReader.js';
import type { InitialControlledRebuildSetupEvidence } from './initialControlledRebuildSetup.js';

export type InitialControlledRebuildSetupEvidenceErrorCode =
  | 'INVALID_CONTROLLED_REBUILD_PATHS'
  | 'CURRENT_TABLES_MISSING'
  | 'REBUILD_DIRECTORY_INVALID'
  | 'RUN_DIRECTORY_INVALID';

export class InitialControlledRebuildSetupEvidenceError extends Error {
  readonly code: InitialControlledRebuildSetupEvidenceErrorCode;

  constructor(code: InitialControlledRebuildSetupEvidenceErrorCode) {
    super(code);
    this.name = 'InitialControlledRebuildSetupEvidenceError';
    this.code = code;
  }
}

const RUN_DIRECTORY_PATTERN = /^rebuild\/(r_[0-9a-f]{32})$/;

function child(
  children: readonly Readonly<YdbSchemeDirectoryEntry>[],
  name: string,
): Readonly<YdbSchemeDirectoryEntry> | undefined {
  return children.find((entry) => entry.name === name);
}

function requireCanonicalCurrentTables(
  children: readonly Readonly<YdbSchemeDirectoryEntry>[],
): void {
  if (child(children, 'transactions')?.kind !== 'TABLE' || child(children, 'source_records')?.kind !== 'TABLE') {
    throw new InitialControlledRebuildSetupEvidenceError('CURRENT_TABLES_MISSING');
  }
}

function runDirectory(plan: Readonly<ControlledInitialRebuildPlan>): Readonly<{ path: string; leaf: string }> {
  const suffix = '/transactions';
  if (!plan.stagingTables.transactions.endsWith(suffix)) {
    throw new InitialControlledRebuildSetupEvidenceError('INVALID_CONTROLLED_REBUILD_PATHS');
  }
  const path = plan.stagingTables.transactions.slice(0, -suffix.length);
  const match = RUN_DIRECTORY_PATTERN.exec(path);
  if (match === null || plan.stagingTables.sourceRecords !== `${path}/source_records`) {
    throw new InitialControlledRebuildSetupEvidenceError('INVALID_CONTROLLED_REBUILD_PATHS');
  }
  return Object.freeze({ path, leaf: match[1]! });
}

export async function readInitialControlledRebuildSetupEvidence(
  scheme: YdbSchemeAdapter,
  data: YdbAdapter,
  plan: Readonly<ControlledInitialRebuildPlan>,
): Promise<Readonly<InitialControlledRebuildSetupEvidence>> {
  const run = runDirectory(plan);
  const current = await readControlledRebuildCurrentEvidence(data);
  const root = await scheme.listDirectory('');
  requireCanonicalCurrentTables(root.children);

  const rebuildEntry = child(root.children, 'rebuild');
  if (rebuildEntry === undefined) {
    return Object.freeze({
      currentTransactionCount: current.transactionCount,
      currentSourceRecordCount: current.sourceRecordCount,
      rebuildDirectoryExists: false,
      stagingDirectoryExists: false,
      stagingTransactionsExists: false,
      stagingSourceRecordsExists: false,
    });
  }
  if (rebuildEntry.kind !== 'DIRECTORY') {
    throw new InitialControlledRebuildSetupEvidenceError('REBUILD_DIRECTORY_INVALID');
  }

  const rebuild = await scheme.listDirectory('rebuild');
  const runEntry = child(rebuild.children, run.leaf);
  if (runEntry === undefined) {
    return Object.freeze({
      currentTransactionCount: current.transactionCount,
      currentSourceRecordCount: current.sourceRecordCount,
      rebuildDirectoryExists: true,
      stagingDirectoryExists: false,
      stagingTransactionsExists: false,
      stagingSourceRecordsExists: false,
    });
  }
  if (runEntry.kind !== 'DIRECTORY') {
    throw new InitialControlledRebuildSetupEvidenceError('RUN_DIRECTORY_INVALID');
  }

  const runListing = await scheme.listDirectory(run.path);
  const allowed = new Set(['transactions', 'source_records']);
  if (runListing.children.some((entry) => !allowed.has(entry.name))) {
    throw new InitialControlledRebuildSetupEvidenceError('RUN_DIRECTORY_INVALID');
  }
  const transactions = child(runListing.children, 'transactions');
  const sourceRecords = child(runListing.children, 'source_records');
  if (
    (transactions !== undefined && transactions.kind !== 'TABLE')
    || (sourceRecords !== undefined && sourceRecords.kind !== 'TABLE')
  ) {
    throw new InitialControlledRebuildSetupEvidenceError('RUN_DIRECTORY_INVALID');
  }

  return Object.freeze({
    currentTransactionCount: current.transactionCount,
    currentSourceRecordCount: current.sourceRecordCount,
    rebuildDirectoryExists: true,
    stagingDirectoryExists: true,
    stagingTransactionsExists: transactions !== undefined,
    stagingSourceRecordsExists: sourceRecords !== undefined,
  });
}
