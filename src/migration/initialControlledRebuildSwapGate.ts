import type { ControlledInitialRebuildPlan, ControlledInitialRebuildReplacement } from './initialControlledRebuild.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  type InitialControlledRebuildReconciliationSnapshot,
} from './initialControlledRebuildReconciliation.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';
import type { MigrationRun } from './migrationRunState.js';

export interface ControlledInitialSwapPlan {
  readonly runId: string;
  readonly replacements: readonly Readonly<ControlledInitialRebuildReplacement>[];
}

export type ControlledInitialSwapGateErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'PREVIOUS_VERIFIED_SHADOW_PRESENT'
  | 'CONTROLLED_EXPECTED_COUNT_MISMATCH'
  | 'STAGING_RECONCILIATION_MISMATCH'
  | 'INVALID_REPLACEMENT_PLAN';

export class ControlledInitialSwapGateError extends Error {
  readonly code: ControlledInitialSwapGateErrorCode;

  constructor(code: ControlledInitialSwapGateErrorCode) {
    super(code);
    this.name = 'ControlledInitialSwapGateError';
    this.code = code;
  }
}

function validateReplacements(controlled: Readonly<ControlledInitialRebuildPlan>): void {
  const expected = [
    {
      source: controlled.stagingTables.transactions,
      destination: 'transactions',
      replace: true,
    },
    {
      source: controlled.stagingTables.sourceRecords,
      destination: 'source_records',
      replace: true,
    },
  ];
  if (controlled.replacements.length !== expected.length) {
    throw new ControlledInitialSwapGateError('INVALID_REPLACEMENT_PLAN');
  }
  for (const [index, replacement] of controlled.replacements.entries()) {
    const item = expected[index];
    if (
      item === undefined
      || replacement.source !== item.source
      || replacement.destination !== item.destination
      || replacement.replace !== true
    ) {
      throw new ControlledInitialSwapGateError('INVALID_REPLACEMENT_PLAN');
    }
  }
}

export function gateControlledInitialSwap(
  run: Readonly<MigrationRun>,
  controlled: Readonly<ControlledInitialRebuildPlan>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
  observed: Readonly<InitialControlledRebuildReconciliationSnapshot>,
  previousVerifiedRunId: string | null,
): Readonly<ControlledInitialSwapPlan> {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new ControlledInitialSwapGateError('RUN_NOT_VALIDATED');
  }
  if (previousVerifiedRunId !== null) {
    throw new ControlledInitialSwapGateError('PREVIOUS_VERIFIED_SHADOW_PRESENT');
  }
  if (controlled.runId.toLowerCase() !== run.id.toLowerCase()) {
    throw new ControlledInitialSwapGateError('INVALID_REPLACEMENT_PLAN');
  }

  const expected = buildExpectedControlledRebuildReconciliation(verifiedPlan);
  if (
    expected.sourceRecordCount !== controlled.expectedSourceRecordCount
    || expected.transactionCount !== controlled.expectedTransactionCount
  ) {
    throw new ControlledInitialSwapGateError('CONTROLLED_EXPECTED_COUNT_MISMATCH');
  }

  const reconciliation = compareControlledRebuildStagingReconciliation(expected, observed);
  if (
    reconciliation.unexplainedHighImpactMismatchCount !== 0
    || Object.values(reconciliation.checks).some((status) => status !== 'MATCHED')
  ) {
    throw new ControlledInitialSwapGateError('STAGING_RECONCILIATION_MISMATCH');
  }

  validateReplacements(controlled);
  return Object.freeze({
    runId: run.id.toLowerCase(),
    replacements: Object.freeze(controlled.replacements.map((replacement) => Object.freeze({ ...replacement }))),
  });
}
