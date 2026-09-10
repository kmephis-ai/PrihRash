import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  IncomeCreateError,
  executeIdempotentIncomeCreate,
  parseIncomeCreateRequest,
} from '../../dist/writer/idempotentIncomeCreate.js';
import { validateTransaction } from '../../dist/domain/transaction.js';

const KEY = 'a0000000-0000-0000-0000-000000000001';
const TX_ID = 'b0000000-0000-0000-0000-000000000001';
const TX_ID_2 = 'b0000000-0000-0000-0000-000000000002';
const ACCOUNT_ID = 'c0000000-0000-0000-0000-000000000001';
const ACCOUNT_ID_2 = 'c0000000-0000-0000-0000-000000000002';
const CATEGORY_ID = 'd0000000-0000-0000-0000-000000000001';
const CATEGORY_ID_2 = 'd0000000-0000-0000-0000-000000000002';

const REQUEST = Object.freeze({
  idempotencyKey: KEY,
  occurredOn: '2026-09-10',
  amountMinor: 12345,
  currency: 'RUB',
  toAccountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  description: 'Зарплата',
  note: null,
});

function sameRequest(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class InMemoryAtomicCreateStore {
  records = new Map();
  readCalls = 0;
  calls = 0;
  creates = 0;

  async readCommitted(idempotencyKey) {
    this.readCalls += 1;
    return this.records.get(idempotencyKey) ?? null;
  }

  async createOrReplay(input) {
    this.calls += 1;
    const existing = this.records.get(input.request.idempotencyKey);
    if (existing === undefined) {
      this.creates += 1;
      const committed = Object.freeze({ request: input.request, result: input.candidate });
      this.records.set(input.request.idempotencyKey, committed);
      return Object.freeze({ outcome: 'CREATED', ...committed });
    }
    if (!sameRequest(existing.request, input.request)) return Object.freeze({ outcome: 'CONFLICT' });
    return Object.freeze({ outcome: 'REPLAY', request: existing.request, result: existing.result });
  }
}

function referenceReader(overrides = {}) {
  const state = { calls: 0 };
  return {
    state,
    dependency: {
      async readIncomeCreateReferenceEvidence(request) {
        state.calls += 1;
        if (overrides.missing) return null;
        const evidence = {
          accountId: overrides.accountId ?? request.toAccountId,
          categoryId: overrides.categoryId ?? request.categoryId,
          categoryKind: overrides.categoryKind ?? 'INCOME',
        };
        if (overrides.extra) evidence.extra = true;
        return evidence;
      },
    },
  };
}

function uuidSequence(...values) {
  let index = 0;
  return () => {
    const value = values[index] ?? values.at(-1);
    index += 1;
    return value;
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof IncomeCreateError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('first INCOME create uses canonical defaults and creates one separate transaction identity', async () => {
  const store = new InMemoryAtomicCreateStore();
  const refs = referenceReader();
  const response = await executeIdempotentIncomeCreate({
    references: refs.dependency,
    store,
    randomUuid: () => TX_ID,
  }, REQUEST);

  assert.equal(response.contractVersion, 1);
  assert.equal(response.outcome, 'CREATED');
  assert.equal(response.idempotencyKey, KEY);
  assert.equal(response.result.id, TX_ID);
  assert.notEqual(response.result.id, response.idempotencyKey);
  assert.equal(response.result.version, 1);
  assert.deepEqual(response.result.transaction, {
    type: 'INCOME',
    occurredOn: '2026-09-10',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 12345,
    currency: 'RUB',
    fromAccountId: null,
    toAccountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    paidByMemberId: null,
    description: 'Зарплата',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
  });
  assert.deepEqual(validateTransaction(response.result.transaction, { categoryKind: 'INCOME' }), []);
  assert.equal(refs.state.calls, 1);
  assert.equal(store.readCalls, 1);
  assert.equal(store.calls, 1);
  assert.equal(store.creates, 1);
  assert.ok(Object.isFrozen(response));
  assert.ok(Object.isFrozen(response.result));
  assert.ok(Object.isFrozen(response.result.transaction));
});

test('exact replay returns original result and never creates a second transaction', async () => {
  const store = new InMemoryAtomicCreateStore();
  const refs = referenceReader();
  const randomUuid = uuidSequence(TX_ID, TX_ID_2);

  const first = await executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid }, REQUEST);
  const replay = await executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid }, { ...REQUEST });

  assert.equal(first.outcome, 'CREATED');
  assert.equal(replay.outcome, 'REPLAY');
  assert.equal(replay.result.id, TX_ID);
  assert.deepEqual(replay.result, first.result);
  assert.equal(refs.state.calls, 1);
  assert.equal(store.readCalls, 2);
  assert.equal(store.calls, 1);
  assert.equal(store.creates, 1);
});

