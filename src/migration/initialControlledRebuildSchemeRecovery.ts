import { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  YdbSchemeAdapter,
  type YdbSchemeDirectoryListing,
} from '../integration/ydb/scheme.js';
import type { ControlledInitialRebuildTablePaths } from './initialControlledRebuild.js';
import {
  readControlledRebuildCurrentEvidence,
  readControlledRebuildStagingEvidence,
} from './initialControlledRebuildEvidenceReader.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  type InitialControlledRebuildReconciliationSnapshot,
} from './initialControlledRebuildReconciliation.js';
import type { InitialControlledRebuildSetupPlan } from './initialControlledRebuildSetup.js';
import type { ControlledInitialSwapPlan } from './initialControlledRebuildSwapGate.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';

export type ControlledSchemeMutationRecoveryVerdict = 'APPLIED' | 'NOT_APPLIED' | 'RECOVERY_REQUIRED';

export interface ControlledSchemeMutationRecoveryResult {
  readonly verdict: ControlledSchemeMutationRecoveryVerdict;
}

export type ControlledSchemeMutationRecoveryErrorCode = 'INVALID_RECOVERY_PLAN';

export class ControlledSchemeMutationRecoveryError extends Error {
  readonly code: ControlledSchemeMutationRecoveryErrorCode;

  constructor(code: ControlledSchemeMutationRecoveryErrorCode) {
    super(code);
    this.name = 'ControlledSchemeMutationRecoveryError';
    this.code = code;
  }
}

const RUN_DIRECTORY_PATTERN = /^rebuild\/r_[0-9a-f]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PairState = 'PRESENT' | 'ABSENT' | 'MIXED';

function result(verdict: ControlledSchemeMutationRecoveryVerdict): Readonly<ControlledSchemeMutationRecoveryResult> {
  return Object.freeze({ verdict });
}

function exactTablePair(
  listing: Readonly<YdbSchemeDirectoryListing>,
  left: string,
  right: string,
  allowOtherChildren: boolean,
): PairState {
  const expected = new Set([left, right]);
  if (!allowOtherChildren && listing.children.some((entry) => !expected.has(entry.name))) return 'MIXED';
  const leftEntry = listing.children.find((entry) => entry.name === left);
  const rightEntry = listing.children.find((entry) => entry.name === right);
  if (leftEntry === undefined && rightEntry === undefined) return 'ABSENT';
  if (leftEntry?.kind === 'TABLE' && rightEntry?.kind === 'TABLE') return 'PRESENT';
  return 'MIXED';
}

function emptySnapshot(snapshot: Readonly<InitialControlledRebuildReconciliationSnapshot>): boolean {
  return snapshot.sourceRecordCount === 0
    && snapshot.transactionCount === 0
    && snapshot.missingSourceRecordCount === 0
    && Object.values(snapshot.classificationCounts).every((count) => count === 0)
    && snapshot.typeAggregates.length === 0
    && snapshot.categoryAggregates.length === 0
    && snapshot.accountAggregates.length === 0;
}

function exactCandidate(
  snapshot: Readonly<InitialControlledRebuildReconciliationSnapshot>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
): boolean {
  const comparison = compareControlledRebuildStagingReconciliation(
    buildExpectedControlledRebuildReconciliation(verifiedPlan),
    snapshot,
  );
  return comparison.unexplainedHighImpactMismatchCount === 0
    && Object.values(comparison.checks).every((status) => status === 'MATCHED');
}

function setupTables(plan: Readonly<InitialControlledRebuildSetupPlan>): Readonly<ControlledInitialRebuildTablePaths> {
  if (!RUN_DIRECTORY_PATTERN.test(plan.stagingDirectory) || plan.copyItems.length !== 2) {
    throw new ControlledSchemeMutationRecoveryError('INVALID_RECOVERY_PLAN');
  }
  const expected = [
    { source: 'transactions', destination: `${plan.stagingDirectory}/transactions` },
    { source: 'source_records', destination: `${plan.stagingDirectory}/source_records` },
  ];
  for (const [index, item] of plan.copyItems.entries()) {
    const target = expected[index];
    if (target === undefined || item.source !== target.source || item.destination !== target.destination) {
      throw new ControlledSchemeMutationRecoveryError('INVALID_RECOVERY_PLAN');
    }
  }
  return Object.freeze({
    transactions: `${plan.stagingDirectory}/transactions`,
    sourceRecords: `${plan.stagingDirectory}/source_records`,
  });
}

