import test from 'node:test';
import assert from 'node:assert/strict';
import { markReviewRequired, resolveReviewItem } from '../../dist/migration/resolution.js';
import {
  ResolutionEffectPlanError,
  planResolutionEffect,
} from '../../dist/migration/resolutionEffectPlan.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000001501';
const LINKED_TX_ID = '00000000-0000-0000-0000-000000001502';
const TARGET_TX_ID = '00000000-0000-0000-0000-000000001503';

function expense(overrides = {}) {
  return {
    type: 'EXPENSE',
    occurredOn: '2026-09-07',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 12345,
    currency: 'RUB',
    fromAccountId: '00000000-0000-0000-0000-000000001504',
    toAccountId: null,
    categoryId: '00000000-0000-0000-0000-000000001505',
    paidByMemberId: null,
    description: 'Synthetic correction',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
    ...overrides,
  };
}

test('RESOLVED_NO_CHANGE is a pure no-op even without a linked transaction', () => {
  const item = markReviewRequired(SOURCE_ID, 'AMBIGUOUS', null);
  const plan = planResolutionEffect(item, { resolutionCode: 'RESOLVED_NO_CHANGE' });

  assert.deepEqual(plan, {
    sourceRecordId: SOURCE_ID,
    resolutionCode: 'RESOLVED_NO_CHANGE',
    transactionEffect: { kind: 'NONE' },
    sourceLinkEffect: { kind: 'KEEP' },
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.transactionEffect), true);
  assert.equal(Object.isFrozen(plan.sourceLinkEffect), true);
});

test('KEEP_CANONICAL requires an existing exact linked transaction', () => {
  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'MISSING', null),
      { resolutionCode: 'KEEP_CANONICAL' },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'LINKED_TRANSACTION_REQUIRED',
  );
});

test('VOID_CANONICAL_CONFIRMED plans only exact linked transaction plus optimistic version', () => {
  const plan = planResolutionEffect(
    markReviewRequired(SOURCE_ID, 'MISSING', LINKED_TX_ID),
    { resolutionCode: 'VOID_CANONICAL_CONFIRMED', expectedTransactionVersion: 7 },
  );

  assert.deepEqual(plan.transactionEffect, {
    kind: 'VOID',
    transactionId: LINKED_TX_ID,
    expectedVersion: 7,
  });
  assert.deepEqual(plan.sourceLinkEffect, { kind: 'KEEP' });
});

test('RELINK_SOURCE requires an explicit different target and source revision', () => {
  const plan = planResolutionEffect(
    markReviewRequired(SOURCE_ID, 'AMBIGUOUS', LINKED_TX_ID),
    {
      resolutionCode: 'RELINK_SOURCE',
      targetTransactionId: TARGET_TX_ID,
      expectedSourceRevision: 4,
    },
  );

  assert.deepEqual(plan.transactionEffect, { kind: 'NONE' });
  assert.deepEqual(plan.sourceLinkEffect, {
    kind: 'RELINK',
    targetTransactionId: TARGET_TX_ID,
    expectedSourceRevision: 4,
  });

  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'AMBIGUOUS', LINKED_TX_ID),
      {
        resolutionCode: 'RELINK_SOURCE',
        targetTransactionId: LINKED_TX_ID.toUpperCase(),
        expectedSourceRevision: 4,
      },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'RELINK_TARGET_UNCHANGED',
  );

  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'AMBIGUOUS', LINKED_TX_ID),
      {
        resolutionCode: 'RELINK_SOURCE',
        targetTransactionId: 'not-a-uuid',
        expectedSourceRevision: 4,
      },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'INVALID_TARGET_TRANSACTION_ID',
  );
});

test('ACCEPT_SOURCE_CORRECTION uses an explicit validated canonical candidate and expected version', () => {
  const candidate = expense();
  const plan = planResolutionEffect(
    markReviewRequired(SOURCE_ID, 'AMBIGUOUS', LINKED_TX_ID),
    {
      resolutionCode: 'ACCEPT_SOURCE_CORRECTION',
      expectedTransactionVersion: 8,
      canonicalTransaction: candidate,
      categoryKind: 'EXPENSE',
    },
  );

  assert.equal(plan.transactionEffect.kind, 'REPLACE');
  assert.equal(plan.transactionEffect.transactionId, LINKED_TX_ID);
  assert.equal(plan.transactionEffect.expectedVersion, 8);
  assert.deepEqual(plan.transactionEffect.canonicalTransaction, candidate);
  assert.equal(Object.isFrozen(plan.transactionEffect.canonicalTransaction), true);
});

test('correction requires explicit category context for categorized transaction types', () => {
  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'AMBIGUOUS', LINKED_TX_ID),
      {
        resolutionCode: 'ACCEPT_SOURCE_CORRECTION',
        expectedTransactionVersion: 2,
        canonicalTransaction: expense(),
        categoryKind: null,
      },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'CANONICAL_TRANSACTION_INVALID',
  );
});

test('invalid correction candidate fails closed before any persistence layer', () => {
  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'AMBIGUOUS', LINKED_TX_ID),
      {
        resolutionCode: 'ACCEPT_SOURCE_CORRECTION',
        expectedTransactionVersion: 2,
        canonicalTransaction: expense({ amountMinor: 0 }),
        categoryKind: 'EXPENSE',
      },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'CANONICAL_TRANSACTION_INVALID',
  );
});

test('invalid identities and optimistic preconditions fail closed', () => {
  assert.throws(
    () => planResolutionEffect(
      markReviewRequired('not-a-uuid', 'MISSING', null),
      { resolutionCode: 'RESOLVED_NO_CHANGE' },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'INVALID_SOURCE_RECORD_ID',
  );

  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'MISSING', LINKED_TX_ID),
      { resolutionCode: 'VOID_CANONICAL_CONFIRMED', expectedTransactionVersion: 0 },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'INVALID_EXPECTED_TRANSACTION_VERSION',
  );

  assert.throws(
    () => planResolutionEffect(
      markReviewRequired(SOURCE_ID, 'AMBIGUOUS', null),
      {
        resolutionCode: 'RELINK_SOURCE',
        targetTransactionId: TARGET_TX_ID,
        expectedSourceRevision: Number.NaN,
      },
    ),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'INVALID_EXPECTED_SOURCE_REVISION',
  );
});

test('already-resolved review item cannot be replanned', () => {
  const resolved = resolveReviewItem(
    markReviewRequired(SOURCE_ID, 'MISSING', LINKED_TX_ID),
    'KEEP_CANONICAL',
    { resolvedAt: '2026-09-07T04:40:00.000Z', resolvedBy: 'OWNER' },
  );

  assert.throws(
    () => planResolutionEffect(resolved, { resolutionCode: 'KEEP_CANONICAL' }),
    (error) => error instanceof ResolutionEffectPlanError
      && error.code === 'REVIEW_ITEM_NOT_PENDING',
  );
});
