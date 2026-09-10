import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ExpenseEditError,
} from '../../dist/writer/optimisticExpenseEdit.js';
import {
  WRITER_EXPENSE_EDIT_API_VERSION,
  executeWriterExpenseEditApiRequest,
} from '../../dist/writer/expenseEditApi.js';

const TX_ID = 'b2000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = 'c2000000-0000-0000-0000-000000000001';
const CATEGORY_ID = 'd2000000-0000-0000-0000-000000000001';
const MEMBER_ID = 'e2000000-0000-0000-0000-000000000001';

const CURRENT = Object.freeze({
  id: TX_ID,
  version: 3,
  transaction: Object.freeze({
    type: 'EXPENSE',
    occurredOn: '2026-09-08',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 12000,
    currency: 'RUB',
    fromAccountId: ACCOUNT_ID,
    toAccountId: null,
    categoryId: CATEGORY_ID,
    paidByMemberId: null,
    description: 'Synthetic old description',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
  }),
});

const REQUEST = Object.freeze({
  transactionId: TX_ID,
  expectedVersion: 3,
  occurredOn: '2026-09-10',
  amountMinor: 12345,
  currency: 'RUB',
  fromAccountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  paidByMemberId: MEMBER_ID,
  description: 'Synthetic edited description',
  note: 'Synthetic edited note',
});

function references() {
  return {
    async readExpenseEditReferenceEvidence(request) {
      return Object.freeze({
        accountId: request.fromAccountId,
        categoryId: request.categoryId,
        categoryKind: 'EXPENSE',
        memberId: request.paidByMemberId,
      });
    },
  };
}

class MemoryStore {
  current = CURRENT;
  replaceCalls = 0;
  raceVersion = null;

  async readCurrent(transactionId) {
    return this.current.id === transactionId ? this.current : null;
  }

  async replaceIfVersion(input) {
    this.replaceCalls += 1;
    if (this.raceVersion !== null) {
      return Object.freeze({ outcome: 'VERSION_CONFLICT', currentVersion: this.raceVersion });
    }
    this.current = input.candidate;
    return Object.freeze({ outcome: 'UPDATED', current: input.candidate });
  }
}

function assertNoFinancialPayload(response) {
  const serialized = JSON.stringify(response);
  for (const forbidden of [
    '"transaction":',
    'amountMinor',
    'occurredOn',
    'fromAccountId',
    'toAccountId',
    'categoryId',
    'paidByMemberId',
    'description',
    'note',
    'Synthetic edited',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public response leaked ${forbidden}`);
  }
}

test('Writer EXPENSE edit API projects UPDATED to an exact immutable identity/version acknowledgement', async () => {
  const store = new MemoryStore();
  const response = await executeWriterExpenseEditApiRequest({ references: references(), store }, REQUEST);

  assert.deepEqual(response, {
    apiVersion: WRITER_EXPENSE_EDIT_API_VERSION,
    outcome: 'UPDATED',
    transactionId: TX_ID,
    version: 4,
  });
  assert.deepEqual(Object.keys(response).sort(), [
    'apiVersion',
    'outcome',
    'transactionId',
    'version',
  ]);
  assert.ok(Object.isFrozen(response));
  assertNoFinancialPayload(response);
  assert.equal(store.replaceCalls, 1);
});

test('Writer EXPENSE edit API projects stale pre-read to minimal VERSION_CONFLICT without mutation', async () => {
  const store = new MemoryStore();
  const response = await executeWriterExpenseEditApiRequest(
    { references: references(), store },
    { ...REQUEST, expectedVersion: 2 },
  );

  assert.deepEqual(response, {
    apiVersion: WRITER_EXPENSE_EDIT_API_VERSION,
    outcome: 'VERSION_CONFLICT',
    transactionId: TX_ID,
    currentVersion: 3,
  });
  assert.deepEqual(Object.keys(response).sort(), [
    'apiVersion',
    'currentVersion',
    'outcome',
    'transactionId',
  ]);
  assert.ok(Object.isFrozen(response));
  assertNoFinancialPayload(response);
  assert.equal(store.replaceCalls, 0);
});

test('Writer EXPENSE edit API preserves concurrent atomic VERSION_CONFLICT as the same minimal public shape', async () => {
  const store = new MemoryStore();
  store.raceVersion = 4;
  const response = await executeWriterExpenseEditApiRequest({ references: references(), store }, REQUEST);

  assert.deepEqual(response, {
    apiVersion: WRITER_EXPENSE_EDIT_API_VERSION,
    outcome: 'VERSION_CONFLICT',
    transactionId: TX_ID,
    currentVersion: 4,
  });
  assertNoFinancialPayload(response);
  assert.equal(store.replaceCalls, 1);
});

test('Writer EXPENSE edit API preserves stable application errors without an API-specific vocabulary', async () => {
  const store = new MemoryStore();
  await assert.rejects(
    executeWriterExpenseEditApiRequest(
      { references: references(), store },
      { ...REQUEST, unknown: true },
    ),
    (error) => {
      assert.ok(error instanceof ExpenseEditError);
      assert.equal(error.code, 'INVALID_REQUEST');
      assert.equal(error.message, 'INVALID_REQUEST');
      return true;
    },
  );
  assert.equal(store.replaceCalls, 0);
});

test('Writer EXPENSE edit API is a thin provider-neutral projection over optimistic application semantics', async () => {
  const source = await readFile(new URL('../../src/writer/expenseEditApi.ts', import.meta.url), 'utf8');

  assert.match(source, /executeOptimisticExpenseEdit/u);
  assert.match(source, /\.\/optimisticExpenseEdit\.js/u);
  assert.doesNotMatch(source, /validateTransaction|UUID_PATTERN|DATE_PATTERN|amountMinor\s*[<>=]|readCurrent\(|replaceIfVersion\(/u);
  assert.doesNotMatch(source, /integration\/ydb|YdbAdapter|fetch\s*\(|indexedDB|requestContext|apiGateway|OWNER_SESSION|cookie|Cloud Function|Yandex|Google/iu);
});
