import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TransactionVoidError,
} from '../../dist/writer/optimisticTransactionVoid.js';
import {
  WRITER_TRANSACTION_VOID_API_VERSION,
  executeWriterTransactionVoidApiRequest,
} from '../../dist/writer/transactionVoidApi.js';

const TX_ID = 'a3000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = 'b3000000-0000-0000-0000-000000000001';
const CATEGORY_ID = 'c3000000-0000-0000-0000-000000000001';
const MEMBER_ID = 'd3000000-0000-0000-0000-000000000001';

function transaction(status = 'POSTED') {
  return Object.freeze({
    type: 'EXPENSE',
    occurredOn: '2026-09-10',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 12345,
    currency: 'RUB',
    fromAccountId: ACCOUNT_ID,
    toAccountId: null,
    categoryId: CATEGORY_ID,
    paidByMemberId: MEMBER_ID,
    description: 'Synthetic private response field',
    note: 'Synthetic private note',
    status,
    analyticsState: 'INCLUDED',
    flowKind: null,
  });
}

function current(status = 'POSTED', version = 3) {
  return Object.freeze({ id: TX_ID, version, transaction: transaction(status) });
}

const REQUEST = Object.freeze({ transactionId: TX_ID, expectedVersion: 3 });

class MemoryVoidStore {
  current = current();
  voidCalls = 0;
  raceVersion = null;

  async readCurrent(transactionId) {
    return this.current?.id === transactionId ? this.current : null;
  }

  async voidIfVersion(input) {
    this.voidCalls += 1;
    if (this.raceVersion !== null) {
      return Object.freeze({ outcome: 'VERSION_CONFLICT', currentVersion: this.raceVersion });
    }
    this.current = input.candidate;
    return Object.freeze({ outcome: 'VOIDED', current: input.candidate });
  }
}

function assertNoFinancialPayload(response) {
  const serialized = JSON.stringify(response);
  for (const forbidden of [
    'contractVersion',
    '"transaction":',
    'amountMinor',
    'occurredOn',
    'fromAccountId',
    'toAccountId',
    'categoryId',
    'paidByMemberId',
    'description',
    'note',
    'analyticsState',
    'flowKind',
    'Synthetic private',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public VOID response leaked ${forbidden}`);
  }
}

test('Writer Transaction VOID API projects VOIDED to exact immutable identity/version acknowledgement', async () => {
  const store = new MemoryVoidStore();
  const response = await executeWriterTransactionVoidApiRequest({ store }, REQUEST);

  assert.deepEqual(response, {
    apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
    outcome: 'VOIDED',
    transactionId: TX_ID,
    version: 4,
  });
  assert.deepEqual(Object.keys(response).sort(), ['apiVersion', 'outcome', 'transactionId', 'version']);
  assert.ok(Object.isFrozen(response));
  assertNoFinancialPayload(response);
  assert.equal(store.voidCalls, 1);
});

test('Writer Transaction VOID API projects exact-version already VOIDED without mutation', async () => {
  const store = new MemoryVoidStore();
  store.current = current('VOIDED');
  const response = await executeWriterTransactionVoidApiRequest({ store }, REQUEST);

  assert.deepEqual(response, {
    apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
    outcome: 'ALREADY_VOIDED',
    transactionId: TX_ID,
    version: 3,
  });
  assert.deepEqual(Object.keys(response).sort(), ['apiVersion', 'outcome', 'transactionId', 'version']);
  assert.ok(Object.isFrozen(response));
  assertNoFinancialPayload(response);
  assert.equal(store.voidCalls, 0);
});

test('Writer Transaction VOID API projects stale pre-read and atomic race to the same minimal VERSION_CONFLICT shape', async (t) => {
  await t.test('stale pre-read', async () => {
    const store = new MemoryVoidStore();
    const response = await executeWriterTransactionVoidApiRequest(
      { store },
      { ...REQUEST, expectedVersion: 2 },
    );
    assert.deepEqual(response, {
      apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
      outcome: 'VERSION_CONFLICT',
      transactionId: TX_ID,
      currentVersion: 3,
    });
    assert.equal(store.voidCalls, 0);
    assert.ok(Object.isFrozen(response));
    assertNoFinancialPayload(response);
  });

  await t.test('atomic race', async () => {
    const store = new MemoryVoidStore();
    store.raceVersion = 4;
    const response = await executeWriterTransactionVoidApiRequest({ store }, REQUEST);
    assert.deepEqual(response, {
      apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
      outcome: 'VERSION_CONFLICT',
      transactionId: TX_ID,
      currentVersion: 4,
    });
    assert.equal(store.voidCalls, 1);
    assert.ok(Object.isFrozen(response));
    assertNoFinancialPayload(response);
  });
});

test('Writer Transaction VOID API preserves safe application errors without API-specific diagnostics', async (t) => {
  await t.test('malformed request', async () => {
    const store = new MemoryVoidStore();
    await assert.rejects(
      executeWriterTransactionVoidApiRequest({ store }, { ...REQUEST, unknown: true }),
      (error) => {
        assert.ok(error instanceof TransactionVoidError);
        assert.equal(error.code, 'INVALID_REQUEST');
        assert.equal(error.message, 'INVALID_REQUEST');
        return true;
      },
    );
    assert.equal(store.voidCalls, 0);
  });

  await t.test('store error remains sanitized', async () => {
    const store = {
      readCurrent: async () => { throw new Error('private provider diagnostic'); },
      voidIfVersion: async () => assert.fail('void must not run'),
    };
    await assert.rejects(
      executeWriterTransactionVoidApiRequest({ store }, REQUEST),
      (error) => {
        assert.ok(error instanceof TransactionVoidError);
        assert.equal(error.code, 'STORE_OPERATION_FAILED');
        assert.equal(error.message, 'STORE_OPERATION_FAILED');
        assert.equal(error.message.includes('private provider diagnostic'), false);
        return true;
      },
    );
  });
});

test('Writer Transaction VOID API is a thin provider-neutral projection over application semantics', async () => {
  const source = await readFile(new URL('../../src/writer/transactionVoidApi.ts', import.meta.url), 'utf8');

  assert.match(source, /executeOptimisticTransactionVoid/u);
  assert.match(source, /\.\/optimisticTransactionVoid\.js/u);
  assert.doesNotMatch(source, /validateTransaction|UUID_PATTERN|DATE_PATTERN|readCurrent\(|voidIfVersion\(|delete|remove|reference/iu);
  assert.doesNotMatch(source, /integration\/ydb|YdbAdapter|fetch\s*\(|indexedDB|requestContext|apiGateway|OWNER_SESSION|cookie|Cloud Function|Yandex|Google/iu);
});
