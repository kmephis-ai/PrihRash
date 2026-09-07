import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncrementalTransactionCurrentCandidatePlan } from '../../dist/migration/incrementalTransactionCurrentCandidate.js';
import { id, transaction } from './incremental-source-current-candidate-fixtures.mjs';

const previous = (n, version = 1, amount = n * 1000) => Object.freeze({ id: id(100 + n), transaction: transaction(amount), version });
const source = (n, classification, transactionId, state = null) => Object.freeze({ id: id(n), classification, transactionId, state });

test('assembles full transaction candidate while preserving canonical history and applying only create/correction mutations', () => {
  const previousTransactions = [
    previous(1), previous(2, 2), previous(3, 4), previous(4), previous(5, 3), previous(6, 7), previous(7),
  ];
  const sourcePlan = Object.freeze({
    sourceRecords: Object.freeze([
      source(1, 'FINANCIAL_RECORD', id(101)),
      source(2, 'FINANCIAL_RECORD', id(102)),
      source(3, 'FINANCIAL_RECORD', id(103)),
      source(4, 'AMBIGUOUS', id(104)),
      source(5, 'FINANCIAL_RECORD', id(105), 'MISSING'),
      source(6, 'AMBIGUOUS', id(106), 'MISSING'),
      source(7, 'FINANCIAL_RECORD', id(107)),
      source(8, 'FINANCIAL_RECORD', id(108)),
      source(9, 'NON_FINANCIAL', null),
      source(10, 'AMBIGUOUS', null),
    ]),
    promotionBlocker: 'UNRESOLVED_LINEAGE',
    unresolvedRowHints: Object.freeze([71]),
  });
  const transition = Object.freeze({
    decisions: Object.freeze([
      Object.freeze({ kind: 'TOUCH_PRESERVE', sourceRecordId: id(1), classification: 'FINANCIAL_RECORD' }),
      Object.freeze({ kind: 'OWNER_CORRECTION_REPLACE_CANDIDATE', sourceRecordId: id(2), transactionId: id(102), expectedTransactionVersion: 2, transaction: transaction(2222) }),
      Object.freeze({ kind: 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL', sourceRecordId: id(3), transactionId: id(103) }),
      Object.freeze({ kind: 'REVIEW_REQUIRED_PRESERVE', sourceRecordId: id(4), reason: 'AMBIGUOUS_CHANGE', previousClassification: 'FINANCIAL_RECORD', currentClassification: 'NON_FINANCIAL', transactionId: id(104), changeClass: 'AMBIGUOUS_CHANGE' }),
      Object.freeze({ kind: 'MARK_MISSING_PRESERVE_CANONICAL', sourceRecordId: id(5), transactionId: id(105) }),
      Object.freeze({ kind: 'CREATE_FINANCIAL_CANDIDATE', sourceRecordId: id(8), transaction: transaction(8888), transactionIdentityAssignmentRequired: true }),
      Object.freeze({ kind: 'CREATE_SOURCE_ONLY', sourceRecordId: id(9), classification: 'NON_FINANCIAL' }),
      Object.freeze({ kind: 'CREATE_REVIEW_REQUIRED', sourceRecordId: id(10), classification: 'AMBIGUOUS' }),
    ]),
    unresolvedObservations: Object.freeze([{ currentRowHint: 71, sourceOrdinal: 7, classification: 'AMBIGUOUS', blocksValidation: false }]),
  });

  const result = buildIncrementalTransactionCurrentCandidatePlan(previousTransactions, transition, sourcePlan);
  assert.equal(result.promotionBlocker, 'UNRESOLVED_LINEAGE');
  assert.equal(result.transactions.length, 8);
  const byId = new Map(result.transactions.map((item) => [item.id, item]));
  assert.equal(byId.get(id(102)).version, 3);
  assert.equal(byId.get(id(102)).transaction.amountMinor, 2222);
  assert.equal(byId.get(id(103)).version, 4);
  assert.equal(byId.get(id(104)).version, 1);
  assert.equal(byId.get(id(105)).version, 3);
  assert.equal(byId.get(id(106)).version, 7);
  assert.equal(byId.get(id(107)).version, 1);
  assert.equal(byId.get(id(108)).version, 1);
  assert.equal(byId.get(id(108)).transaction.amountMinor, 8888);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.transactions), true);
  assert.equal(Object.isFrozen(byId.get(id(108)).transaction), true);
});