test('same key with any changed canonical field fails as idempotency conflict without replacing original result', async (t) => {
  const variants = [
    ['occurredOn', { occurredOn: '2026-09-09' }],
    ['amountMinor', { amountMinor: 12346 }],
    ['toAccountId', { toAccountId: ACCOUNT_ID_2 }],
    ['categoryId', { categoryId: CATEGORY_ID_2 }],
    ['description', { description: 'Премия' }],
    ['description null', { description: null }],
    ['note', { note: 'Выплата подтверждена' }],
  ];

  for (const [name, change] of variants) {
    await t.test(name, async () => {
      const store = new InMemoryAtomicCreateStore();
      const refs = referenceReader();
      const randomUuid = uuidSequence(TX_ID, TX_ID_2);
      const original = await executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid }, REQUEST);
      await expectCode(
        executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid }, { ...REQUEST, ...change }),
        'IDEMPOTENCY_CONFLICT',
      );
      assert.equal(store.creates, 1);
      assert.equal(store.calls, 1);
      assert.equal(refs.state.calls, 1);
      assert.equal(store.records.get(KEY).result.id, original.result.id);
      assert.deepEqual(store.records.get(KEY).request, REQUEST);
    });
  }
});

test('malformed requests fail before reference lookup and store mutation', async (t) => {
  const cases = [
    ['uppercase key', { ...REQUEST, idempotencyKey: KEY.toUpperCase() }],
    ['uppercase account', { ...REQUEST, toAccountId: ACCOUNT_ID.toUpperCase() }],
    ['invalid date', { ...REQUEST, occurredOn: '2026-02-30' }],
    ['short date', { ...REQUEST, occurredOn: '2026-9-10' }],
    ['zero amount', { ...REQUEST, amountMinor: 0 }],
    ['unsafe amount', { ...REQUEST, amountMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong currency', { ...REQUEST, currency: 'USD' }],
    ['blank description', { ...REQUEST, description: '   ' }],
    ['padded description', { ...REQUEST, description: ' Зарплата' }],
    ['blank note', { ...REQUEST, note: '' }],
    ['unknown field', { ...REQUEST, extra: true }],
  ];

  for (const [name, input] of cases) {
    await t.test(name, async () => {
      const store = new InMemoryAtomicCreateStore();
      const refs = referenceReader();
      await expectCode(
        executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid: () => TX_ID }, input),
        'INVALID_REQUEST',
      );
      assert.equal(refs.state.calls, 0);
      assert.equal(store.readCalls, 0);
      assert.equal(store.calls, 0);
      assert.equal(store.creates, 0);
    });
  }
});

test('missing and mismatched reference evidence fail before store mutation', async (t) => {
  const cases = [
    ['missing', { missing: true }, 'REFERENCE_NOT_FOUND'],
    ['account mismatch', { accountId: ACCOUNT_ID_2 }, 'REFERENCE_MISMATCH'],
    ['category mismatch', { categoryId: CATEGORY_ID_2 }, 'REFERENCE_MISMATCH'],
    ['wrong category kind', { categoryKind: 'EXPENSE' }, 'CATEGORY_KIND_INVALID'],
    ['extra reference field', { extra: true }, 'REFERENCE_MISMATCH'],
  ];

  for (const [name, refOverrides, code] of cases) {
    await t.test(name, async () => {
      const store = new InMemoryAtomicCreateStore();
      const refs = referenceReader(refOverrides);
      await expectCode(
        executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid: () => TX_ID }, REQUEST),
        code,
      );
      assert.equal(refs.state.calls, 1);
      assert.equal(store.readCalls, 1);
      assert.equal(store.calls, 0);
    });
  }
});

