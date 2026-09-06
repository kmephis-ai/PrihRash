import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHistoricalGranularity } from '../../dist/normalization/historicalGranularity.js';

const evidence = {
  coarseExpenseOrdinalRange: { startInclusive: 8, endExclusive: 20 },
};

test('private bootstrap evidence can mark a proven coarse expense block', () => {
  assert.deepEqual(classifyHistoricalGranularity({
    operationType: 'Расход',
    initialSourceOrdinal: 12,
    isPositiveFinancialCandidate: true,
  }, evidence), { recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH' });
});

test('proven initial-snapshot expense outside coarse block is item-level', () => {
  assert.deepEqual(classifyHistoricalGranularity({
    operationType: 'Расход',
    initialSourceOrdinal: 25,
    isPositiveFinancialCandidate: true,
  }, evidence), { recordGranularity: 'TRANSACTION', datePrecision: 'DAY' });
});

test('new/unanchored source row is UNKNOWN instead of inheriting historical cutoff', () => {
  assert.deepEqual(classifyHistoricalGranularity({
    operationType: 'Расход',
    initialSourceOrdinal: null,
    isPositiveFinancialCandidate: true,
  }, evidence), { recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' });
});

test('income granularity is not guessed from expense evidence', () => {
  assert.deepEqual(classifyHistoricalGranularity({
    operationType: 'Доход',
    initialSourceOrdinal: 12,
    isPositiveFinancialCandidate: true,
  }, evidence), { recordGranularity: 'UNKNOWN', datePrecision: 'UNKNOWN' });
});
