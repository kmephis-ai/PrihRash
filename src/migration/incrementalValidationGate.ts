import type { IncrementalCurrentDeltaPlan } from './incrementalCurrentDelta.js';
import type { IncrementalCurrentReconciliationPlan } from './incrementalCurrentReconciliation.js';
import type { IncrementalSourceDeltaIntentPlan } from './incrementalSourceDeltaIntent.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  type InitialReconciliationCheck,
  type InitialReconciliationEvidence,
} from './initialValidationGate.js';
import {
  markMigrationRunValidated,
  type MigrationRun,
} from './migrationRunState.js';

export type IncrementalValidationBlockerCode =
  | 'RUN_NOT_STAGING'
  | 'INVALID_LINEAGE_COUNTER_EVIDENCE'
  | 'RUN_COUNTER_MISMATCH'
  | 'PROMOTION_BLOCKER_MISMATCH'
  | 'PROMOTION_BLOCKED'
  | 'INVALID_RECONCILIATION_EVIDENCE'
  | 'RECONCILIATION_CHECK_NOT_MATCHED'
  | 'UNEXPLAINED_HIGH_IMPACT_MISMATCH';

export interface IncrementalValidationBlocker {
  readonly code: IncrementalValidationBlockerCode;
  readonly counter?: 'rowsSeen' | 'rowsNew' | 'rowsChanged' | 'rowsMissing' | 'rowsAmbiguous';
  readonly check?: InitialReconciliationCheck;
  readonly promotionBlocker?: 'UNRESOLVED_LINEAGE';
}

export type IncrementalValidationResult =
  | Readonly<{ ok: true; validatedRun: Readonly<MigrationRun> }>
  | Readonly<{ ok: false; blockers: readonly Readonly<IncrementalValidationBlocker>[] }>;

interface DerivedIncrementalCounters {
  readonly rowsSeen: number;
  readonly rowsNew: number;
  readonly rowsChanged: number;
  readonly rowsMissing: number;
  readonly rowsAmbiguous: number;
}

function blocker(
  code: IncrementalValidationBlockerCode,
  extras: Omit<IncrementalValidationBlocker, 'code'> = {},
): Readonly<IncrementalValidationBlocker> {
  return Object.freeze({ code, ...extras });
}

function addSafe(left: number, right: number): number | null {
  const value = left + right;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function deriveCounters(
  plan: Readonly<IncrementalSourceDeltaIntentPlan>,
): Readonly<DerivedIncrementalCounters> | null {
  const currentRows = new Set<number>();
  let rowsSeen = 0;
  let rowsNew = 0;
  let rowsChanged = 0;
  let rowsMissing = 0;
  let rowsAmbiguous = 0;

  for (const intent of plan.intents) {
    switch (intent.kind) {
      case 'TOUCH':
      case 'CREATE':
      case 'REVISE': {
        if (!Number.isSafeInteger(intent.currentRowHint) || intent.currentRowHint <= 0 || currentRows.has(intent.currentRowHint)) {
          return null;
        }
        currentRows.add(intent.currentRowHint);
        const nextSeen = addSafe(rowsSeen, 1);
        if (nextSeen === null) return null;
        rowsSeen = nextSeen;
        if (intent.kind === 'CREATE') {
          const next = addSafe(rowsNew, 1);
          if (next === null) return null;
          rowsNew = next;
        } else if (intent.kind === 'REVISE') {
          const next = addSafe(rowsChanged, 1);
          if (next === null) return null;
          rowsChanged = next;
        }
        break;
      }
      case 'MARK_MISSING': {
        const next = addSafe(rowsMissing, 1);
        if (next === null) return null;
        rowsMissing = next;
        break;
      }
    }
  }

  for (const block of plan.unresolvedBlocks) {
    for (const rowHint of block.currentRowHints) {
      if (!Number.isSafeInteger(rowHint) || rowHint <= 0 || currentRows.has(rowHint)) return null;
      currentRows.add(rowHint);
      const nextSeen = addSafe(rowsSeen, 1);
      const nextAmbiguous = addSafe(rowsAmbiguous, 1);
      if (nextSeen === null || nextAmbiguous === null) return null;
      rowsSeen = nextSeen;
      rowsAmbiguous = nextAmbiguous;
    }
  }

  return Object.freeze({ rowsSeen, rowsNew, rowsChanged, rowsMissing, rowsAmbiguous });
}

function reconciliationEvidenceShapeValid(evidence: Readonly<InitialReconciliationEvidence>): boolean {
  return Number.isSafeInteger(evidence.unexplainedHighImpactMismatchCount)
    && evidence.unexplainedHighImpactMismatchCount >= 0
    && INITIAL_RECONCILIATION_CHECKS.every((check) => (
      evidence.checks[check] === 'MATCHED'
      || evidence.checks[check] === 'MISMATCH'
      || evidence.checks[check] === 'NOT_CHECKED'
    ));
}

export function evaluateIncrementalValidation(
  run: Readonly<MigrationRun>,
  sourceDelta: Readonly<IncrementalSourceDeltaIntentPlan>,
  reconciliationPlan: Readonly<IncrementalCurrentReconciliationPlan>,
  reconciliationEvidence: Readonly<InitialReconciliationEvidence>,
  currentDelta: Readonly<IncrementalCurrentDeltaPlan>,
): IncrementalValidationResult {
  const blockers: Readonly<IncrementalValidationBlocker>[] = [];

  if (run.state !== 'STAGING' || run.finishedAt !== null || run.errorCode !== null) {
    blockers.push(blocker('RUN_NOT_STAGING'));
  }

  const derived = deriveCounters(sourceDelta);
  if (derived === null) {
    blockers.push(blocker('INVALID_LINEAGE_COUNTER_EVIDENCE'));
  } else {
    const counters = ['rowsSeen', 'rowsNew', 'rowsChanged', 'rowsMissing', 'rowsAmbiguous'] as const;
    for (const counter of counters) {
      const actual = run[counter];
      if (!Number.isSafeInteger(actual) || actual < 0 || actual !== derived[counter]) {
        blockers.push(blocker('RUN_COUNTER_MISMATCH', { counter }));
      }
    }
  }

  if (reconciliationPlan.promotionBlocker !== currentDelta.promotionBlocker) {
    blockers.push(blocker('PROMOTION_BLOCKER_MISMATCH'));
  } else if (reconciliationPlan.promotionBlocker !== null) {
    blockers.push(blocker('PROMOTION_BLOCKED', {
      promotionBlocker: reconciliationPlan.promotionBlocker,
    }));
  }

  if (!reconciliationEvidenceShapeValid(reconciliationEvidence)) {
    blockers.push(blocker('INVALID_RECONCILIATION_EVIDENCE'));
  } else {
    if (reconciliationEvidence.unexplainedHighImpactMismatchCount > 0) {
      blockers.push(blocker('UNEXPLAINED_HIGH_IMPACT_MISMATCH'));
    }
    for (const check of INITIAL_RECONCILIATION_CHECKS) {
      if (reconciliationEvidence.checks[check] !== 'MATCHED') {
        blockers.push(blocker('RECONCILIATION_CHECK_NOT_MATCHED', { check }));
      }
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
