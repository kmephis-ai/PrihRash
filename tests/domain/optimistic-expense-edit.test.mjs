import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ExpenseEditError,
  executeOptimisticExpenseEdit,
  parseExpenseEditRequest,
} from '../../dist/writer/optimisticExpenseEdit.js';
import { validateTransaction } from '../../dist/domain/transaction.js';

const TX_ID = 'b1000000-0000-0000-0000-000000000001';
const TX_ID_2 = 'b1000000-0000-0000-0000-000000000002';
const ACCOUNT_ID = 'c1000000-0000-0000-0000-000000000001';
const ACCOUNT_ID_2 = 'c1000000-0000-0000-0000-000000000002';
const CATEGORY_ID = 'd1000000-0000-0000-0000-000000000001';
const CATEGORY_ID_2 = 'd1000000-0000-0000-0000-000000000002';
const MEMBER_ID = 'e1000000-0000-0000-0000-000000000001';
const MEMBER_ID_2 = 'e1000000-0000-0000-0000-000000000002';

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
  fromAccountId: ACCOUNT_ID_2,
  categoryId: CATEGORY_ID_2,
  paidByMemberId: MEMBER_ID,
  description: 'Synthetic edited description',
  note: 'Synthetic note',
});

class InMemoryOptimisticEditStore {
  current;
  readCalls = 0;
  replaceCalls = 0;
  forceRaceVersion = null;

  constructor(current = CURRENT) {
    this.current = current;
  }

  async readCurrent(transactionId) {
    this.readCalls += 1;
    if (this.current === null || this.current.id !== transactionId) return null;
    return this.current;
  }

  async replaceIfVersion(input) {
    this.replaceCalls += 1;
    if (this.forceRaceVersion !== null) {
      return Object.freeze({ outcome: 'VERSION_CONFLICT', currentVersion: this.forceRaceVersion });
    }
    if (this.current === null || this.current.version !== input.expectedVersion) {
      return Object.freeze({ outcome: 'VERSION_CONFLICT', currentVersion: this.current?.version ?? input.expectedVersion + 1 });
    }
    this.current = input.candidate;
    return Object.freeze({ outcome: 'UPDATED', current: this.current });
  }
}

