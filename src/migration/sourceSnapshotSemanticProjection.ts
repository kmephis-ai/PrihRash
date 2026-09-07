import {
  classifyLegacyPeriodCloseRows,
  type LegacyPeriodCloseClassification,
} from '../classification/legacyPeriodClose.js';
import {
  classifyMeaningfulSourceRow,
  type SourceRowClassification,
} from '../classification/sourceRow.js';
import type { CanonicalTransaction } from '../domain/transaction.js';
import type { InitialSnapshotGranularityEvidence } from '../normalization/historicalGranularity.js';
import type { ReferenceResolver } from '../normalization/types.js';
import {
  projectInitialFinancialTransaction,
  type InitialFinancialProjectionErrorCode,
} from './initialFinancialProjection.js';
import {
  decodeRawPayloadForSourceClassification,
  toLegacyPeriodCloseSourceRow,
  toSourceRowClassificationInput,
} from './rawPayloadClassificationAdapter.js';
import type {
  RawPayloadDecodeErrorCode,
  RawPayloadV2,
} from './rawPayloadDecoder.js';

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

function validateRows(rows: readonly SourceSnapshotSemanticRowInput[]): void {
  const ordinals = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.sourceOrdinal) || row.sourceOrdinal < 0) {
      throw new SourceSnapshotSemanticProjectionStructuralError('INVALID_SOURCE_ORDINAL');
    }
    if (ordinals.has(row.sourceOrdinal)) {
      throw new SourceSnapshotSemanticProjectionStructuralError('DUPLICATE_SOURCE_ORDINAL');
    }
    ordinals.add(row.sourceOrdinal);
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
  validateRows(rows);

  const decodedByOrdinal = new Map<number, ReturnType<typeof decodeRawPayloadForSourceClassification>>();
  const closeInputs = [];

  for (const row of rows) {
    const decoded = decodeRawPayloadForSourceClassification(row.rawPayload);
    decodedByOrdinal.set(row.sourceOrdinal, decoded);
    if (decoded.ok) closeInputs.push(toLegacyPeriodCloseSourceRow(row.sourceOrdinal, decoded.value));
  }

  const closeByOrdinal = new Map(
    classifyLegacyPeriodCloseRows(closeInputs).map((result) => [result.snapshotOrdinal, result] as const),
  );

  const outcomes = rows.map((row): Readonly<SourceSnapshotSemanticOutcome> => {
    const decoded = decodedByOrdinal.get(row.sourceOrdinal);
    if (decoded === undefined || !decoded.ok) {
      return Object.freeze({
        sourceOrdinal: row.sourceOrdinal,
        classification: 'INVALID' as const,
        legacyPeriodCloseClassification: null,
        transaction: null,
        projectionError: Object.freeze({
          stage: 'DECODE' as const,
          errorCode: decoded?.errorCode ?? 'INVALID_PAYLOAD_SCHEMA',
        }),
      });
    }

    const closeClassification = closeByOrdinal.get(row.sourceOrdinal)?.classification ?? 'NOT_APPLICABLE';
    const classification = classifyMeaningfulSourceRow(
      toSourceRowClassificationInput(decoded.value, closeClassification),
    );

    if (classification !== 'FINANCIAL_RECORD') {
      return Object.freeze({
        sourceOrdinal: row.sourceOrdinal,
        classification,
        legacyPeriodCloseClassification: closeClassification,
        transaction: null,
        projectionError: null,
      });
    }

    const projected = projectInitialFinancialTransaction({
      rawPayload: row.rawPayload,
      initialSourceOrdinal: row.sourceOrdinal,
      aggregatePeriodMonth: row.aggregatePeriodMonth,
    }, context);

    if (!projected.ok) {
      return Object.freeze({
        sourceOrdinal: row.sourceOrdinal,
        classification,
        legacyPeriodCloseClassification: closeClassification,
        transaction: null,
        projectionError: Object.freeze({
          stage: projected.stage,
          errorCode: projected.errorCode,
        }),
      });
    }

    return Object.freeze({
      sourceOrdinal: row.sourceOrdinal,
      classification,
      legacyPeriodCloseClassification: closeClassification,
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
