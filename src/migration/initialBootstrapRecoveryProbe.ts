import { readStatement, type YdbAdapter } from '../integration/ydb/adapter.js';
import { INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE } from './initialBootstrapStaleStagingRetirement.js';

export type InitialBootstrapRecoveryVerdict = 'APPLIED' | 'NOT_APPLIED' | 'RECOVERY_REQUIRED';

export type InitialBootstrapRecoveryReason =
  | 'EMPTY_DURABLE_STATE'
  | 'COMMITTED_DURABLE_STATE'
  | 'READ_FAILED'
  | 'RUN_STATE_COUNT_INCONSISTENT'
  | 'RESIDUAL_STATE_WITHOUT_RUN'
  | 'MULTIPLE_MIGRATION_RUNS'
  | 'STAGING_RUN_PRESENT'
  | 'VALIDATED_RUN_PRESENT'
  | 'FAILED_RUN_PRESENT'
  | 'STALE_STAGING_RETIRED'
  | 'COMMITTED_ROWS_SEEN_MISSING'
  | 'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID'
  | 'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID'
  | 'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH'
  | 'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH';

export interface InitialBootstrapRecoveryClassification {
  readonly verdict: InitialBootstrapRecoveryVerdict;
  readonly reason: InitialBootstrapRecoveryReason;
}

export interface InitialBootstrapRecoveryEvidence {
  readonly migrationRuns: number;
  readonly committedRuns: number;
  readonly stagingRuns: number;
  readonly validatedRuns: number;
  readonly failedRuns: number;
  readonly staleRetiredRuns: number;
  readonly committedRowsSeen: number | null;
  readonly sourceSnapshots: number;
  readonly identityManifests: number;
  readonly sourceRecords: number;
  readonly sourceRecordRevisions: number;
  readonly transactions: number;
  readonly accounts: number;
  readonly categories: number;
  readonly familyMembers: number;
}

interface CountRow {
  readonly row_count?: unknown;
}

interface CommittedRowsSeenRow {
  readonly rows_seen?: unknown;
}

const COUNT_STATEMENTS = Object.freeze({
  migrationRuns: 'SELECT COUNT(*) AS row_count FROM migration_runs',
  committedRuns: "SELECT COUNT(*) AS row_count FROM migration_runs WHERE state = 'COMMITTED'",
  stagingRuns: "SELECT COUNT(*) AS row_count FROM migration_runs WHERE state = 'STAGING'",
  validatedRuns: "SELECT COUNT(*) AS row_count FROM migration_runs WHERE state = 'VALIDATED'",
  failedRuns: "SELECT COUNT(*) AS row_count FROM migration_runs WHERE state = 'FAILED'",
  staleRetiredRuns: "SELECT COUNT(*) AS row_count FROM migration_runs WHERE state = 'FAILED' AND error_code = '"
    + INITIAL_BOOTSTRAP_STALE_STAGING_FAILURE_CODE + "'",
  sourceSnapshots: 'SELECT COUNT(*) AS row_count FROM source_snapshots',
  identityManifests: 'SELECT COUNT(*) AS row_count FROM initial_bootstrap_identity_manifests',
  sourceRecords: 'SELECT COUNT(*) AS row_count FROM source_records',
  sourceRecordRevisions: 'SELECT COUNT(*) AS row_count FROM source_record_revisions',
  transactions: 'SELECT COUNT(*) AS row_count FROM transactions',
  accounts: 'SELECT COUNT(*) AS row_count FROM accounts',
  categories: 'SELECT COUNT(*) AS row_count FROM categories',
  familyMembers: 'SELECT COUNT(*) AS row_count FROM family_members',
});

const COMMITTED_ROWS_SEEN_STATEMENT =
  "SELECT rows_seen FROM migration_runs WHERE state = 'COMMITTED' LIMIT 2";

function safeCount(value: unknown): number | null {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}

