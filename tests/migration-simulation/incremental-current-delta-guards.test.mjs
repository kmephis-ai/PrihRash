import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalCurrentDeltaError,
  buildIncrementalCurrentDeltaPlan,
} from '../../dist/migration/incrementalCurrentDelta.js';
import { id, previous, transaction } from './incremental-source-current-candidate-fixtures.mjs';

const tx = (n, version = 1, amount = n * 1000) => Object.freeze({ id: id(100 + n), transaction: transaction(amount), version });
const sourcePlan = (records, blocker = null) => Object.freeze({ sourceRecords: Object.freeze(records), promotionBlocker: blocker, unresolvedRowHints: Object.freeze([]) });
const txPlan = (records, blocker = null) => Object.freeze({ transactions: Object.freeze(records), promotionBlocker: blocker });
const expectCode = (fn, code) => assert.throws(fn, (e) => e instanceof IncrementalCurrentDeltaError && e.code === code);

test('source hard-delete is forbidden', () => {
  expectCode(
    () => buildIncrementalCurrentDeltaPlan([previous(1)], [], sourcePlan([]), txPlan([])),
    'SOURCE_RECORD_HARD_DELETE_FORBIDDEN',
  );
});

test('transaction hard-delete is forbidden', () => {
  expectCode(
    () => buildIncrementalCurrentDeltaPlan([], [tx(1)], sourcePlan([]), txPlan([])),
    'TRANSACTION_HARD_DELETE_FORBIDDEN',
  );
});

test('source identity provenance cannot mutate', () => {
  const old = previous(1);
  expectCode(
    () => buildIncrementalCurrentDeltaPlan(
      [old], [], sourcePlan([Object.freeze({ ...old, firstSeenAt: '2026-09-07T08:14:00.000Z' })]), txPlan([]),
    ),
    'SOURCE_RECORD_IMMUTABLE_FIELD_CHANGED',
  );
});

test('new transaction must start at version 1', () => {
  expectCode(
    () => buildIncrementalCurrentDeltaPlan(
      [], [], sourcePlan([]), txPlan([Object.freeze({ id: id(101), transaction: transaction(1000), version: 2 })]),
    ),
    'CREATE_TRANSACTION_VERSION_INVALID',
  );
});

test('version cannot advance without canonical payload change', () => {
  const old = tx(1, 3);
  expectCode(
    () => buildIncrementalCurrentDeltaPlan(
      [], [old], sourcePlan([]), txPlan([Object.freeze({ ...old, version: 4 })]),
    ),
    'TRANSACTION_VERSION_CHANGED_WITHOUT_PAYLOAD_CHANGE',
  );
});

test('canonical payload change requires exact +1 version', () => {
  const old = tx(1, 3);
  expectCode(
    () => buildIncrementalCurrentDeltaPlan(
      [], [old], sourcePlan([]), txPlan([Object.freeze({ id: old.id, transaction: transaction(9999), version: 5 })]),
    ),
    'TRANSACTION_PAYLOAD_CHANGED_WITHOUT_VERSION_INCREMENT',
  );
});

test('source and transaction promotion blockers must match', () => {
  expectCode(
    () => buildIncrementalCurrentDeltaPlan(
      [], [], sourcePlan([], 'UNRESOLVED_LINEAGE'), txPlan([], null),
    ),
    'PROMOTION_BLOCKER_MISMATCH',
  );
});

test('duplicate source and transaction identities fail closed', () => {
  const source = previous(1);
  expectCode(
    () => buildIncrementalCurrentDeltaPlan([source, source], [], sourcePlan([source]), txPlan([])),
    'DUPLICATE_PREVIOUS_SOURCE_RECORD_ID',
  );
  const oldTx = tx(1);
  expectCode(
    () => buildIncrementalCurrentDeltaPlan([], [oldTx, oldTx], sourcePlan([]), txPlan([oldTx])),
    'DUPLICATE_PREVIOUS_TRANSACTION_ID',
  );
});
