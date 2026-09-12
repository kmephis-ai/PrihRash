import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InitialBootstrapPrivateEvidenceError,
  parseInitialBootstrapPrivateHistoricalEvidence,
} from '../../dist/migration/initialBootstrapPrivateEvidence.js';

function evidence(overrides = {}) {
  return JSON.stringify({
    schema_version: 1,
    coarse_expense_ordinal_range: { start_inclusive: 2, end_exclusive: 6 },
    aggregate_period_month_ranges: [
      { start_inclusive: 2, end_exclusive: 4, aggregate_period_month: '2024-01-01' },
      { start_inclusive: 4, end_exclusive: 6, aggregate_period_month: '2024-02-01' },
    ],
    ...overrides,
  });
}

test('private historical evidence maps exact covered ordinals without exposing a fallback guess', () => {
  const parsed = parseInitialBootstrapPrivateHistoricalEvidence(evidence());
  assert.deepEqual(parsed.granularityEvidence, {
    coarseExpenseOrdinalRange: { startInclusive: 2, endExclusive: 6 },
  });
  assert.equal(parsed.aggregatePeriodMonthForSourceOrdinal(1), null);
  assert.equal(parsed.aggregatePeriodMonthForSourceOrdinal(2), '2024-01-01');
  assert.equal(parsed.aggregatePeriodMonthForSourceOrdinal(5), '2024-02-01');
  assert.equal(parsed.aggregatePeriodMonthForSourceOrdinal(6), null);
  assert.doesNotThrow(() => parsed.assertCompatibleRowCount(6));
});

test('private historical evidence rejects gaps, overlap and non-canonical month values', () => {
  assert.throws(
    () => parseInitialBootstrapPrivateHistoricalEvidence(evidence({
      aggregate_period_month_ranges: [
        { start_inclusive: 2, end_exclusive: 3, aggregate_period_month: '2024-01-01' },
        { start_inclusive: 4, end_exclusive: 6, aggregate_period_month: '2024-02-01' },
      ],
    })),
    (error) => error instanceof InitialBootstrapPrivateEvidenceError
      && error.code === 'AGGREGATE_MONTH_RANGE_COVERAGE_INVALID',
  );
  assert.throws(
    () => parseInitialBootstrapPrivateHistoricalEvidence(evidence({
      aggregate_period_month_ranges: [
        { start_inclusive: 2, end_exclusive: 6, aggregate_period_month: '2024-02-29' },
      ],
    })),
    (error) => error instanceof InitialBootstrapPrivateEvidenceError
      && error.code === 'AGGREGATE_MONTH_INVALID',
  );
});

test('private historical evidence fails closed when private cutoff exceeds leased source', () => {
  const parsed = parseInitialBootstrapPrivateHistoricalEvidence(evidence());
  assert.throws(
    () => parsed.assertCompatibleRowCount(5),
    (error) => error instanceof InitialBootstrapPrivateEvidenceError
      && error.code === 'COARSE_RANGE_OUTSIDE_SOURCE',
  );
});