function classification(
  verdict: InitialBootstrapRecoveryVerdict,
  reason: InitialBootstrapRecoveryReason,
): Readonly<InitialBootstrapRecoveryClassification> {
  return Object.freeze({ verdict, reason });
}

function allBootstrapTouchedStateEmpty(evidence: Readonly<InitialBootstrapRecoveryEvidence>): boolean {
  return evidence.migrationRuns === 0
    && evidence.sourceSnapshots === 0
    && evidence.identityManifests === 0
    && evidence.sourceRecords === 0
    && evidence.sourceRecordRevisions === 0
    && evidence.transactions === 0
    && evidence.accounts === 0
    && evidence.categories === 0
    && evidence.familyMembers === 0;
}

function staleRetiredHistoryIsSafeForFreshBootstrap(
  evidence: Readonly<InitialBootstrapRecoveryEvidence>,
): boolean {
  return evidence.staleRetiredRuns > 0
    && evidence.failedRuns === evidence.staleRetiredRuns
    && evidence.sourceSnapshots === evidence.staleRetiredRuns
    && evidence.identityManifests === evidence.staleRetiredRuns
    && evidence.sourceRecords === 0
    && evidence.transactions === 0;
}

export function diagnoseInitialBootstrapRecoveryEvidence(
  evidence: Readonly<InitialBootstrapRecoveryEvidence>,
): Readonly<InitialBootstrapRecoveryClassification> {
  const knownRunCount = evidence.committedRuns
    + evidence.stagingRuns
    + evidence.validatedRuns
    + evidence.failedRuns;
  if (
    !Number.isSafeInteger(knownRunCount)
    || knownRunCount !== evidence.migrationRuns
    || !Number.isSafeInteger(evidence.staleRetiredRuns)
    || evidence.staleRetiredRuns < 0
    || evidence.staleRetiredRuns > evidence.failedRuns
  ) {
    return classification('RECOVERY_REQUIRED', 'RUN_STATE_COUNT_INCONSISTENT');
  }

  if (evidence.migrationRuns === 0) {
    if (evidence.staleRetiredRuns !== 0) {
      return classification('RECOVERY_REQUIRED', 'RUN_STATE_COUNT_INCONSISTENT');
    }
    return allBootstrapTouchedStateEmpty(evidence)
      ? classification('NOT_APPLIED', 'EMPTY_DURABLE_STATE')
      : classification('RECOVERY_REQUIRED', 'RESIDUAL_STATE_WITHOUT_RUN');
  }

  if (evidence.failedRuns !== evidence.staleRetiredRuns) {
    return classification('RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT');
  }

  const activeRunCount = evidence.committedRuns + evidence.stagingRuns + evidence.validatedRuns;
  if (activeRunCount === 0) {
    return staleRetiredHistoryIsSafeForFreshBootstrap(evidence)
      ? classification('RECOVERY_REQUIRED', 'STALE_STAGING_RETIRED')
      : classification('RECOVERY_REQUIRED', 'FAILED_RUN_PRESENT');
  }

  if (activeRunCount > 1) {
    return classification('RECOVERY_REQUIRED', 'MULTIPLE_MIGRATION_RUNS');
  }

  if (evidence.stagingRuns === 1) {
    return classification('RECOVERY_REQUIRED', 'STAGING_RUN_PRESENT');
  }
  if (evidence.validatedRuns === 1) {
    return classification('RECOVERY_REQUIRED', 'VALIDATED_RUN_PRESENT');
  }

  if (evidence.committedRuns === 1) {
    if (evidence.committedRowsSeen === null) {
      return classification('RECOVERY_REQUIRED', 'COMMITTED_ROWS_SEEN_MISSING');
    }
    if (evidence.sourceSnapshots !== 1) {
      return classification('RECOVERY_REQUIRED', 'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID');
    }
    if (evidence.identityManifests !== 1) {
      return classification('RECOVERY_REQUIRED', 'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID');
    }
    if (evidence.sourceRecords !== evidence.committedRowsSeen) {
      return classification('RECOVERY_REQUIRED', 'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH');
    }
    if (evidence.sourceRecordRevisions !== evidence.committedRowsSeen) {
      return classification('RECOVERY_REQUIRED', 'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH');
    }
    return classification('APPLIED', 'COMMITTED_DURABLE_STATE');
  }

  return classification('RECOVERY_REQUIRED', 'RUN_STATE_COUNT_INCONSISTENT');
}

