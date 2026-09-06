import test from 'node:test';
import assert from 'node:assert/strict';
import { markReviewRequired, resolveReviewItem } from '../../dist/migration/resolution.js';

test('MISSING source record keeps canonical transaction until explicit resolution', () => {
  const item = markReviewRequired('source-1', 'MISSING', 'transaction-1');
  assert.equal(item.transactionId, 'transaction-1');
  assert.equal(item.reviewState, 'REVIEW_REQUIRED');
  assert.equal(item.resolutionCode, null);
});

test('resolution is explicit and auditable by code', () => {
  const unresolved = markReviewRequired('source-1', 'AMBIGUOUS', 'transaction-1');
  const resolved = resolveReviewItem(unresolved, 'KEEP_CANONICAL');
  assert.equal(resolved.reviewState, 'RESOLVED');
  assert.equal(resolved.resolutionCode, 'KEEP_CANONICAL');
  assert.equal(resolved.transactionId, 'transaction-1');
});
