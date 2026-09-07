import { SOURCE_SHEET_NAME } from '../integration/google/sourceSchema.js';
import type { MigrationRun } from './migrationRunState.js';
import type { CurrentSequenceRow, PreviousSequenceRow } from './sequenceDiff.js';
import {
  buildIncrementalLineagePlan,
  type IncrementalLineagePlan,
  type IncrementalNewSourceRecordAssignment,
} from './incrementalLineagePlan.js';

export interface VerifiedSourceRecordLineageEvidence {
  readonly id: string;
  readonly sourceType: string;
  readonly sourceSheet: string;
  readonly lastRowHint: number;
  readonly currentDigest: string;
  readonly state: string | null;
  readonly currentRevision: number;
}

export interface IncrementalCommittedBaseline {
  readonly previousSequence: readonly Readonly<PreviousSequenceRow>[];
  readonly reservedSourceRecordIds: readonly string[];
}

export type IncrementalCommittedBaselineErrorCode =
  | 'RUN_NOT_COMMITTED'
  | 'INVALID_SOURCE_RECORD_ID'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'INVALID_SOURCE_TYPE'
  | 'INVALID_SOURCE_SHEET'
  | 'INVALID_SOURCE_STATE'
  | 'INVALID_ROW_HINT'
  | 'DUPLICATE_ACTIVE_ROW_HINT'
  | 'EMPTY_DIGEST'
  | 'INVALID_CURRENT_REVISION'
  | 'RESERVED_SOURCE_RECORD_ID_ASSIGNMENT';

export class IncrementalCommittedBaselineError extends Error {
  readonly code: IncrementalCommittedBaselineErrorCode;

  constructor(code: IncrementalCommittedBaselineErrorCode) {
    super(code);
    this.name = 'IncrementalCommittedBaselineError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function buildIncrementalCommittedBaseline(
  run: Readonly<MigrationRun>,
  records: readonly Readonly<VerifiedSourceRecordLineageEvidence>[],
): Readonly<IncrementalCommittedBaseline> {
  if (run.state !== 'COMMITTED' || run.finishedAt === null || run.errorCode !== null) {
    throw new IncrementalCommittedBaselineError('RUN_NOT_COMMITTED');
  }

  const sourceIds = new Set<string>();
  const activeRowHints = new Set<number>();
  const previousSequence: PreviousSequenceRow[] = [];
  const reservedSourceRecordIds: string[] = [];

  for (const record of records) {
    if (!UUID_PATTERN.test(record.id)) {
      throw new IncrementalCommittedBaselineError('INVALID_SOURCE_RECORD_ID');
    }
    const id = record.id.toLowerCase();
    if (sourceIds.has(id)) {
      throw new IncrementalCommittedBaselineError('DUPLICATE_SOURCE_RECORD_ID');
    }
    sourceIds.add(id);
    reservedSourceRecordIds.push(id);

    if (record.sourceType !== 'GOOGLE_SHEETS') {
      throw new IncrementalCommittedBaselineError('INVALID_SOURCE_TYPE');
    }
    if (record.sourceSheet !== SOURCE_SHEET_NAME) {
      throw new IncrementalCommittedBaselineError('INVALID_SOURCE_SHEET');
    }
    if (record.state !== null && record.state !== 'MISSING') {
      throw new IncrementalCommittedBaselineError('INVALID_SOURCE_STATE');
    }
    if (!Number.isSafeInteger(record.lastRowHint) || record.lastRowHint <= 0) {
      throw new IncrementalCommittedBaselineError('INVALID_ROW_HINT');
    }
    if (record.currentDigest.trim().length === 0) {
      throw new IncrementalCommittedBaselineError('EMPTY_DIGEST');
    }
    if (!Number.isSafeInteger(record.currentRevision) || record.currentRevision < 1) {
      throw new IncrementalCommittedBaselineError('INVALID_CURRENT_REVISION');
    }

    if (record.state === null) {
      if (activeRowHints.has(record.lastRowHint)) {
        throw new IncrementalCommittedBaselineError('DUPLICATE_ACTIVE_ROW_HINT');
      }
      activeRowHints.add(record.lastRowHint);
      previousSequence.push({
        sourceRecordId: id,
        rowHint: record.lastRowHint,
        digest: record.currentDigest,
      });
    }
  }

  previousSequence.sort((left, right) => left.rowHint - right.rowHint);
  reservedSourceRecordIds.sort();

  return Object.freeze({
    previousSequence: Object.freeze(previousSequence.map((row) => Object.freeze(row))),
    reservedSourceRecordIds: Object.freeze(reservedSourceRecordIds),
  });
}

export function buildIncrementalLineagePlanFromCommittedBaseline(
  baseline: Readonly<IncrementalCommittedBaseline>,
  current: readonly Readonly<CurrentSequenceRow>[],
  assignments: readonly Readonly<IncrementalNewSourceRecordAssignment>[],
): Readonly<IncrementalLineagePlan> {
  const reserved = new Set(baseline.reservedSourceRecordIds.map((id) => id.toLowerCase()));
  for (const assignment of assignments) {
    if (reserved.has(assignment.sourceRecordId.toLowerCase())) {
      throw new IncrementalCommittedBaselineError('RESERVED_SOURCE_RECORD_ID_ASSIGNMENT');
    }
  }
  return buildIncrementalLineagePlan(baseline.previousSequence, current, assignments);
}
