import type { LegacyPeriodCloseClassification } from '../classification/legacyPeriodClose.js';
import type { SourceRowClassification } from '../classification/sourceRow.js';
import type { CanonicalTransaction } from '../domain/transaction.js';
import type { InitialSnapshotGranularityEvidence } from '../normalization/historicalGranularity.js';
import type { ReferenceResolver } from '../normalization/types.js';
import type { InitialFinancialProjectionErrorCode } from './initialFinancialProjection.js';
import type { RawPayloadDecodeErrorCode, RawPayloadV2 } from './rawPayloadDecoder.js';
import { projectSourceSnapshotSemantics } from './sourceSnapshotSemanticProjection.js';

export interface InitialSnapshotProjectionRowInput {
  readonly sourceRecordId: string;
  readonly sourceOrdinal: number;
  readonly rawPayload: RawPayloadV2;
  readonly aggregatePeriodMonth: string | null;
}

export interface InitialSnapshotProjectionContext {
  readonly granularityEvidence: InitialSnapshotGranularityEvidence;
  readonly refs: ReferenceResolver;
}

export interface InitialSnapshotProjectionError {
  readonly stage: 'DECODE' | 'GRANULARITY' | 'NORMALIZATION' | 'DOMAIN';
  readonly errorCode: RawPayloadDecodeErrorCode | InitialFinancialProjectionErrorCode;
}

export interface InitialSnapshotProjectionOutcome {
  readonly sourceRecordId: string;
  readonly sourceOrdinal: number;
  readonly classification: SourceRowClassification;
  readonly legacyPeriodCloseClassification: LegacyPeriodCloseClassification | null;
  readonly transaction: Readonly<CanonicalTransaction> | null;
  readonly projectionError: Readonly<InitialSnapshotProjectionError> | null;
}

export interface InitialSnapshotProjectionCounters {
  readonly rowsSeen: number;
  readonly financialRecords: number;
  readonly legacyPeriodClose: number;
  readonly nonFinancial: number;
  readonly invalid: number;
  readonly ambiguous: number;
  readonly transactionCandidates: number;
  readonly projectionFailures: number;
}

export interface InitialSnapshotProjection {
  readonly outcomes: readonly Readonly<InitialSnapshotProjectionOutcome>[];
  readonly counters: Readonly<InitialSnapshotProjectionCounters>;
}

export type InitialSnapshotProjectionStructuralErrorCode =
  | 'INVALID_SOURCE_ORDINAL'
  | 'DUPLICATE_SOURCE_ORDINAL'
  | 'DUPLICATE_SOURCE_RECORD_ID';

export class InitialSnapshotProjectionStructuralError extends Error {
  readonly code: InitialSnapshotProjectionStructuralErrorCode;

  constructor(code: InitialSnapshotProjectionStructuralErrorCode) {
    super(code);
    this.name = 'InitialSnapshotProjectionStructuralError';
    this.code = code;
  }
}

function validateRows(rows: readonly InitialSnapshotProjectionRowInput[]): void {
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.sourceOrdinal) || row.sourceOrdinal < 0) {
      throw new InitialSnapshotProjectionStructuralError('INVALID_SOURCE_ORDINAL');
    }
    if (ordinals.has(row.sourceOrdinal)) {
      throw new InitialSnapshotProjectionStructuralError('DUPLICATE_SOURCE_ORDINAL');
    }
    ordinals.add(row.sourceOrdinal);

    const normalizedId = row.sourceRecordId.toLowerCase();
    if (ids.has(normalizedId)) {
      throw new InitialSnapshotProjectionStructuralError('DUPLICATE_SOURCE_RECORD_ID');
    }
    ids.add(normalizedId);
  }
}

export function projectInitialSnapshot(
  rows: readonly InitialSnapshotProjectionRowInput[],
  context: InitialSnapshotProjectionContext,
): Readonly<InitialSnapshotProjection> {
  validateRows(rows);

  const semantic = projectSourceSnapshotSemantics(
    rows.map((row) => ({
      sourceOrdinal: row.sourceOrdinal,
      rawPayload: row.rawPayload,
      aggregatePeriodMonth: row.aggregatePeriodMonth,
    })),
    context,
  );

  const outcomes = semantic.outcomes.map((outcome, index): Readonly<InitialSnapshotProjectionOutcome> => {
    const row = rows[index];
    if (row === undefined || row.sourceOrdinal !== outcome.sourceOrdinal) {
      throw new InitialSnapshotProjectionStructuralError('INVALID_SOURCE_ORDINAL');
    }
    return Object.freeze({
      sourceRecordId: row.sourceRecordId.toLowerCase(),
      sourceOrdinal: outcome.sourceOrdinal,
      classification: outcome.classification,
      legacyPeriodCloseClassification: outcome.legacyPeriodCloseClassification,
      transaction: outcome.transaction,
      projectionError: outcome.projectionError,
    });
  });

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    counters: semantic.counters,
  });
}
