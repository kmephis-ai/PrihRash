import {
  diffSequences,
  type CurrentSequenceRow,
  type PreviousSequenceRow,
  type SequenceDiffOperation,
} from './sequenceDiff.js';
import type { MigrationRunCounters } from './migrationRunState.js';

export interface IncrementalNewSourceRecordAssignment {
  readonly currentRowHint: number;
  readonly sourceRecordId: string;
}

export type IncrementalLineageOutcome =
  | Readonly<Extract<SequenceDiffOperation, { kind: 'UNCHANGED' }>>
  | Readonly<Extract<SequenceDiffOperation, { kind: 'MISSING' }>>
  | Readonly<Extract<SequenceDiffOperation, { kind: 'REVISED' }>>
  | Readonly<{
      kind: 'AMBIGUOUS_BLOCK';
      previousSourceRecordIds: readonly string[];
      previousRowHints: readonly number[];
      currentRowHints: readonly number[];
    }>
  | Readonly<{
      kind: 'INSERTED';
      sourceRecordId: string;
      currentRowHint: number;
      digest: string;
    }>;

export interface IncrementalLineagePlan {
  readonly outcomes: readonly IncrementalLineageOutcome[];
  readonly counters: Readonly<MigrationRunCounters>;
}

export type IncrementalLineagePlanErrorCode =
  | 'INVALID_SOURCE_RECORD_ID'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'INVALID_ROW_HINT'
  | 'DUPLICATE_ROW_HINT'
  | 'EMPTY_DIGEST'
  | 'INVALID_ASSIGNMENT_ROW_HINT'
  | 'DUPLICATE_ASSIGNMENT_ROW_HINT'
  | 'DUPLICATE_ASSIGNMENT_SOURCE_RECORD_ID'
  | 'ASSIGNMENT_SOURCE_RECORD_ID_COLLISION'
  | 'MISSING_INSERTED_SOURCE_RECORD_ASSIGNMENT'
  | 'EXTRA_INSERTED_SOURCE_RECORD_ASSIGNMENT';

export class IncrementalLineagePlanError extends Error {
  readonly code: IncrementalLineagePlanErrorCode;