export function classifyInitialBootstrapRecoveryEvidence(
  evidence: Readonly<InitialBootstrapRecoveryEvidence>,
): InitialBootstrapRecoveryVerdict {
  return diagnoseInitialBootstrapRecoveryEvidence(evidence).verdict;
}

async function readCount(adapter: YdbAdapter, text: string): Promise<number> {
  const result = await adapter.read<CountRow>(readStatement(text));
  if (result.rows.length !== 1) throw new Error('INITIAL_BOOTSTRAP_RECOVERY_COUNT_INVALID');
  const value = safeCount(result.rows[0]?.row_count);
  if (value === null) throw new Error('INITIAL_BOOTSTRAP_RECOVERY_COUNT_INVALID');
  return value;
}

async function readCommittedRowsSeen(adapter: YdbAdapter): Promise<number | null> {
  const result = await adapter.read<CommittedRowsSeenRow>(readStatement(COMMITTED_ROWS_SEEN_STATEMENT));
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) throw new Error('INITIAL_BOOTSTRAP_RECOVERY_COMMITTED_RUN_INVALID');
  const value = safeCount(result.rows[0]?.rows_seen);
  if (value === null) throw new Error('INITIAL_BOOTSTRAP_RECOVERY_COMMITTED_RUN_INVALID');
  return value;
}

export async function readInitialBootstrapRecoveryEvidence(
  adapter: YdbAdapter,
): Promise<Readonly<InitialBootstrapRecoveryEvidence>> {
  const evidence = {
    migrationRuns: await readCount(adapter, COUNT_STATEMENTS.migrationRuns),
    committedRuns: await readCount(adapter, COUNT_STATEMENTS.committedRuns),
    stagingRuns: await readCount(adapter, COUNT_STATEMENTS.stagingRuns),
    validatedRuns: await readCount(adapter, COUNT_STATEMENTS.validatedRuns),
    failedRuns: await readCount(adapter, COUNT_STATEMENTS.failedRuns),
    staleRetiredRuns: await readCount(adapter, COUNT_STATEMENTS.staleRetiredRuns),
    committedRowsSeen: await readCommittedRowsSeen(adapter),
    sourceSnapshots: await readCount(adapter, COUNT_STATEMENTS.sourceSnapshots),
    identityManifests: await readCount(adapter, COUNT_STATEMENTS.identityManifests),
    sourceRecords: await readCount(adapter, COUNT_STATEMENTS.sourceRecords),
    sourceRecordRevisions: await readCount(adapter, COUNT_STATEMENTS.sourceRecordRevisions),
    transactions: await readCount(adapter, COUNT_STATEMENTS.transactions),
    accounts: await readCount(adapter, COUNT_STATEMENTS.accounts),
    categories: await readCount(adapter, COUNT_STATEMENTS.categories),
    familyMembers: await readCount(adapter, COUNT_STATEMENTS.familyMembers),
  } satisfies InitialBootstrapRecoveryEvidence;
  return Object.freeze(evidence);
}

export async function diagnoseInitialBootstrapRecovery(
  adapter: YdbAdapter,
): Promise<Readonly<InitialBootstrapRecoveryClassification>> {
  try {
    return diagnoseInitialBootstrapRecoveryEvidence(await readInitialBootstrapRecoveryEvidence(adapter));
  } catch {
    return classification('RECOVERY_REQUIRED', 'READ_FAILED');
  }
}

export async function probeInitialBootstrapRecovery(
  adapter: YdbAdapter,
): Promise<InitialBootstrapRecoveryVerdict> {
  return (await diagnoseInitialBootstrapRecovery(adapter)).verdict;
}
