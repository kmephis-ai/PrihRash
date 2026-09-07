import type { LegacyPeriodCloseClassification } from '../classification/legacyPeriodClose.js';
import type { SourceRowClassification } from '../classification/sourceRow.js';
import type { CanonicalTransaction } from '../domain/transaction.js';
import type { InitialSnapshotGranularityEvidence } from '../normalization/historicalGranularity.js';
import type { ReferenceResolver } from '../normalization/types.js';
import {
  projectInitialFinancialTransaction,
  type InitialFinancialProjectionErrorCode,
} from './initialFinancialProjection.js';
import type { RawPayloadDecodeErrorCode, RawPayloadV2 } from './rawPayloadDecoder.js';
import {
  classifySourceSnapshot,
  SourceSnapshotClassificationStructuralError,
} from './sourceSnapshotClassification.js';

export interface SourceSnapshotSemanticRowInput {
  readonly sourceOrdinal: number;
  readonly rawPayload: RawPayloadV2;
  readonly aggregatePeriodMonth: string | null;
}

export interface SourceSnapshotSemanticProjectionContext {
  readonly granularityEvidence: InitialSnapshotGranularityEvidence;
  readonly refs: ReferenceResolver;
}

export interface SourceSnapshotSemanticProjectionError {
  readonly stage: 'DECODE' | 'GRANULARITY' | 'NORMALIZATION' | 'DOMAIN';
  readonly errorCode: RawPayloadDecodeErrorCode | InitialFinancialProjectionErrorCode;
}

export interface SourceSnapshotSemanticOutcome {
  readonly sourceOrdinal: number;
  readonly classification: SourceRowClassification;
  readonly legacyPeriodCloseClassification: LegacyPeriodCloseClassification | null;
  readonly transaction: Readonly<CanonicalTransaction> | null;
  readonly projectionError: Readonly<SourceSnapshotSemanticProjectionError> | null;
}

export interface SourceSnapshotSemanticCounters {
  readonly rowsSeen: number;
  readonly financialRecords: number;
  readonly legacyPeriodClose: number;
  readonly nonFinancial: number;
  readonly invalid: number;
  readonly ambiguous: number;
  readonly transactionCandidates: number;
  readonly projectionFailures: number;
}

export interface SourceSnapshotSemanticProjection {
  readonly outcomes: readonly Readonly<SourceSnapshotSemanticOutcome>[];
  readonly counters: Readonly<SourceSnapshotSemanticCounters>;
}

export type SourceSnapshotSemanticProjectionStructuralErrorCode =
  | 'INVALID_SOURCE_ORDINAL'
  | 'DUPLICATE_SOURCE_ORDINAL';

export class SourceSnapshotSemanticProjectionStructuralError extends Error {
  readonly code: SourceSnapshotSemanticProjectionStructuralErrorCode;

  constructor(code: SourceSnapshotSemanticProjectionStructuralErrorCode) {
    super(code);
    this.name = 'SourceSnapshotSemanticProjectionStructuralError';
    this.code = code;
  }
}

function buildCounters(
  outcomes: readonly Readonly<SourceSnapshotSemanticOutcome>[],
): Readonly<SourceSnapshotSemanticCounters> {
  const count = (classification: SourceRowClassification) => outcomes
    .filter((outcome) => outcome.classification === classification).length;
  return Object.freeze({
    rowsSeen: outcomes.length,
    financialRecords: count('FINANCIAL_RECORD'),
    legacyPeriodClose: count('LEGACY_PERIOD_CLOSE'),
    nonFinancial: count('NON_FINANCIAL'),
    invalid: count('INVALID'),
    ambiguous: count('AMBIGUOUS'),
    transactionCandidates: outcomes.filter((outcome) => outcome.transaction !== null).length,
    projectionFailures: outcomes.filter((outcome) => outcome.projectionError !== null).length,
  });
}

export function projectSourceSnapshotSemantics(
  rows: readonly SourceSnapshotSemanticRowInput[],
  context: SourceSnapshotSemanticProjectionContext,
): Readonly<SourceSnapshotSemanticProjection> {
  let classification;
  try {
    classification = classifySourceSnapshot(rows.map((row) => ({
      sourceOrdinal: row.sourceOrdinal,
      rawPayload: row.rawPayload,
    })));
  } catch (error) {
    if (error instanceof SourceSnapshotClassificationStructuralError) {
      throw new SourceSnapshotSemanticProjectionStructuralError(error.code);
    }
    throw error;
  }

  const rowByOrdinal = new Map(rows.map((row) => [row.sourceOrdinal, row] as const));
  const outcomes = classification.outcomes.map((classified): Readonly<SourceSnapshotSemanticOutcome> => {
    if (classified.decodeErrorCode !== null) {
      return Object.freeze({
        sourceOrdinal: classified.sourceOrdinal,
        classification: classified.classification,
        legacyPeriodCloseClassification: classified.legacyPeriodCloseClassification,
        transaction: null,
        projectionError: Object.freeze({
          stage: 'DECODE' as const,
          errorCode: classified.decodeErrorCode,
        }),
      });
    }

    if (classified.classification !== 'FINANCIAL_RECORD') {
      return Object.freeze({
        sourceOrdinal: classified.sourceOrdinal,
        classification: classified.classification,
        legacyPeriodCloseClassification: classified.legacyPeriodCloseClassification,
        transaction: null,
        projectionError: null,
      });
    }

    const row = rowByOrdinal.get(classified.sourceOrdinal);
    if (row === undefined) {
      throw new SourceSnapshotSemanticProjectionStructuralError('INVALID_SOURCE_ORDINAL');
    }
    const projected = projectInitialFinancialTransaction({
      rawPayload: row.rawPayload,
      initialSourceOrdinal: row.sourceOrdinal,
      aggregatePeriodMonth: row.aggregatePeriodMonth,
    }, context);

    if (!projected.ok) {
      return Object.freeze({
        sourceOrdinal: classified.sourceOrdinal,
        classification: classified.classification,
        legacyPeriodCloseClassification: classified.legacyPeriodCloseClassification,
        transaction: null,
        projectionError: Object.freeze({
          stage: projected.stage,
          errorCode: projected.errorCode,
        }),
      });
    }

    return Object.freeze({
      sourceOrdinal: classified.sourceOrdinal,
      classification: classified.classification,
      legacyPeriodCloseClassification: classified.legacyPeriodCloseClassification,
      transaction: projected.transaction,
      projectionError: null,
    });
  });

  const frozenOutcomes = Object.freeze(outcomes);
  return Object.freeze({
    outcomes: frozenOutcomes,
    counters: buildCounters(frozenOutcomes),
  });
}