  constructor(code: IncrementalLineagePlanErrorCode) {
    super(code);
    this.name = 'IncrementalLineagePlanError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function validateRowHint(rowHint: number): void {
  if (!Number.isSafeInteger(rowHint) || rowHint <= 0) {
    throw new IncrementalLineagePlanError('INVALID_ROW_HINT');
  }
}

function validateDigest(digest: string): void {
  if (digest.trim().length === 0) {
    throw new IncrementalLineagePlanError('EMPTY_DIGEST');
  }
}

function validatePrevious(
  previous: readonly Readonly<PreviousSequenceRow>[],
): readonly Readonly<PreviousSequenceRow>[] {
  const ids = new Set<string>();
  const rowHints = new Set<number>();
  return Object.freeze(previous.map((row) => {
    if (!UUID_PATTERN.test(row.sourceRecordId)) {
      throw new IncrementalLineagePlanError('INVALID_SOURCE_RECORD_ID');
    }
    const sourceRecordId = row.sourceRecordId.toLowerCase();
    if (ids.has(sourceRecordId)) {
      throw new IncrementalLineagePlanError('DUPLICATE_SOURCE_RECORD_ID');
    }
    ids.add(sourceRecordId);

    validateRowHint(row.rowHint);
    if (rowHints.has(row.rowHint)) {
      throw new IncrementalLineagePlanError('DUPLICATE_ROW_HINT');
    }
    rowHints.add(row.rowHint);
    validateDigest(row.digest);

    return Object.freeze({ ...row, sourceRecordId });
  }));
}

function validateCurrent(
  current: readonly Readonly<CurrentSequenceRow>[],
): readonly Readonly<CurrentSequenceRow>[] {
  const rowHints = new Set<number>();
  return Object.freeze(current.map((row) => {
    validateRowHint(row.rowHint);
    if (rowHints.has(row.rowHint)) {
      throw new IncrementalLineagePlanError('DUPLICATE_ROW_HINT');
    }
    rowHints.add(row.rowHint);
    validateDigest(row.digest);
    return Object.freeze({ ...row });
  }));
}

function validateAssignments(
  assignments: readonly Readonly<IncrementalNewSourceRecordAssignment>[],
  previousIds: ReadonlySet<string>,
): ReadonlyMap<number, string> {
  const byRowHint = new Map<number, string>();
  const assignedIds = new Set<string>();

  for (const assignment of assignments) {
    if (!Number.isSafeInteger(assignment.currentRowHint) || assignment.currentRowHint <= 0) {
      throw new IncrementalLineagePlanError('INVALID_ASSIGNMENT_ROW_HINT');
    }
    if (byRowHint.has(assignment.currentRowHint)) {
      throw new IncrementalLineagePlanError('DUPLICATE_ASSIGNMENT_ROW_HINT');
    }
    if (!UUID_PATTERN.test(assignment.sourceRecordId)) {
      throw new IncrementalLineagePlanError('INVALID_SOURCE_RECORD_ID');
    }
    const sourceRecordId = assignment.sourceRecordId.toLowerCase();
    if (assignedIds.has(sourceRecordId)) {
      throw new IncrementalLineagePlanError('DUPLICATE_ASSIGNMENT_SOURCE_RECORD_ID');
    }
    if (previousIds.has(sourceRecordId)) {
      throw new IncrementalLineagePlanError('ASSIGNMENT_SOURCE_RECORD_ID_COLLISION');
    }
    assignedIds.add(sourceRecordId);
    byRowHint.set(assignment.currentRowHint, sourceRecordId);
  }

  return byRowHint;
}

function freezeDiffOutcome(
  operation: SequenceDiffOperation,
  assignmentByRowHint: ReadonlyMap<number, string>,
): IncrementalLineageOutcome {
  if (operation.kind === 'INSERTED') {
    const sourceRecordId = assignmentByRowHint.get(operation.currentRowHint);
    if (sourceRecordId === undefined) {
      throw new IncrementalLineagePlanError('MISSING_INSERTED_SOURCE_RECORD_ASSIGNMENT');
    }
    return Object.freeze({
      ...operation,
      sourceRecordId,
    });
  }

  if (operation.kind === 'AMBIGUOUS_BLOCK') {
    return Object.freeze({
      ...operation,
      previousSourceRecordIds: Object.freeze([...operation.previousSourceRecordIds]),
      previousRowHints: Object.freeze([...operation.previousRowHints]),
      currentRowHints: Object.freeze([...operation.currentRowHints]),
    });
  }

  return Object.freeze({ ...operation });
}

export function buildIncrementalLineagePlan(
  previousInput: readonly Readonly<PreviousSequenceRow>[],
  currentInput: readonly Readonly<CurrentSequenceRow>[],
  assignments: readonly Readonly<IncrementalNewSourceRecordAssignment>[],
): Readonly<IncrementalLineagePlan> {
  const previous = validatePrevious(previousInput);
  const current = validateCurrent(currentInput);
  const previousIds = new Set(previous.map((row) => row.sourceRecordId));
  const assignmentByRowHint = validateAssignments(assignments, previousIds);
  const diff = diffSequences(previous, current);
  const insertedHints = new Set(
    diff.filter((operation) => operation.kind === 'INSERTED').map((operation) => operation.currentRowHint),
  );

  for (const rowHint of assignmentByRowHint.keys()) {
    if (!insertedHints.has(rowHint)) {
      throw new IncrementalLineagePlanError('EXTRA_INSERTED_SOURCE_RECORD_ASSIGNMENT');
    }
  }

  const outcomes = Object.freeze(diff.map((operation) => freezeDiffOutcome(operation, assignmentByRowHint)));
  const rowsNew = outcomes.filter((outcome) => outcome.kind === 'INSERTED').length;
  const rowsChanged = outcomes.filter((outcome) => outcome.kind === 'REVISED').length;
  const rowsMissing = outcomes.filter((outcome) => outcome.kind === 'MISSING').length;
  const rowsAmbiguous = outcomes.reduce(
    (count, outcome) => count + (outcome.kind === 'AMBIGUOUS_BLOCK' ? outcome.currentRowHints.length : 0),
    0,
  );

  return Object.freeze({
    outcomes,
    counters: Object.freeze({
      rowsSeen: current.length,
      rowsNew,
      rowsChanged,
      rowsMissing,
      rowsAmbiguous,
    }),
  });
}
