import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncrementalCurrentDeltaPlan } from '../../dist/migration/incrementalCurrentDelta.js';
import { id, previous, transaction } from './incremental-source-current-candidate-fixtures.mjs';

const tx = (n, version = 1, amount = n * 1000) => Object.freeze({ id: id(100 + n), transaction: transaction(amount), version });

function sourceCandidate(record, overrides = {}) {
  return Object.freeze({ ...record, ...overrides });
}

function transactionCandidate(record, overrides = {}) {
  return Object.freeze({ ...record, ...overrides });
}

test('compiles only mechanical current-state mutations while preserving no-op verified rows', () => {
  const previousSources = [
    previous(1),
    previous(2, { currentRevision: 2 }),
    previous(3, { currentRevision: 3 }),
  ];
  const previousTransactions = [tx(1), tx(2, 2), tx(3, 5), tx(9, 7)];

  const sourcePlan = Object.freeze({
    sourceRecords: Object.freeze([
      sourceCandidate(previousSources[0]),
      sourceCandidate(previousSources[1], {
        lastSeenAt: '2026-09-07T08:14:00.000Z',
        lastRowHint: 21,
        currentDigest: 'new-2',
        currentRevision: 3,
      }),
      sourceCandidate(previousSources[2], { state: 'MISSING' }),
      Object.freeze({
        id: id(4), sourceType: 'GOOGLE_SHEETS', sourceSheet: 'Ответы на форму (11)',
        firstSeenAt: '2026-09-07T08:14:00.000Z', lastSeenAt: '2026-09-07T08:14:00.000Z',
        lastRowHint: 41, currentDigest: 'new-4', state: null, classification: 'FINANCIAL_RECORD',
        normalizationStatus: null, transactionId: id(104), currentRevision: 1,
        resolutionCode: null, resolvedAt: null, resolvedBy: null,
      }),
    ]),
    promotionBlocker: null,
    unresolvedRowHints: Object.freeze([]),
  });

  const transactionPlan = Object.freeze({
    transactions: Object.freeze([
      transactionCandidate(previousTransactions[0]),
      Object.freeze({ id: id(102), transaction: transaction(2222), version: 3 }),
      transactionCandidate(previousTransactions[2]),
      transactionCandidate(previousTransactions[3]),
      Object.freeze({ id: id(104), transaction: transaction(4444), version: 1 }),
    ]),
    promotionBlocker: null,
  });

  const result = buildIncrementalCurrentDeltaPlan(
    previousSources,
    previousTransactions,
    sourcePlan,
    transactionPlan,
  );

  assert.deepEqual(result.sourceIntents.map((item) => [item.kind, item.candidate.id]), [
    ['UPDATE_SOURCE_RECORD', id(2)],
    ['UPDATE_SOURCE_RECORD', id(3)],
    ['CREATE_SOURCE_RECORD', id(4)],
  ]);
  assert.deepEqual(result.transactionIntents.map((item) => [item.kind, item.candidate.id]), [
    ['REPLACE_TRANSACTION', id(102)],
    ['CREATE_TRANSACTION', id(104)],
  ]);
  const update = result.sourceIntents[0];
  assert.equal(update.kind, 'UPDATE_SOURCE_RECORD');
  assert.equal(update.expectedCurrentRevision, 2);
  assert.equal(update.expectedCurrentDigest, 'd-2');
  const replace = result.transactionIntents[0];
  assert.equal(replace.kind, 'REPLACE_TRANSACTION');
  assert.equal(replace.expectedVersion, 2);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.sourceIntents), true);
  assert.equal(Object.isFrozen(result.transactionIntents), true);
});

test('unresolved-lineage blocker is preserved while delta evidence remains buildable', () => {
  const source = previous(1);
  const oldTx = tx(1);
  const result = buildIncrementalCurrentDeltaPlan(
    [source],
    [oldTx],
    Object.freeze({ sourceRecords: Object.freeze([source]), promotionBlocker: 'UNRESOLVED_LINEAGE', unresolvedRowHints: Object.freeze([2]) }),
    Object.freeze({ transactions: Object.freeze([oldTx]), promotionBlocker: 'UNRESOLVED_LINEAGE' }),
  );
  assert.equal(result.promotionBlocker, 'UNRESOLVED_LINEAGE');
  assert.deepEqual(result.sourceIntents, []);
  assert.deepEqual(result.transactionIntents, []);
});
