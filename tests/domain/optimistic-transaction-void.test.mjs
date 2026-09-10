import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TransactionVoidError,
  executeOptimisticTransactionVoid,
  parseTransactionVoidRequest,
} from '../../dist/writer/optimisticTransactionVoid.js';
import { validateTransaction } from '../../dist/domain/transaction.js';

const TX_ID = 'a2000000-0000-0000-0000-000000000001';
const OTHER_TX_ID = 'a2000000-0000-0000-0000-000000000002';
const ACCOUNT_1 = 'b2000000-0000-0000-0000-000000000001';
const ACCOUNT_2 = 'b2000000-0000-0000-0000-000000000002';
const CATEGORY_ID = 'c2000000-0000-0000-0000-000000000001';
const MEMBER_ID = 'd2000000-0000-0000-0000-000000000001';
const PERIOD_ID = 'e2000000-0000-0000-0000-000000000001';

const BASE_FIELDS = Object.freeze({
  occurredOn: '2026-09-10',
  recordGranularity: 'TRANSACTION',
  datePrecision: 'DAY',
  aggregatePeriodMonth: null,
  financialPeriodId: PERIOD_ID,
  periodAssignmentQuality: 'EXPLICIT',
  amountMinor: 12345,
  currency: 'RUB',
  paidByMemberId: MEMBER_ID,
  description: 'Synthetic transaction',
  note: 'Synthetic note',
  status: 'POSTED',
  analyticsState: 'EXCLUDED',
});

function transactionFor(type, overrides = {}) {
  if (type === 'EXPENSE') {
    return Object.freeze({
      type,
      ...BASE_FIELDS,
      fromAccountId: ACCOUNT_1,
      toAccountId: null,
      categoryId: CATEGORY_ID,
      flowKind: null,
      ...overrides,
    });
  }
  if (type === 'INCOME') {
    return Object.freeze({
      type,
      ...BASE_FIELDS,
      fromAccountId: null,
      toAccountId: ACCOUNT_2,
      categoryId: CATEGORY_ID,
      flowKind: null,
      ...overrides,
    });
  }
  return Object.freeze({
    type: 'TRANSFER',
    ...BASE_FIELDS,
    fromAccountId: ACCOUNT_1,
    toAccountId: ACCOUNT_2,
    categoryId: null,
    paidByMemberId: null,
    flowKind: 'OWN_FUNDS_TRANSFER',
    ...overrides,
  });
}

function currentFor(type = 'EXPENSE', overrides = {}) {
  return Object.freeze({
    id: TX_ID,
    version: 3,
    transaction: transactionFor(type),
    ...overrides,
  });
}

const REQUEST = Object.freeze({ transactionId: TX_ID, expectedVersion: 3 });

class InMemoryVoidStore {
  current;
  readCalls = 0;
  voidCalls = 0;
  lastVoidInput = null;
  forceRaceVersion = null;

  constructor(current = currentFor()) {
    this.current = current;
  }

  async readCurrent(transactionId) {
    this.readCalls += 1;
    if (this.current === null || this.current.id !== transactionId) return null;
    return this.current;
  }

