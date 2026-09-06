import type { SourceRowClassification } from '../classification/sourceRow.js';
import type { CanonicalTransaction } from '../domain/transaction.js';
import type {
  InitialSnapshotProjection,
  InitialSnapshotProjectionOutcome,
} from './initialSnapshotProjection.js';
import type {
  InitialSourceLineageProjection,
  InitialSourceRecordProjection,
} from './initialSourceLineage.js';
import type { MigrationRun } from './migrationRunState.js';

export interface InitialTransactionIdentityAssignment {
  readonly sourceRecordId: string;
  readonly transactionId: string;
}

export interface InitialVerifiedSourceRecordCandidate extends Omit<
  InitialSourceRecordProjection,
  'classification' | 'transactionId'
> {
  readonly classification: SourceRowClassification;
  readonly transactionId: string | null;
}

export interface InitialVerifiedTransactionCandidate {
  readonly sourceRecordId: string;
  readonly transactionId: string;
  readonly transaction: Readonly<CanonicalTransaction>;
}

export interface InitialVerifiedCurrentPlan {
  readonly sourceRecords: readonly Readonly<InitialVerifiedSourceRecordCandidate>[];
  readonly transactions: readonly Readonly<InitialVerifiedTransactionCandidate>[];
}

export type InitialVerifiedCurrentPlanErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'RUN_ROW_COUNT_MISMATCH'
  | 'LINEAGE_LENGTH_MISMATCH'
  | 'PROJECTION_LENGTH_MISMATCH'
  | 'DUPLICATE_LINEAGE_SOURCE_ID'
  | 'DUPLICATE_PROJECTION_SOURCE_ID'
  | 'LINEAGE_PROJECTION_IDENTITY_MISMATCH'
  | 'INVALID_OR_FAILED_OUTCOME'
  | 'FINANCIAL_TRANSACTION_MISSING'
  | 'NON_FINANCIAL_TRANSACTION_PRESENT'
  | 'INVALID_TRANSACTION_ASSIGNMENT_UUID'
  | 'DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID'
  | 'DUPLICATE_TRANSACTION_ID'
  | 'MISSING_TRANSACTION_ASSIGNMENT'
  | 'UNEXPECTED_TRANSACTION_ASSIGNMENT';

export class InitialVerifiedCurrentPlanError extends Error {
  readonly code: InitialVerifiedCurrentPlanErrorCode;

  constructor(code: InitialVerifiedCurrentPlanErrorCode) {
    super(code);
    this.name = 'InitialVerifiedCurrentPlanError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizedSourceId(value: string): string {
  return value.toLowerCase();
}

function assignmentMap(
  assignments: readonly InitialTransactionIdentityAssignment[],
): ReadonlyMap<string, string> {
  const bySource = new Map<string, string>();
  const transactionIds = new Set<string>();

  for (const assignment of assignments) {
    if (!UUID_PATTERN.test(assignment.transactionId)) {
      throw new InitialVerifiedCurrentPlanError('INVALID_TRANSACTION_ASSIGNMENT_UUID');
    }
    const sourceId = normalizedSourceId(assignment.sourceRecordId);
    const transactionId = assignment.transactionId.toLowerCase();
    if (bySource.has(sourceId)) {
      throw new InitialVerifiedCurrentPlanError('DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID');
    }
    if (transactionIds.has(transactionId)) {
      throw new InitialVerifiedCurrentPlanError('DUPLICATE_TRANSACTION_ID');
    }
    bySource.set(sourceId, transactionId);
    transactionIds.add(transactionId);
  }

  return bySource;
}

function indexOutcomes(
  projection: Readonly<InitialSnapshotProjection>,
): ReadonlyMap<string, Readonly<InitialSnapshotProjectionOutcome>> {
  const bySource = new Map<string, Readonly<InitialSnapshotProjectionOutcome>>();
  for (const outcome of projection.outcomes) {
    const sourceId = normalizedSourceId(outcome.sourceRecordId);
    if (bySource.has(sourceId)) {
      throw new InitialVerifiedCurrentPlanError('DUPLICATE_PROJECTION_SOURCE_ID');
    }
    bySource.set(sourceId, outcome);
  }
  return bySource;
}

export function buildInitialVerifiedCurrentPlan(
  run: Readonly<MigrationRun>,
  lineage: Readonly<InitialSourceLineageProjection>,
  projection: Readonly<InitialSnapshotProjection>,
  assignments: readonly InitialTransactionIdentityAssignment[],
): Readonly<InitialVerifiedCurrentPlan> {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new InitialVerifiedCurrentPlanError('RUN_NOT_VALIDATED');
  }
  if (run.rowsSeen !== projection.counters.rowsSeen || run.rowsAmbiguous !== projection.counters.ambiguous) {
    throw new InitialVerifiedCurrentPlanError('RUN_ROW_COUNT_MISMATCH');
  }
  if (lineage.records.length !== lineage.revisions.length) {
    throw new InitialVerifiedCurrentPlanError('LINEAGE_LENGTH_MISMATCH');
  }
  if (lineage.records.length !== projection.outcomes.length) {
    throw new InitialVerifiedCurrentPlanError('PROJECTION_LENGTH_MISMATCH');
  }

