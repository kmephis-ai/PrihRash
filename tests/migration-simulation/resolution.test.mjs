import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResolutionContractError,
  hasCompleteResolutionAudit,
  markReviewRequired,
  resolveReviewItem,
} from '../../dist/migration/resolution.js';

const AUDIT = {
  resolvedAt: '2026-09-07T04:00:00.000Z',
  resolvedBy: 'OWNER',
};

test('MISSING source record keeps canonical transaction until explicit resolution', () => {
  const item = markReviewRequired('source-1', 'MISSING', 'transaction-1');
  assert.equal(item.transactionId, 'transaction-1');
  assert.equal(item.reviewState, 'REVIEW_REQUIRED');
  assert.equal(item.resolutionCode, null);
  assert.equal(item.resolvedAt, null);
  assert.equal(item.resolvedBy, null);
  assert.equal(hasCompleteResolutionAudit(item), false);
});

test('resolution records explicit audit metadata without mutating transaction link', () => {
  const unresolved = markReviewRequired('source-1', 'AMBIGUOUS', 'transaction-1');
  const resolved = resolveReviewItem(unresolved, 'KEEP_CANONICAL', AUDIT);

  assert.equal(resolved.reviewState, 'RESOLVED');
  assert.equal(resolved.resolutionCode, 'KEEP_CANONICAL');
  assert.equal(resolved.resolvedAt, AUDIT.resolvedAt);
  assert.equal(resolved.resolvedBy, AUDIT.resolvedBy);
  assert.equal(resolved.transactionId, 'transaction-1');
  assert.equal(hasCompleteResolutionAudit(resolved), true);
});

test('repeat resolution fails closed', () => {
  const resolved = resolveReviewItem(
    markReviewRequired('source-1', 'AMBIGUOUS', 'transaction-1'),
    'KEEP_CANONICAL',
    AUDIT,
  );

  assert.throws(
    () => resolveReviewItem(resolved, 'RESOLVED_NO_CHANGE', AUDIT),
    (error) => error instanceof ResolutionContractError && error.code === 'ALREADY_RESOLVED',
  );
});

test('partial resolution metadata on REVIEW_REQUIRED item fails closed', () => {
  const inconsistent = {
    ...markReviewRequired('source-1', 'MISSING', 'transaction-1'),
    resolvedBy: 'OWNER',
  };

  assert.throws(
    () => resolveReviewItem(inconsistent, 'KEEP_CANONICAL', AUDIT),
    (error) =>
      error instanceof ResolutionContractError && error.code === 'INCONSISTENT_REVIEW_STATE',
  );
});

test('resolution requires a non-empty actor', () => {
  const unresolved = markReviewRequired('source-1', 'AMBIGUOUS', null);

  assert.throws(
    () => resolveReviewItem(unresolved, 'RESOLVED_NO_CHANGE', { ...AUDIT, resolvedBy: '   ' }),
    (error) => error instanceof ResolutionContractError && error.code === 'INVALID_RESOLVED_BY',
  );
});

test('resolution requires a valid timestamp', () => {
  const unresolved = markReviewRequired('source-1', 'AMBIGUOUS', null);

  assert.throws(
    () => resolveReviewItem(unresolved, 'RESOLVED_NO_CHANGE', { ...AUDIT, resolvedAt: 'not-a-date' }),
    (error) => error instanceof ResolutionContractError && error.code === 'INVALID_RESOLVED_AT',
  );
});
