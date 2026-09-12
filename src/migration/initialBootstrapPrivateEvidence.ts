import type { InitialSnapshotGranularityEvidence } from '../normalization/historicalGranularity.js';

export interface InitialBootstrapAggregateMonthRange {
  readonly startInclusive: number;
  readonly endExclusive: number;
  readonly aggregatePeriodMonth: string;
}

export interface InitialBootstrapPrivateHistoricalEvidence {
  readonly granularityEvidence: Readonly<InitialSnapshotGranularityEvidence>;
  readonly aggregateMonthRanges: readonly Readonly<InitialBootstrapAggregateMonthRange>[];
  aggregatePeriodMonthForSourceOrdinal(sourceOrdinal: number): string | null;
  assertCompatibleRowCount(rowCount: number): void;
}

export type InitialBootstrapPrivateEvidenceErrorCode =
  | 'EVIDENCE_JSON_INVALID'
  | 'EVIDENCE_SHAPE_INVALID'
  | 'COARSE_RANGE_INVALID'
  | 'AGGREGATE_MONTH_RANGE_INVALID'
  | 'AGGREGATE_MONTH_INVALID'
  | 'AGGREGATE_MONTH_RANGE_COVERAGE_INVALID'
  | 'SOURCE_ROW_COUNT_INVALID'
  | 'COARSE_RANGE_OUTSIDE_SOURCE';

export class InitialBootstrapPrivateEvidenceError extends Error {
  readonly code: InitialBootstrapPrivateEvidenceErrorCode;

  constructor(code: InitialBootstrapPrivateEvidenceErrorCode) {
    super(code);
    this.name = 'InitialBootstrapPrivateEvidenceError';
    this.code = code;
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function canonicalMonth(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function parseRange(
  value: unknown,
  code: InitialBootstrapPrivateEvidenceErrorCode,
): Readonly<{ startInclusive: number; endExclusive: number }> {
  const object = record(value);
  if (object === null || !exactKeys(object, ['start_inclusive', 'end_exclusive'])) {
    throw new InitialBootstrapPrivateEvidenceError(code);
  }
  const startInclusive = nonNegativeSafeInteger(object.start_inclusive);
  const endExclusive = nonNegativeSafeInteger(object.end_exclusive);
  if (startInclusive === null || endExclusive === null || startInclusive >= endExclusive) {
    throw new InitialBootstrapPrivateEvidenceError(code);
  }
  return Object.freeze({ startInclusive, endExclusive });
}

function parseMonthRanges(
  value: unknown,
  coarseRange: Readonly<{ startInclusive: number; endExclusive: number }>,
): readonly Readonly<InitialBootstrapAggregateMonthRange>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InitialBootstrapPrivateEvidenceError('AGGREGATE_MONTH_RANGE_COVERAGE_INVALID');
  }

  const ranges = value.map((entry): Readonly<InitialBootstrapAggregateMonthRange> => {
    const object = record(entry);
    if (
      object === null
      || !exactKeys(object, ['start_inclusive', 'end_exclusive', 'aggregate_period_month'])
    ) {
      throw new InitialBootstrapPrivateEvidenceError('AGGREGATE_MONTH_RANGE_INVALID');
    }
    const range = parseRange({
      start_inclusive: object.start_inclusive,
      end_exclusive: object.end_exclusive,
    }, 'AGGREGATE_MONTH_RANGE_INVALID');
    const aggregatePeriodMonth = canonicalMonth(object.aggregate_period_month);
    if (aggregatePeriodMonth === null) {
      throw new InitialBootstrapPrivateEvidenceError('AGGREGATE_MONTH_INVALID');
    }
    return Object.freeze({ ...range, aggregatePeriodMonth });
  });

  let cursor = coarseRange.startInclusive;
  for (const range of ranges) {
    if (
      range.startInclusive !== cursor
      || range.startInclusive < coarseRange.startInclusive
      || range.endExclusive > coarseRange.endExclusive
    ) {
      throw new InitialBootstrapPrivateEvidenceError('AGGREGATE_MONTH_RANGE_COVERAGE_INVALID');
    }
    cursor = range.endExclusive;
  }
  if (cursor !== coarseRange.endExclusive) {
    throw new InitialBootstrapPrivateEvidenceError('AGGREGATE_MONTH_RANGE_COVERAGE_INVALID');
  }
  return Object.freeze(ranges);
}

export function parseInitialBootstrapPrivateHistoricalEvidence(
  serialized: string,
): Readonly<InitialBootstrapPrivateHistoricalEvidence> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new InitialBootstrapPrivateEvidenceError('EVIDENCE_JSON_INVALID');
  }

  const root = record(parsed);
  if (
    root === null
    || !exactKeys(root, ['schema_version', 'coarse_expense_ordinal_range', 'aggregate_period_month_ranges'])
    || root.schema_version !== 1
  ) {
    throw new InitialBootstrapPrivateEvidenceError('EVIDENCE_SHAPE_INVALID');
  }

  const coarseRange = parseRange(root.coarse_expense_ordinal_range, 'COARSE_RANGE_INVALID');
  const aggregateMonthRanges = parseMonthRanges(root.aggregate_period_month_ranges, coarseRange);
  const granularityEvidence = Object.freeze({
    coarseExpenseOrdinalRange: Object.freeze({ ...coarseRange }),
  });

  return Object.freeze({
    granularityEvidence,
    aggregateMonthRanges,
    aggregatePeriodMonthForSourceOrdinal(sourceOrdinal: number): string | null {
      if (!Number.isSafeInteger(sourceOrdinal) || sourceOrdinal < 0) {
        throw new InitialBootstrapPrivateEvidenceError('SOURCE_ROW_COUNT_INVALID');
      }
      const match = aggregateMonthRanges.find(
        (range) => sourceOrdinal >= range.startInclusive && sourceOrdinal < range.endExclusive,
      );
      return match?.aggregatePeriodMonth ?? null;
    },
    assertCompatibleRowCount(rowCount: number): void {
      if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
        throw new InitialBootstrapPrivateEvidenceError('SOURCE_ROW_COUNT_INVALID');
      }
      if (coarseRange.endExclusive > rowCount) {
        throw new InitialBootstrapPrivateEvidenceError('COARSE_RANGE_OUTSIDE_SOURCE');
      }
    },
  });
}