  const outcomesBySource = indexOutcomes(projection);
  const assignmentsBySource = assignmentMap(assignments);
  const lineageIds = new Set<string>();
  const sourceRecords: Readonly<InitialVerifiedSourceRecordCandidate>[] = [];
  const transactions: Readonly<InitialVerifiedTransactionCandidate>[] = [];
  const usedAssignments = new Set<string>();

  for (const record of lineage.records) {
    const sourceId = normalizedSourceId(record.id);
    if (lineageIds.has(sourceId)) {
      throw new InitialVerifiedCurrentPlanError('DUPLICATE_LINEAGE_SOURCE_ID');
    }
    lineageIds.add(sourceId);

    const outcome = outcomesBySource.get(sourceId);
    if (outcome === undefined) {
      throw new InitialVerifiedCurrentPlanError('LINEAGE_PROJECTION_IDENTITY_MISMATCH');
    }
    if (outcome.projectionError !== null || outcome.classification === 'INVALID') {
      throw new InitialVerifiedCurrentPlanError('INVALID_OR_FAILED_OUTCOME');
    }

    const assignment = assignmentsBySource.get(sourceId) ?? null;
    if (outcome.classification === 'FINANCIAL_RECORD') {
      if (outcome.transaction === null) {
        throw new InitialVerifiedCurrentPlanError('FINANCIAL_TRANSACTION_MISSING');
      }
      if (assignment === null) {
        throw new InitialVerifiedCurrentPlanError('MISSING_TRANSACTION_ASSIGNMENT');
      }
      usedAssignments.add(sourceId);
      transactions.push(Object.freeze({
        sourceRecordId: sourceId,
        transactionId: assignment,
        transaction: outcome.transaction,
      }));
    } else {
      if (outcome.transaction !== null) {
        throw new InitialVerifiedCurrentPlanError('NON_FINANCIAL_TRANSACTION_PRESENT');
      }
      if (assignment !== null) {
        throw new InitialVerifiedCurrentPlanError('UNEXPECTED_TRANSACTION_ASSIGNMENT');
      }
    }

    sourceRecords.push(Object.freeze({
      ...record,
      id: sourceId,
      classification: outcome.classification,
      normalizationStatus: null,
      transactionId: assignment,
    }));
  }

  if (outcomesBySource.size !== lineageIds.size) {
    throw new InitialVerifiedCurrentPlanError('LINEAGE_PROJECTION_IDENTITY_MISMATCH');
  }
  if (usedAssignments.size !== assignmentsBySource.size) {
    throw new InitialVerifiedCurrentPlanError('UNEXPECTED_TRANSACTION_ASSIGNMENT');
  }

  return Object.freeze({
    sourceRecords: Object.freeze(sourceRecords),
    transactions: Object.freeze(transactions),
  });
}
