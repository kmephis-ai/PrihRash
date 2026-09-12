import { readStatement, type YdbAdapter } from '../integration/ydb/adapter.js';

export type InitialBootstrapRecoveryVerdict = 'APPLIED' | 'NOT_APPLIED' | 'RECOVERY_REQUIRED';

export interface InitialBootstrapRecoveryEvidence {
  readonly migrationRuns: number;
  readonly committedRuns: number;
  readonly stagingRuns: number;
  readonly validatedRuns: number;
  readonly failedRuns: number;
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

export function classifyInitialBootstrapRecoveryEvidence(
  evidence: Readonly<InitialBootstrapRecoveryEvidence>,
): InitialBootstrapRecoveryVerdict {
  const knownRunCount = evidence.committedRuns
    + evidence.stagingRuns
    + evidence.validatedRuns
    + evidence.failedRuns;
  if (!Number.isSafeInteger(knownRunCount) || knownRunCount !== evidence.migrationRuns) {
    return 'RECOVERY_REQUIRED';
  }

  if (evidence.migrationRuns === 0) {
    return allBootstrapTouchedStateEmpty(evidence) ? 'NOT_APPLIED' : 'RECOVERY_REQUIRED';
  }

  if (
    evidence.migrationRuns === 1
    && evidence.committedRuns === 1
    && evidence.stagingRuns === 0
    && evidence.validatedRuns === 0
    && evidence.failedRuns === 0
    && evidence.committedRowsSeen !== null
    && evidence.sourceSnapshots === 1
    && evidence.identityManifests === 1
    && evidence.sourceRecords === evidence.committedRowsSeen
    && evidence.sourceRecordRevisions === evidence.committedRowsSeen
  ) {
    return 'APPLIED';
  }

  return 'RECOVERY_REQUIRED';
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

export async function probeInitialBootstrapRecovery(
  adapter: YdbAdapter,
): Promise<InitialBootstrapRecoveryVerdict> {
  try {
    return classifyInitialBootstrapRecoveryEvidence(await readInitialBootstrapRecoveryEvidence(adapter));
  } catch {
    return 'RECOVERY_REQUIRED';
  }
}
