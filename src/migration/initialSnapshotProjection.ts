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

function buildCounters(
  outcomes: readonly Readonly<InitialSnapshotProjectionOutcome>[],
): Readonly<InitialSnapshotProjectionCounters> {
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

export function projectInitialSnapshot(
  rows: readonly InitialSnapshotProjectionRowInput[],
  context: InitialSnapshotProjectionContext,
): Readonly<InitialSnapshotProjection> {
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

  const outcomes = rows.map((row): Readonly<InitialSnapshotProjectionOutcome> => {
    const decoded = decodedByOrdinal.get(row.sourceOrdinal);
    if (decoded === undefined || !decoded.ok) {
      return Object.freeze({
        sourceRecordId: row.sourceRecordId.toLowerCase(),
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
        sourceRecordId: row.sourceRecordId.toLowerCase(),
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
        sourceRecordId: row.sourceRecordId.toLowerCase(),
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
      sourceRecordId: row.sourceRecordId.toLowerCase(),
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