test('generated transaction identity must be canonical and separate from idempotency key before store mutation', async (t) => {
  for (const [name, generated] of [
    ['malformed', 'transaction-id'],
    ['uppercase', TX_ID.toUpperCase()],
    ['same as idempotency key', KEY],
  ]) {
    await t.test(name, async () => {
      const store = new InMemoryAtomicCreateStore();
      const refs = referenceReader();
      await expectCode(
        executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid: () => generated }, REQUEST),
        'INVALID_GENERATED_TRANSACTION_ID',
      );
      assert.equal(store.readCalls, 1);
      assert.equal(store.calls, 0);
    });
  }
});

test('committed replay does not depend on current reference availability or generate a new identity', async () => {
  const store = new InMemoryAtomicCreateStore();
  const refs = referenceReader();
  let generated = 0;
  const randomUuid = () => {
    generated += 1;
    return generated === 1 ? TX_ID : TX_ID_2;
  };

  const first = await executeIdempotentIncomeCreate({ references: refs.dependency, store, randomUuid }, REQUEST);
  const unavailableRefs = referenceReader({ missing: true });
  const replay = await executeIdempotentIncomeCreate({
    references: unavailableRefs.dependency,
    store,
    randomUuid,
  }, REQUEST);

  assert.equal(first.outcome, 'CREATED');
  assert.equal(replay.outcome, 'REPLAY');
  assert.equal(replay.result.id, first.result.id);
  assert.equal(unavailableRefs.state.calls, 0);
  assert.equal(generated, 1);
  assert.equal(store.creates, 1);
});

test('store conflict and malformed replay evidence fail closed', async (t) => {
  const seedStore = new InMemoryAtomicCreateStore();
  const expected = await executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: seedStore,
    randomUuid: () => TX_ID,
  }, REQUEST);

  const cases = [
    ['committed different request', {
      readCommitted: async () => ({ request: { ...REQUEST, amountMinor: REQUEST.amountMinor + 1 }, result: expected.result }),
      createOrReplay: async () => assert.fail('createOrReplay must not run'),
    }, 'IDEMPOTENCY_CONFLICT'],
    ['committed wrong result id', {
      readCommitted: async () => ({ request: REQUEST, result: { ...expected.result, id: 'bad-id' } }),
      createOrReplay: async () => assert.fail('createOrReplay must not run'),
    }, 'STORE_CONTRACT_INVALID'],
    ['committed wrong version', {
      readCommitted: async () => ({ request: REQUEST, result: { ...expected.result, version: 2 } }),
      createOrReplay: async () => assert.fail('createOrReplay must not run'),
    }, 'STORE_CONTRACT_INVALID'],
    ['committed wrong transaction payload', {
      readCommitted: async () => ({
        request: REQUEST,
        result: { ...expected.result, transaction: { ...expected.result.transaction, amountMinor: 999 } },
      }),
      createOrReplay: async () => assert.fail('createOrReplay must not run'),
    }, 'STORE_CONTRACT_INVALID'],
    ['race conflict after initial miss', {
      readCommitted: async () => null,
      createOrReplay: async () => ({ outcome: 'CONFLICT' }),
    }, 'IDEMPOTENCY_CONFLICT'],
    ['malformed atomic result after initial miss', {
      readCommitted: async () => null,
      createOrReplay: async () => ({ outcome: 'REPLAY', request: REQUEST }),
    }, 'STORE_CONTRACT_INVALID'],
  ];

  for (const [name, store, code] of cases) {
    await t.test(name, async () => {
      await expectCode(
        executeIdempotentIncomeCreate({
          references: referenceReader().dependency,
          store,
          randomUuid: () => TX_ID_2,
        }, REQUEST),
        code,
      );
    });
  }
});


test('race-time exact replay returns the already committed identity instead of the generated candidate', async () => {
  const seedStore = new InMemoryAtomicCreateStore();
  const committed = await executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: seedStore,
    randomUuid: () => TX_ID,
  }, REQUEST);

  const raceStore = {
    readCommitted: async () => null,
    createOrReplay: async () => ({
      outcome: 'REPLAY',
      request: REQUEST,
      result: committed.result,
    }),
  };
  const response = await executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: raceStore,
    randomUuid: () => TX_ID_2,
  }, REQUEST);

  assert.equal(response.outcome, 'REPLAY');
  assert.equal(response.result.id, TX_ID);
  assert.notEqual(response.result.id, TX_ID_2);
});

