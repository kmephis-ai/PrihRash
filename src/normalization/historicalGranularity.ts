import type { DatePrecision, RecordGranularity } from '../domain/transaction.js';

export interface InitialSnapshotGranularityEvidence {
  coarseExpenseOrdinalRange: {
    startInclusive: number;
    endExclusive: number;
  };
}

export interface HistoricalGranularityInput {
  operationType: string | null;
  initialSourceOrdinal: number | null;
  isPositiveFinancialCandidate: boolean;
}

export interface HistoricalGranularityResult {
  recordGranularity: RecordGranularity;
  datePrecision: DatePrecision;
}

export function classifyHistoricalGranularity(
  input: HistoricalGranularityInput,
  evidence: InitialSnapshotGranularityEvidence,
): HistoricalGranularityResult {
  if (!input.isPositiveFinancialCandidate || input.operationType !== 'Расход') {
    return { recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' };
  }

  if (input.initialSourceOrdinal === null) {
    return { recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' };
  }

  const { startInclusive, endExclusive } = evidence.coarseExpenseOrdinalRange;
  if (input.initialSourceOrdinal >= startInclusive && input.initialSourceOrdinal < endExclusive) {
    return { recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH' };
  }

  return { recordGranularity: 'TRANSACTION', datePrecision: 'DAY' };
}