  async voidIfVersion(input) {
    this.voidCalls += 1;
    this.lastVoidInput = input;
    if (this.forceRaceVersion !== null) {
      return Object.freeze({ outcome: 'VERSION_CONFLICT', currentVersion: this.forceRaceVersion });
    }
    if (this.current === null || this.current.version !== input.expectedVersion) {
      return Object.freeze({ outcome: 'VERSION_CONFLICT', currentVersion: this.current?.version ?? input.expectedVersion + 1 });
    }
    this.current = input.candidate;
    return Object.freeze({ outcome: 'VOIDED', current: this.current });
  }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof TransactionVoidError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

function changedKeys(before, after) {
  return Object.keys(before).filter((key) => before[key] !== after[key]);
}

test('optimistic VOID applies exact POSTED -> VOIDED transition for EXPENSE, INCOME, and TRANSFER', async (t) => {
  for (const type of ['EXPENSE', 'INCOME', 'TRANSFER']) {
    await t.test(type, async () => {
      const original = currentFor(type);
      const store = new InMemoryVoidStore(original);
      const response = await executeOptimisticTransactionVoid({ store }, REQUEST);

      assert.equal(response.contractVersion, 1);
      assert.equal(response.outcome, 'VOIDED');
      assert.equal(response.transactionId, TX_ID);
      assert.equal(response.version, 4);
      assert.equal(response.transaction.status, 'VOIDED');
      assert.deepEqual(changedKeys(original.transaction, response.transaction), ['status']);
      assert.deepEqual(
        validateTransaction(response.transaction, { categoryKind: null }),
        [],
      );
      assert.equal(store.readCalls, 1);
      assert.equal(store.voidCalls, 1);
      assert.deepEqual(store.lastVoidInput, {
        transactionId: TX_ID,
        expectedVersion: 3,
        candidate: {
          id: TX_ID,
          version: 4,
          transaction: { ...original.transaction, status: 'VOIDED' },
        },
      });
      assert.ok(Object.isFrozen(response));
      assert.ok(Object.isFrozen(response.transaction));
      assert.ok(Object.isFrozen(store.lastVoidInput.candidate));
      assert.ok(Object.isFrozen(store.lastVoidInput.candidate.transaction));
    });
  }
});

test('stale pre-read version returns VERSION_CONFLICT without mutation', async () => {
  const store = new InMemoryVoidStore();
  const response = await executeOptimisticTransactionVoid(
    { store },
    { ...REQUEST, expectedVersion: 2 },
  );
  assert.deepEqual(response, {
    contractVersion: 1,
    outcome: 'VERSION_CONFLICT',
    transactionId: TX_ID,
    currentVersion: 3,
  });
  assert.equal(store.readCalls, 1);
  assert.equal(store.voidCalls, 0);
  assert.ok(Object.isFrozen(response));
});

test('concurrent race is returned as VERSION_CONFLICT and cannot report false VOIDED', async () => {
  const original = currentFor();
  const store = new InMemoryVoidStore(original);
  store.forceRaceVersion = 4;
  const response = await executeOptimisticTransactionVoid({ store }, REQUEST);
  assert.deepEqual(response, {
    contractVersion: 1,
    outcome: 'VERSION_CONFLICT',
    transactionId: TX_ID,
    currentVersion: 4,
  });
  assert.equal(store.voidCalls, 1);
  assert.deepEqual(store.current, original);
});

test('exact-version current VOIDED returns ALREADY_VOIDED without store mutation', async () => {
  const store = new InMemoryVoidStore(currentFor('EXPENSE', {
    transaction: transactionFor('EXPENSE', { status: 'VOIDED' }),
  }));
  const response = await executeOptimisticTransactionVoid({ store }, REQUEST);
  assert.deepEqual(response, {
    contractVersion: 1,
    outcome: 'ALREADY_VOIDED',
    transactionId: TX_ID,
    version: 3,
  });
  assert.equal(store.readCalls, 1);
  assert.equal(store.voidCalls, 0);
  assert.ok(Object.isFrozen(response));
});

test('already VOIDED with stale expectedVersion remains VERSION_CONFLICT', async () => {
  const store = new InMemoryVoidStore(currentFor('EXPENSE', {
    transaction: transactionFor('EXPENSE', { status: 'VOIDED' }),
  }));
  const response = await executeOptimisticTransactionVoid(
    { store },
    { ...REQUEST, expectedVersion: 2 },
  );
  assert.equal(response.outcome, 'VERSION_CONFLICT');
  assert.equal(response.currentVersion, 3);
  assert.equal(store.voidCalls, 0);
});

test('VOID request is exact, frozen, and rejects malformed or mutation-like fields before store access', async (t) => {
  const parsed = parseTransactionVoidRequest(REQUEST);
  assert.deepEqual(parsed, REQUEST);
  assert.ok(Object.isFrozen(parsed));

  const cases = [
    ['uppercase id', { ...REQUEST, transactionId: TX_ID.toUpperCase() }],
    ['invalid id', { ...REQUEST, transactionId: 'not-an-id' }],
    ['zero version', { ...REQUEST, expectedVersion: 0 }],
    ['negative version', { ...REQUEST, expectedVersion: -1 }],
    ['fractional version', { ...REQUEST, expectedVersion: 1.5 }],
    ['unsafe version', { ...REQUEST, expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ['extra status field', { ...REQUEST, status: 'VOIDED' }],
    ['missing version', { transactionId: TX_ID }],
    ['array', [REQUEST]],
    ['null', null],
  ];
  for (const [name, input] of cases) {
    await t.test(name, async () => {
      const store = new InMemoryVoidStore();
      await expectCode(executeOptimisticTransactionVoid({ store }, input), 'INVALID_REQUEST');
      assert.equal(store.readCalls, 0);
      assert.equal(store.voidCalls, 0);
    });
  }
});

test('transaction not found is explicit and performs no mutation', async () => {
  const store = new InMemoryVoidStore(null);
  await expectCode(executeOptimisticTransactionVoid({ store }, REQUEST), 'TRANSACTION_NOT_FOUND');
  assert.equal(store.readCalls, 1);
  assert.equal(store.voidCalls, 0);
});

test('malformed or coarse current store evidence fails closed before voidIfVersion', async (t) => {
  const valid = currentFor();
  const malformed = [
    ['wrong id', { ...valid, id: OTHER_TX_ID }],
    ['zero version', { ...valid, version: 0 }],
    ['unsafe version', { ...valid, version: Number.MAX_SAFE_INTEGER + 1 }],
    ['extra wrapper key', { ...valid, extra: true }],
    ['period aggregate', { ...valid, transaction: { ...valid.transaction, recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: '2026-09' } }],
    ['unknown granularity', { ...valid, transaction: { ...valid.transaction, recordGranularity: 'UNKNOWN' } }],
    ['month precision', { ...valid, transaction: { ...valid.transaction, datePrecision: 'MONTH' } }],
    ['aggregate month on transaction', { ...valid, transaction: { ...valid.transaction, aggregatePeriodMonth: '2026-09' } }],
    ['invalid date', { ...valid, transaction: { ...valid.transaction, occurredOn: '2026-02-30' } }],
    ['zero amount', { ...valid, transaction: { ...valid.transaction, amountMinor: 0 } }],
    ['wrong currency', { ...valid, transaction: { ...valid.transaction, currency: 'USD' } }],
    ['uppercase account id', { ...valid, transaction: { ...valid.transaction, fromAccountId: ACCOUNT_1.toUpperCase() } }],
    ['uppercase category id', { ...valid, transaction: { ...valid.transaction, categoryId: CATEGORY_ID.toUpperCase() } }],
    ['uppercase payer id', { ...valid, transaction: { ...valid.transaction, paidByMemberId: MEMBER_ID.toUpperCase() } }],
    ['bad financial period id', { ...valid, transaction: { ...valid.transaction, financialPeriodId: 'period' } }],
    ['padded description', { ...valid, transaction: { ...valid.transaction, description: ' padded ' } }],
    ['blank note', { ...valid, transaction: { ...valid.transaction, note: ' ' } }],
    ['unknown status', { ...valid, transaction: { ...valid.transaction, status: 'DELETED' } }],
    ['unknown analytics state', { ...valid, transaction: { ...valid.transaction, analyticsState: 'HIDDEN' } }],
    ['flow kind on expense', { ...valid, transaction: { ...valid.transaction, flowKind: 'CREDIT_DRAW' } }],
    ['expense destination account', { ...valid, transaction: { ...valid.transaction, toAccountId: ACCOUNT_2 } }],
    ['extra transaction key', { ...valid, transaction: { ...valid.transaction, deletedAt: null } }],
  ];
  for (const [name, current] of malformed) {
    await t.test(name, async () => {
      let voidCalls = 0;
      const store = {
        readCurrent: async () => current,
        voidIfVersion: async () => {
          voidCalls += 1;
          return assert.fail('void must not run for malformed current evidence');
        },
      };
      await expectCode(executeOptimisticTransactionVoid({ store }, REQUEST), 'STORE_CONTRACT_INVALID');
      assert.equal(voidCalls, 0);
    });
  }
});

test('version overflow is rejected as impossible store transition before mutation', async () => {
  const store = new InMemoryVoidStore(currentFor('EXPENSE', { version: Number.MAX_SAFE_INTEGER }));
  await expectCode(
    executeOptimisticTransactionVoid(
      { store },
      { ...REQUEST, expectedVersion: Number.MAX_SAFE_INTEGER },
    ),
    'STORE_CONTRACT_INVALID',
  );
  assert.equal(store.voidCalls, 0);
});

test('successful store result must prove exact candidate and promoted version', async (t) => {
  const original = currentFor();
  const expected = Object.freeze({
    id: TX_ID,
    version: 4,
    transaction: Object.freeze({ ...original.transaction, status: 'VOIDED' }),
  });
  const changedTransactions = [
    ['amount', { ...expected.transaction, amountMinor: 999 }],
    ['date', { ...expected.transaction, occurredOn: '2026-09-09' }],
    ['source account', { ...expected.transaction, fromAccountId: ACCOUNT_2 }],
    ['category', { ...expected.transaction, categoryId: 'c2000000-0000-0000-0000-000000000002' }],
    ['payer', { ...expected.transaction, paidByMemberId: null }],
    ['note', { ...expected.transaction, note: 'Different synthetic note' }],
    ['type', { ...expected.transaction, type: 'INCOME', fromAccountId: null, toAccountId: ACCOUNT_2 }],
    ['analytics', { ...expected.transaction, analyticsState: 'INCLUDED' }],
    ['flow', { ...expected.transaction, type: 'TRANSFER', categoryId: null, toAccountId: ACCOUNT_2, paidByMemberId: null, flowKind: 'CREDIT_DRAW' }],
    ['status unchanged', { ...expected.transaction, status: 'POSTED' }],
  ];

  for (const [name, transaction] of changedTransactions) {
    await t.test(name, async () => {
      const store = {
        readCurrent: async () => original,
        voidIfVersion: async () => ({ outcome: 'VOIDED', current: { ...expected, transaction } }),
      };
      await expectCode(executeOptimisticTransactionVoid({ store }, REQUEST), 'STORE_CONTRACT_INVALID');
    });
  }

  const malformedResults = [
    ['wrong version', { outcome: 'VOIDED', current: { ...expected, version: 5 } }],
    ['wrong id', { outcome: 'VOIDED', current: { ...expected, id: OTHER_TX_ID } }],
    ['same-version conflict', { outcome: 'VERSION_CONFLICT', currentVersion: 3 }],
    ['older conflict', { outcome: 'VERSION_CONFLICT', currentVersion: 2 }],
    ['unknown outcome', { outcome: 'DELETED' }],
    ['extra conflict field', { outcome: 'VERSION_CONFLICT', currentVersion: 4, extra: true }],
    ['extra VOIDED field', { outcome: 'VOIDED', current: expected, extra: true }],
  ];
  for (const [name, result] of malformedResults) {
    await t.test(name, async () => {
      const store = {
        readCurrent: async () => original,
        voidIfVersion: async () => result,
      };
      await expectCode(executeOptimisticTransactionVoid({ store }, REQUEST), 'STORE_CONTRACT_INVALID');
    });
  }
});

test('store exceptions are sanitized into stable application codes', async (t) => {
  await t.test('read failure', async () => {
    await expectCode(executeOptimisticTransactionVoid({
      store: {
        readCurrent: async () => { throw new Error('private provider diagnostic'); },
        voidIfVersion: async () => assert.fail('void must not run'),
      },
    }, REQUEST), 'STORE_OPERATION_FAILED');
  });

  await t.test('atomic void failure', async () => {
    await expectCode(executeOptimisticTransactionVoid({
      store: {
        readCurrent: async () => currentFor(),
        voidIfVersion: async () => { throw new Error('private write diagnostic'); },
      },
    }, REQUEST), 'STORE_OPERATION_FAILED');
  });
});

test('VOID application source is provider-neutral and exposes no hard-delete port', async () => {
  const source = await readFile(new URL('../../src/writer/optimisticTransactionVoid.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\b|\bhttps?\b|@ydb|\bydb\b|api gateway|lockbox|service account/iu);
  assert.doesNotMatch(source, /\bdelete[A-Za-z]*\s*\(|\bremove[A-Za-z]*\s*\(/u);
  assert.match(source, /voidIfVersion/u);
  assert.doesNotMatch(source, /ReferenceReader|readReference/iu);
});
