import type { InitialSnapshotProjection } from './initialSnapshotProjection.js';
import {
  markMigrationRunValidated,
  type MigrationRun,
} from './migrationRunState.js';

export const INITIAL_RECONCILIATION_CHECKS = [
  'SOURCE_RECORD_COUNT',
  'TRANSACTION_COUNTS',
  'TOTALS_BY_TYPE',
  'CATEGORY_AGGREGATES',
  'ACCOUNT_AGGREGATES',
  'CLASSIFICATION_COUNTS',
  'LEGACY_PERIOD_CLOSE_COUNT',
  'INVALID_AMBIGUOUS_MISSING_COUNTS',
] as const;

export type InitialReconciliationCheck = typeof INITIAL_RECONCILIATION_CHECKS[number];
export type InitialReconciliationCheckStatus = 'MATCHED' | 'MISMATCH' | 'NOT_CHECKED';

export interface InitialReconciliationEvidence {
  readonly checks: Readonly<Record<InitialReconciliationCheck, InitialReconciliationCheckStatus>>;
  readonly unexplainedHighImpactMismatchCount: number;
}

export type InitialValidationBlockerCode =
  | 'RUN_NOT_STAGING'
  | 'INITIAL_RUN_COUNTERS_INCONSISTENT'
  | 'PROJECTION_COUNTERS_INCONSISTENT'
  | 'RUN_ROW_COUNT_MISMATCH'
  | 'RUN_AMBIGUOUS_COUNT_MISMATCH'
  | 'INVALID_ROWS_PRESENT'
  | 'PROJECTION_FAILURES_PRESENT'
  | 'TRANSACTION_COVERAGE_MISMATCH'
  | 'INVALID_RECONCILIATION_EVIDENCE'
  | 'RECONCILIATION_CHECK_NOT_MATCHED'
  | 'UNEXPLAINED_HIGH_IMPACT_MISMATCH';

export interface InitialValidationBlocker {
  readonly code: InitialValidationBlockerCode;
  readonly check?: InitialReconciliationCheck;
}

export type InitialValidationResult =
  | Readonly<{ ok: true; validatedRun: Readonly<MigrationRun> }>
  | Readonly<{ ok: false; blockers: readonly Readonly<InitialValidationBlocker>[] }>;

function blocker(
  code: InitialValidationBlockerCode,
  check?: InitialReconciliationCheck,
): Readonly<InitialValidationBlocker> {
  return Object.freeze(check === undefined ? { code } : { code, check });
}

function projectionClassificationTotal(projection: Readonly<InitialSnapshotProjection>): number {
  const counters = projection.counters;
  return counters.financialRecords
    + counters.legacyPeriodClose
    + counters.nonFinancial
    + counters.invalid
    + counters.ambiguous;
}

function allProjectionCountersAreNonNegativeSafeIntegers(
  projection: Readonly<InitialSnapshotProjection>,
): boolean {
  return Object.values(projection.counters).every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
}

export function evaluateInitialValidation(
  run: MigrationRun,
  projection: Readonly<InitialSnapshotProjection>,
  reconciliation: Readonly<InitialReconciliationEvidence>,
): InitialValidationResult {
  const blockers: Readonly<InitialValidationBlocker>[] = [];

  if (run.state !== 'STAGING' || run.finishedAt !== null || run.errorCode !== null) {
    blockers.push(blocker('RUN_NOT_STAGING'));
  }

  if (
    run.rowsSeen !== run.rowsNew
    || run.rowsChanged !== 0
    || run.rowsMissing !== 0
  ) {
    blockers.push(blocker('INITIAL_RUN_COUNTERS_INCONSISTENT'));
  }

  const counters = projection.counters;
  if (
    !allProjectionCountersAreNonNegativeSafeIntegers(projection)
    || projection.outcomes.length !== counters.rowsSeen
    || projectionClassificationTotal(projection) !== counters.rowsSeen
  ) {
    blockers.push(blocker('PROJECTION_COUNTERS_INCONSISTENT'));
  }

  if (run.rowsSeen !== counters.rowsSeen) {
    blockers.push(blocker('RUN_ROW_COUNT_MISMATCH'));
  }
  if (run.rowsAmbiguous !== counters.ambiguous) {
    blockers.push(blocker('RUN_AMBIGUOUS_COUNT_MISMATCH'));
  }
  if (counters.invalid > 0) {
    blockers.push(blocker('INVALID_ROWS_PRESENT'));
  }
  if (counters.projectionFailures > 0) {
    blockers.push(blocker('PROJECTION_FAILURES_PRESENT'));
  }
  if (counters.transactionCandidates !== counters.financialRecords) {
    blockers.push(blocker('TRANSACTION_COVERAGE_MISMATCH'));
  }

  if (
    !Number.isSafeInteger(reconciliation.unexplainedHighImpactMismatchCount)
    || reconciliation.unexplainedHighImpactMismatchCount < 0
  ) {
    blockers.push(blocker('INVALID_RECONCILIATION_EVIDENCE'));
  } else if (reconciliation.unexplainedHighImpactMismatchCount > 0) {
    blockers.push(blocker('UNEXPLAINED_HIGH_IMPACT_MISMATCH'));
  }

  for (const check of INITIAL_RECONCILIATION_CHECKS) {
    if (reconciliation.checks[check] !== 'MATCHED') {
      blockers.push(blocker('RECONCILIATION_CHECK_NOT_MATCHED', check));
    }
  }

  if (blockers.length > 0) {
    return Object.freeze({ ok: false as const, blockers: Object.freeze(blockers) });
  }

  return Object.freeze({
    ok: true as const,
    validatedRun: markMigrationRunValidated(run),
  });
}