function swapTables(plan: Readonly<ControlledInitialSwapPlan>): Readonly<ControlledInitialRebuildTablePaths> {
  const runId = plan.runId.toLowerCase();
  if (!UUID_PATTERN.test(runId) || plan.replacements.length !== 2) {
    throw new ControlledSchemeMutationRecoveryError('INVALID_RECOVERY_PLAN');
  }
  const directory = `rebuild/r_${runId.replaceAll('-', '')}`;
  const expected = [
    { source: `${directory}/transactions`, destination: 'transactions', replace: true },
    { source: `${directory}/source_records`, destination: 'source_records', replace: true },
  ];
  for (const [index, replacement] of plan.replacements.entries()) {
    const target = expected[index];
    if (
      target === undefined
      || replacement.source !== target.source
      || replacement.destination !== target.destination
      || replacement.replace !== true
    ) {
      throw new ControlledSchemeMutationRecoveryError('INVALID_RECOVERY_PLAN');
    }
  }
  return Object.freeze({
    transactions: `${directory}/transactions`,
    sourceRecords: `${directory}/source_records`,
  });
}

function stagingDirectory(tables: Readonly<ControlledInitialRebuildTablePaths>): string {
  return tables.transactions.slice(0, -'/transactions'.length);
}

async function structuralEvidence(
  scheme: YdbSchemeAdapter,
  tables: Readonly<ControlledInitialRebuildTablePaths>,
): Promise<Readonly<{ current: PairState; staging: PairState }>> {
  const current = exactTablePair(await scheme.listDirectory(''), 'transactions', 'source_records', true);
  const staging = exactTablePair(
    await scheme.listDirectory(stagingDirectory(tables)),
    'transactions',
    'source_records',
    false,
  );
  return Object.freeze({ current, staging });
}

export async function recoverUnknownControlledRebuildCopyOutcome(
  scheme: YdbSchemeAdapter,
  data: YdbAdapter,
  plan: Readonly<InitialControlledRebuildSetupPlan>,
): Promise<Readonly<ControlledSchemeMutationRecoveryResult>> {
  const tables = setupTables(plan);
  try {
    const structure = await structuralEvidence(scheme, tables);
    if (structure.current !== 'PRESENT' || structure.staging === 'MIXED') return result('RECOVERY_REQUIRED');

    const current = await readControlledRebuildCurrentEvidence(data);
    if (!emptySnapshot(current)) return result('RECOVERY_REQUIRED');
    if (structure.staging === 'ABSENT') return result('NOT_APPLIED');

    const staging = await readControlledRebuildStagingEvidence(data, tables);
    return result(emptySnapshot(staging) ? 'APPLIED' : 'RECOVERY_REQUIRED');
  } catch {
    return result('RECOVERY_REQUIRED');
  }
}

export async function recoverUnknownControlledInitialSwapOutcome(
  scheme: YdbSchemeAdapter,
  data: YdbAdapter,
  swapPlan: Readonly<ControlledInitialSwapPlan>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
): Promise<Readonly<ControlledSchemeMutationRecoveryResult>> {
  const tables = swapTables(swapPlan);
  const expected = buildExpectedControlledRebuildReconciliation(verifiedPlan);
  if (expected.sourceRecordCount === 0 && expected.transactionCount === 0) return result('RECOVERY_REQUIRED');

  try {
    const structure = await structuralEvidence(scheme, tables);
    if (structure.current !== 'PRESENT' || structure.staging === 'MIXED') return result('RECOVERY_REQUIRED');

    const current = await readControlledRebuildCurrentEvidence(data);
    if (structure.staging === 'ABSENT') {
      return result(exactCandidate(current, verifiedPlan) ? 'APPLIED' : 'RECOVERY_REQUIRED');
    }
    if (!emptySnapshot(current)) return result('RECOVERY_REQUIRED');

    const staging = await readControlledRebuildStagingEvidence(data, tables);
    return result(exactCandidate(staging, verifiedPlan) ? 'NOT_APPLIED' : 'RECOVERY_REQUIRED');
  } catch {
    return result('RECOVERY_REQUIRED');
  }
}