function referenceReader(overrides = {}) {
  const state = { calls: 0, lastRequest: null };
  return {
    state,
    dependency: {
      async readExpenseEditReferenceEvidence(request) {
        state.calls += 1;
        state.lastRequest = request;
        if (overrides.missing) return null;
        const evidence = {
          accountId: overrides.accountId ?? request.fromAccountId,
          categoryId: overrides.categoryId ?? request.categoryId,
          categoryKind: overrides.categoryKind ?? 'EXPENSE',
          memberId: Object.hasOwn(overrides, 'memberId') ? overrides.memberId : request.paidByMemberId,
        };
        if (overrides.extra) evidence.extra = true;
        return evidence;
      },
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExpenseEditError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('optimistic EXPENSE edit validates references, preserves immutable semantics, and increments exact version', async () => {
  const store = new InMemoryOptimisticEditStore();
  const refs = referenceReader();
  const response = await executeOptimisticExpenseEdit({ references: refs.dependency, store }, REQUEST);

  assert.deepEqual(response, {
    contractVersion: 1,
    outcome: 'UPDATED',
    transactionId: TX_ID,
    version: 4,
    transaction: {
      ...CURRENT.transaction,
      occurredOn: REQUEST.occurredOn,
      amountMinor: REQUEST.amountMinor,
      currency: 'RUB',
      fromAccountId: REQUEST.fromAccountId,
      categoryId: REQUEST.categoryId,
      paidByMemberId: MEMBER_ID,
      description: REQUEST.description,
      note: REQUEST.note,
    },
  });
  assert.deepEqual(validateTransaction(response.transaction, { categoryKind: 'EXPENSE' }), []);
  assert.equal(response.transaction.type, CURRENT.transaction.type);
  assert.equal(response.transaction.recordGranularity, CURRENT.transaction.recordGranularity);
  assert.equal(response.transaction.datePrecision, CURRENT.transaction.datePrecision);
  assert.equal(response.transaction.financialPeriodId, CURRENT.transaction.financialPeriodId);
  assert.equal(response.transaction.periodAssignmentQuality, CURRENT.transaction.periodAssignmentQuality);
  assert.equal(response.transaction.status, CURRENT.transaction.status);
  assert.equal(response.transaction.analyticsState, CURRENT.transaction.analyticsState);
  assert.equal(response.transaction.flowKind, CURRENT.transaction.flowKind);
  assert.equal(store.readCalls, 1);
  assert.equal(store.replaceCalls, 1);
  assert.equal(refs.state.calls, 1);
  assert.deepEqual(refs.state.lastRequest, {
    fromAccountId: ACCOUNT_ID_2,
    categoryId: CATEGORY_ID_2,
    paidByMemberId: MEMBER_ID,
  });
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.transaction));
  assert.ok(Object.isFrozen(store.current));
});

test('paidByMemberId may be cleared explicitly without inferring a replacement member', async () => {
  const current = Object.freeze({
    ...CURRENT,
    transaction: Object.freeze({ ...CURRENT.transaction, paidByMemberId: MEMBER_ID }),
  });
  const request = Object.freeze({ ...REQUEST, paidByMemberId: null });
  const store = new InMemoryOptimisticEditStore(current);
  const refs = referenceReader();
  const response = await executeOptimisticExpenseEdit({ references: refs.dependency, store }, request);
  assert.equal(response.outcome, 'UPDATED');
  assert.equal(response.transaction.paidByMemberId, null);
  assert.equal(refs.state.lastRequest.paidByMemberId, null);
});

test('stale expectedVersion returns VERSION_CONFLICT before reference read or mutation', async () => {
  const store = new InMemoryOptimisticEditStore();
  const refs = referenceReader();
  const response = await executeOptimisticExpenseEdit(
    { references: refs.dependency, store },
    { ...REQUEST, expectedVersion: 2 },
  );
  assert.deepEqual(response, {
    contractVersion: 1,
    outcome: 'VERSION_CONFLICT',
    transactionId: TX_ID,
    currentVersion: 3,
  });
  assert.ok(Object.isFrozen(response));
  assert.equal(refs.state.calls, 0);
  assert.equal(store.replaceCalls, 0);
});

test('atomic replace closes read/replace race and returns conflict without false UPDATED', async () => {
  const store = new InMemoryOptimisticEditStore();
  store.forceRaceVersion = 4;
  const refs = referenceReader();
  const response = await executeOptimisticExpenseEdit({ references: refs.dependency, store }, REQUEST);
  assert.deepEqual(response, {
    contractVersion: 1,
    outcome: 'VERSION_CONFLICT',
    transactionId: TX_ID,
    currentVersion: 4,
  });
  assert.equal(refs.state.calls, 1);
  assert.equal(store.replaceCalls, 1);
  assert.deepEqual(store.current, CURRENT);
});

test('malformed edit requests fail before store/reference access and cannot change immutable fields', async (t) => {
  const cases = [
    ['uppercase transaction id', { ...REQUEST, transactionId: TX_ID.toUpperCase() }],
    ['zero expected version', { ...REQUEST, expectedVersion: 0 }],
    ['unsafe expected version', { ...REQUEST, expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid date', { ...REQUEST, occurredOn: '2026-02-30' }],
    ['short date', { ...REQUEST, occurredOn: '2026-9-10' }],
    ['zero amount', { ...REQUEST, amountMinor: 0 }],
    ['unsafe amount', { ...REQUEST, amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong currency', { ...REQUEST, currency: 'USD' }],
    ['uppercase account', { ...REQUEST, fromAccountId: ACCOUNT_ID.toUpperCase() }],
    ['uppercase category', { ...REQUEST, categoryId: CATEGORY_ID.toUpperCase() }],
    ['uppercase member', { ...REQUEST, paidByMemberId: MEMBER_ID.toUpperCase() }],
    ['blank description', { ...REQUEST, description: '   ' }],
    ['padded note', { ...REQUEST, note: ' note ' }],
    ['unknown status mutation', { ...REQUEST, status: 'VOIDED' }],
    ['unknown period mutation', { ...REQUEST, financialPeriodId: TX_ID_2 }],
    ['unknown analytics mutation', { ...REQUEST, analyticsState: 'EXCLUDED' }],
  ];
  for (const [name, input] of cases) {
    await t.test(name, async () => {
      const store = new InMemoryOptimisticEditStore();
      const refs = referenceReader();
      await expectCode(executeOptimisticExpenseEdit({ references: refs.dependency, store }, input), 'INVALID_REQUEST');
      assert.equal(store.readCalls, 0);
      assert.equal(store.replaceCalls, 0);
      assert.equal(refs.state.calls, 0);
    });
  }
});

test('transaction not found is explicit and does not consult references', async () => {
  const store = new InMemoryOptimisticEditStore(null);
  const refs = referenceReader();
  await expectCode(executeOptimisticExpenseEdit({ references: refs.dependency, store }, REQUEST), 'TRANSACTION_NOT_FOUND');
  assert.equal(store.readCalls, 1);
  assert.equal(store.replaceCalls, 0);
  assert.equal(refs.state.calls, 0);
});

test('reference evidence is exact for account/category/member and fails closed before replace', async (t) => {
  const cases = [
    ['missing', { missing: true }, 'REFERENCE_NOT_FOUND'],
    ['account mismatch', { accountId: ACCOUNT_ID }, 'REFERENCE_MISMATCH'],
    ['category mismatch', { categoryId: CATEGORY_ID }, 'REFERENCE_MISMATCH'],
    ['member mismatch', { memberId: MEMBER_ID_2 }, 'REFERENCE_MISMATCH'],
    ['member unexpectedly missing', { memberId: null }, 'REFERENCE_MISMATCH'],
    ['wrong category kind', { categoryKind: 'INCOME' }, 'CATEGORY_KIND_INVALID'],
    ['extra reference field', { extra: true }, 'REFERENCE_MISMATCH'],
  ];
  for (const [name, overrides, code] of cases) {
    await t.test(name, async () => {
      const store = new InMemoryOptimisticEditStore();
      const refs = referenceReader(overrides);
      await expectCode(executeOptimisticExpenseEdit({ references: refs.dependency, store }, REQUEST), code);
      assert.equal(store.readCalls, 1);
      assert.equal(refs.state.calls, 1);
      assert.equal(store.replaceCalls, 0);
    });
  }
});

test('malformed current store evidence is never upgraded into editable EXPENSE state', async (t) => {
  const malformed = [
    ['wrong id', { ...CURRENT, id: TX_ID_2 }],
    ['zero version', { ...CURRENT, version: 0 }],
    ['wrong type', { ...CURRENT, transaction: { ...CURRENT.transaction, type: 'INCOME' } }],
    ['coarse record', { ...CURRENT, transaction: { ...CURRENT.transaction, recordGranularity: 'PERIOD_AGGREGATE', datePrecision: 'MONTH', aggregatePeriodMonth: '2026-09-01' } }],
    ['voided record', { ...CURRENT, transaction: { ...CURRENT.transaction, status: 'VOIDED' } }],
    ['bad financial period id', { ...CURRENT, transaction: { ...CURRENT.transaction, financialPeriodId: 'period-id' } }],
    ['non-null expense flow kind', { ...CURRENT, transaction: { ...CURRENT.transaction, flowKind: 'CREDIT_DRAW' } }],
    ['extra transaction field', { ...CURRENT, transaction: { ...CURRENT.transaction, extra: true } }],
  ];
  for (const [name, current] of malformed) {
    await t.test(name, async () => {
      const store = {
        readCurrent: async () => current,
        replaceIfVersion: async () => assert.fail('replace must not run'),
      };
      await expectCode(
        executeOptimisticExpenseEdit({ references: referenceReader().dependency, store }, REQUEST),
        'STORE_CONTRACT_INVALID',
      );
    });
  }
});

test('replace result must prove exact promoted candidate or a real newer race version', async (t) => {
  const updated = Object.freeze({
    id: TX_ID,
    version: 4,
    transaction: Object.freeze({
      ...CURRENT.transaction,
      occurredOn: REQUEST.occurredOn,
      amountMinor: REQUEST.amountMinor,
      fromAccountId: REQUEST.fromAccountId,
      categoryId: REQUEST.categoryId,
      paidByMemberId: REQUEST.paidByMemberId,
      description: REQUEST.description,
      note: REQUEST.note,
    }),
  });
  const cases = [
    ['same-version conflict', { outcome: 'VERSION_CONFLICT', currentVersion: 3 }],
    ['older-version conflict', { outcome: 'VERSION_CONFLICT', currentVersion: 2 }],
    ['updated wrong version', { outcome: 'UPDATED', current: { ...updated, version: 5 } }],
    ['updated wrong payload', { outcome: 'UPDATED', current: { ...updated, transaction: { ...updated.transaction, amountMinor: 999 } } }],
    ['unknown outcome', { outcome: 'IGNORED' }],
    ['extra conflict field', { outcome: 'VERSION_CONFLICT', currentVersion: 4, extra: true }],
  ];
  for (const [name, result] of cases) {
    await t.test(name, async () => {
      const store = {
        readCurrent: async () => CURRENT,
        replaceIfVersion: async () => result,
      };
      await expectCode(
        executeOptimisticExpenseEdit({ references: referenceReader().dependency, store }, REQUEST),
        'STORE_CONTRACT_INVALID',
      );
    });
  }
});

test('dependency failures are sanitized into stable application codes', async (t) => {
  await t.test('current read failure', async () => {
    await expectCode(executeOptimisticExpenseEdit({
      references: referenceReader().dependency,
      store: {
        readCurrent: async () => { throw new Error('private current read diagnostic'); },
        replaceIfVersion: async () => assert.fail('replace must not run'),
      },
    }, REQUEST), 'STORE_OPERATION_FAILED');
  });

  await t.test('reference read failure', async () => {
    const store = new InMemoryOptimisticEditStore();
    await expectCode(executeOptimisticExpenseEdit({
      references: {
        readExpenseEditReferenceEvidence: async () => { throw new Error('private reference diagnostic'); },
      },
      store,
    }, REQUEST), 'REFERENCE_READ_FAILED');
    assert.equal(store.replaceCalls, 0);
  });

  await t.test('atomic replace failure', async () => {
    await expectCode(executeOptimisticExpenseEdit({
      references: referenceReader().dependency,
      store: {
        readCurrent: async () => CURRENT,
        replaceIfVersion: async () => { throw new Error('private replace diagnostic'); },
      },
    }, REQUEST), 'STORE_OPERATION_FAILED');
  });
});

test('request parser returns immutable canonical evidence without normalization', () => {
  const parsed = parseExpenseEditRequest(REQUEST);
  assert.deepEqual(parsed, REQUEST);
  assert.ok(Object.isFrozen(parsed));
  assert.throws(() => parseExpenseEditRequest({ ...REQUEST, note: ' note ' }), /INVALID_REQUEST/u);
});

test('optimistic edit application module has no YDB, browser, HTTP or provider dependency', async () => {
  const source = await readFile(new URL('../../src/writer/optimisticExpenseEdit.ts', import.meta.url), 'utf8');
  assert.match(source, /\.\.\/domain\/transaction\.js/u);
  assert.match(source, /replaceIfVersion/u);
  assert.match(source, /paidByMemberId/u);
  assert.doesNotMatch(source, /integration\/ydb|\bfetch\s*\(|\bhttp\b|web\/|yandex|google/iu);
});
