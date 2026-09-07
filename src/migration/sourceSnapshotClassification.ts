import {
  classifyLegacyPeriodCloseRows,
  type LegacyPeriodCloseClassification,
} from '../classification/legacyPeriodClose.js';
import {
  classifyMeaningfulSourceRow,
  type SourceRowClassification,
} from '../classification/sourceRow.js';
import {
  decodeRawPayloadForSourceClassification,
  toLegacyPeriodCloseSourceRow,
  toSourceRowClassificationInput,
} from './rawPayloadClassificationAdapter.js';
import type { RawPayloadDecodeErrorCode, RawPayloadV2 } from './rawPayloadDecoder.js';

export interface SourceSnapshotClassificationRowInput {
  readonly sourceOrdinal: number;
  readonly rawPayload: RawPayloadV2;
}

export interface SourceSnapshotClassificationOutcome {
  readonly sourceOrdinal: number;
  readonly classification: SourceRowClassification;
  readonly legacyPeriodCloseClassification: LegacyPeriodCloseClassification | null;
  readonly decodeErrorCode: RawPayloadDecodeErrorCode | null;
}

export interface SourceSnapshotClassificationCounters {
  readonly rowsSeen: number;
  readonly financialRecords: number;
  readonly legacyPeriodClose: number;
  readonly nonFinancial: number;
  readonly invalid: number;
  readonly ambiguous: number;
}

export interface SourceSnapshotClassification {
  readonly outcomes: readonly Readonly<SourceSnapshotClassificationOutcome>[];
  readonly counters: Readonly<SourceSnapshotClassificationCounters>;
}

export type SourceSnapshotClassificationStructuralErrorCode =
  | 'INVALID_SOURCE_ORDINAL'
  | 'DUPLICATE_SOURCE_ORDINAL';

export class SourceSnapshotClassificationStructuralError extends Error {
  readonly code: SourceSnapshotClassificationStructuralErrorCode;

  constructor(code: SourceSnapshotClassificationStructuralErrorCode) {
    super(code);
    this.name = 'SourceSnapshotClassificationStructuralError';
    this.code = code;
  }
}

function validateRows(rows: readonly SourceSnapshotClassificationRowInput[]): void {
  const ordinals = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.sourceOrdinal) || row.sourceOrdinal < 0) {
      throw new SourceSnapshotClassificationStructuralError('INVALID_SOURCE_ORDINAL');
    }
    if (ordinals.has(row.sourceOrdinal)) {
      throw new SourceSnapshotClassificationStructuralError('DUPLICATE_SOURCE_ORDINAL');
    }
    ordinals.add(row.sourceOrdinal);
  }
}

function buildCounters(
  outcomes: readonly Readonly<SourceSnapshotClassificationOutcome>[],
): Readonly<SourceSnapshotClassificationCounters> {
  const count = (classification: SourceRowClassification) => outcomes
    .filter((outcome) => outcome.classification === classification).length;
  return Object.freeze({
    rowsSeen: outcomes.length,
    financialRecords: count('FINANCIAL_RECORD'),
    legacyPeriodClose: count('LEGACY_PERIOD_CLOSE'),
    nonFinancial: count('NON_FINANCIAL'),
    invalid: count('INVALID'),
    ambiguous: count('AMBIGUOUS'),
  });
}

export function classifySourceSnapshot(
  rows: readonly SourceSnapshotClassificationRowInput[],
): Readonly<SourceSnapshotClassification> {
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

  const outcomes = rows.map((row): Readonly<SourceSnapshotClassificationOutcome> => {
    const decoded = decodedByOrdinal.get(row.sourceOrdinal);
    if (decoded === undefined || !decoded.ok) {
      return Object.freeze({
        sourceOrdinal: row.sourceOrdinal,
        classification: 'INVALID' as const,
        legacyPeriodCloseClassification: null,
        decodeErrorCode: decoded?.errorCode ?? 'INVALID_PAYLOAD_SCHEMA',
      });
    }

    const closeClassification = closeByOrdinal.get(row.sourceOrdinal)?.classification ?? 'NOT_APPLICABLE';
    const classification = classifyMeaningfulSourceRow(
      toSourceRowClassificationInput(decoded.value, closeClassification),
    );

    return Object.freeze({
      sourceOrdinal: row.sourceOrdinal,
      classification,
      legacyPeriodCloseClassification: closeClassification,
      decodeErrorCode: null,
    });
  });

  const frozenOutcomes = Object.freeze(outcomes);
  return Object.freeze({
    outcomes: frozenOutcomes,
    counters: buildCounters(frozenOutcomes),
  });
}