test('stored transaction with wrong type fails closed', async () => {
  const seedStore = new InMemoryAtomicCreateStore();
  const committed = await executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: seedStore,
    randomUuid: () => TX_ID,
  }, REQUEST);
  await expectCode(executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: {
      readCommitted: async () => ({
        request: REQUEST,
        result: {
          ...committed.result,
          transaction: { ...committed.result.transaction, type: 'EXPENSE' },
        },
      }),
      createOrReplay: async () => assert.fail('createOrReplay must not run'),
    },
    randomUuid: () => TX_ID_2,
  }, REQUEST), 'STORE_CONTRACT_INVALID');
});

test('stored transaction with wrong account direction fails closed', async () => {
  const seedStore = new InMemoryAtomicCreateStore();
  const committed = await executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: seedStore,
    randomUuid: () => TX_ID,
  }, REQUEST);
  await expectCode(executeIdempotentIncomeCreate({
    references: referenceReader().dependency,
    store: {
      readCommitted: async () => ({
        request: REQUEST,
        result: {
          ...committed.result,
          transaction: {
            ...committed.result.transaction,
            fromAccountId: ACCOUNT_ID,
            toAccountId: null,
          },
        },
      }),
      createOrReplay: async () => assert.fail('createOrReplay must not run'),
    },
    randomUuid: () => TX_ID_2,
  }, REQUEST), 'STORE_CONTRACT_INVALID');
});

test('dependency failures are sanitized into stable application codes without leaking messages', async (t) => {
  await t.test('committed read failure', async () => {
    await expectCode(executeIdempotentIncomeCreate({
      references: referenceReader().dependency,
      store: {
        readCommitted: async () => { throw new Error('private store diagnostic'); },
        createOrReplay: async () => assert.fail('createOrReplay must not run'),
      },
      randomUuid: () => TX_ID,
    }, REQUEST), 'STORE_OPERATION_FAILED');
  });

  await t.test('reference read failure', async () => {
    const store = new InMemoryAtomicCreateStore();
    await expectCode(executeIdempotentIncomeCreate({
      references: {
        readIncomeCreateReferenceEvidence: async () => { throw new Error('private reference diagnostic'); },
      },
      store,
      randomUuid: () => TX_ID,
    }, REQUEST), 'REFERENCE_READ_FAILED');
    assert.equal(store.calls, 0);
  });

  await t.test('atomic create failure', async () => {
    await expectCode(executeIdempotentIncomeCreate({
      references: referenceReader().dependency,
      store: {
        readCommitted: async () => null,
        createOrReplay: async () => { throw new Error('private atomic diagnostic'); },
      },
      randomUuid: () => TX_ID,
    }, REQUEST), 'STORE_OPERATION_FAILED');
  });

  await t.test('identity generator failure', async () => {
    const store = new InMemoryAtomicCreateStore();
    await expectCode(executeIdempotentIncomeCreate({
      references: referenceReader().dependency,
      store,
      randomUuid: () => { throw new Error('private rng diagnostic'); },
    }, REQUEST), 'INVALID_GENERATED_TRANSACTION_ID');
    assert.equal(store.calls, 0);
  });
});

test('request parser returns canonical immutable structured evidence without normalization', () => {
  const parsed = parseIncomeCreateRequest(REQUEST);
  assert.deepEqual(parsed, REQUEST);
  assert.ok(Object.isFrozen(parsed));
  assert.throws(() => parseIncomeCreateRequest({ ...REQUEST, note: ' note ' }), /INVALID_REQUEST/u);
});

test('writer application module has no YDB, browser, HTTP or provider runtime dependency', async () => {
  const source = await readFile(new URL('../../src/writer/idempotentIncomeCreate.ts', import.meta.url), 'utf8');
  assert.match(source, /\.\.\/domain\/transaction\.js/u);
  assert.doesNotMatch(source, /integration\/ydb|\bfetch\s*\(|\bhttp\b|web\/|yandex|google/iu);
});
