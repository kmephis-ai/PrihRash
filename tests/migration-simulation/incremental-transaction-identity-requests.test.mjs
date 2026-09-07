import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIncrementalTransactionIdentityAssignmentRequests } from '../../dist/migration/incrementalTransactionIdentityRequests.js';

const SOURCE_A = '00000000-0000-0000-0000-000000007001';
const SOURCE_B = '00000000-0000-0000-0000-000000007002';
const SOURCE_C = '00000000-0000-0000-0000-000000007003';

function plan(decisions) {
  return Object.freeze({
    decisions: Object.freeze(decisions.map((decision) => Object.freeze(decision))),
    unresolvedObservations: Object.freeze([]),
  });
}

test('returns deterministic immutable requests only for create-financial candidates', () => {
  const transition = plan([
    {
      kind: 'CREATE_FINANCIAL_CANDIDATE',
      sourceRecordId: SOURCE_A.toUpperCase(),
      transaction: Object.freeze({ description: 'synthetic-a' }),
      transactionIdentityAssignmentRequired: true,
    },
    {
      kind: 'CREATE_SOURCE_ONLY',
      sourceRecordId: SOURCE_C,
      classification: 'NON_FINANCIAL',
    },
    {
      kind: 'CREATE_FINANCIAL_CANDIDATE',
      sourceRecordId: SOURCE_B,
      transaction: Object.freeze({ description: 'synthetic-b' }),
      transactionIdentityAssignmentRequired: true,
    },
  ]);

  const requests = buildIncrementalTransactionIdentityAssignmentRequests(transition);

  assert.deepEqual(requests, [
    { sourceRecordId: SOURCE_A },
    { sourceRecordId: SOURCE_B },
  ]);
  assert.equal(Object.isFrozen(requests), true);
  assert.equal(Object.isFrozen(requests[0]), true);
  assert.equal(Object.isFrozen(requests[1]), true);
  assert.deepEqual(Object.keys(requests[0]), ['sourceRecordId']);
});

test('does not request identities for corrections, preserve, review, missing or blocked decisions', () => {
  const requests = buildIncrementalTransactionIdentityAssignmentRequests(plan([
    {
      kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE',
      sourceRecordId: SOURCE_A,
      transactionId: '00000000-0000-0000-0000-000000007101',
      expectedTransactionVersion: 1,
      transaction: Object.freeze({ description: 'replacement' }),
    },
    {
      kind: 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL',
      sourceRecordId: SOURCE_B,
      transactionId: '00000000-0000-0000-0000-000000007102',
    },
    {
      kind: 'CREATE_REVIEW_REQUIRED',
      sourceRecordId: SOURCE_C,
      classification: 'AMBIGUOUS',
    },
    {
      kind: 'MARK_MISSING_PRESERVE_CANONICAL',
      sourceRecordId: SOURCE_A,
      transactionId: null,
    },
    {
      kind: 'BLOCK_VALIDATION',
      sourceRecordId: SOURCE_B,
      reason: 'FINANCIAL_PROJECTION_BLOCKED',
    },
  ]));

  assert.deepEqual(requests, []);
});

test('request content is independent of financial candidate payload', () => {
  const first = buildIncrementalTransactionIdentityAssignmentRequests(plan([{
    kind: 'CREATE_FINANCIAL_CANDIDATE',
    sourceRecordId: SOURCE_A,
    transaction: Object.freeze({ amountMinor: 100, occurredOn: '2026-09-01', description: 'one' }),
    transactionIdentityAssignmentRequired: true,
  }]));
  const second = buildIncrementalTransactionIdentityAssignmentRequests(plan([{
    kind: 'CREATE_FINANCIAL_CANDIDATE',
    sourceRecordId: SOURCE_A,
    transaction: Object.freeze({ amountMinor: 999999, occurredOn: '2026-09-07', description: 'two' }),
    transactionIdentityAssignmentRequired: true,
  }]));

  assert.deepEqual(first, second);
  assert.deepEqual(first, [{ sourceRecordId: SOURCE_A }]);
});
