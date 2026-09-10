import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ExpenseCreateError,
} from '../../dist/writer/idempotentExpenseCreate.js';
import {
  WRITER_EXPENSE_CREATE_API_VERSION,
  executeWriterExpenseCreateApiRequest,
} from '../../dist/writer/expenseCreateApi.js';

const KEY = 'a0000000-0000-0000-0000-000000000001';
const TX_ID = 'b0000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = 'c0000000-0000-0000-0000-000000000001';
const CATEGORY_ID = 'd0000000-0000-0000-0000-000000000001';
const MEMBER_ID = 'e0000000-0000-0000-0000-000000000001';

const REQUEST = Object.freeze({
  idempotencyKey: KEY,
  occurredOn: '2026-09-10',
  amountMinor: 12345,
  currency: 'RUB',
  fromAccountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  paidByMemberId: null,
  description: 'Продукты',
  note: null,
});

function sameRequest(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class MemoryStore {
  records = new Map();
  creates = 0;

  async readCommitted(idempotencyKey) {
    return this.records.get(idempotencyKey) ?? null;
  }

  async createOrReplay(input) {
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

function references({ missing = false, categoryKind = 'EXPENSE', error = null } = {}) {
  return {
    async readExpenseCreateReferenceEvidence(request) {
      if (error) throw error;
      if (missing) return null;
      return {
        accountId: request.fromAccountId,
        categoryId: request.categoryId,
        categoryKind,
        memberId: request.paidByMemberId,
      };
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExpenseCreateError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    const serialized = JSON.stringify(error);
    assert.equal(serialized.includes('private-provider-diagnostic'), false);
    assert.equal(serialized.includes('Продукты'), false);
    return true;
  });
}

function assertMinimalResponse(response, outcome) {
  assert.deepEqual(response, {
    apiVersion: WRITER_EXPENSE_CREATE_API_VERSION,
    outcome,
    idempotencyKey: KEY,
    transactionId: TX_ID,
    version: 1,
  });
  assert.deepEqual(Object.keys(response).sort(), [
    'apiVersion',
    'idempotencyKey',
    'outcome',
    'transactionId',
    'version',
  ]);
  assert.ok(Object.isFrozen(response));
  assert.notEqual(response.transactionId, response.idempotencyKey);

  const serialized = JSON.stringify(response);
  assert.equal(Object.hasOwn(response, 'transaction'), false);
  for (const forbidden of [
    '"transaction":',
    'amountMinor',
    'occurredOn',
    'fromAccountId',
    'categoryId',
    'paidByMemberId',
    'description',
    'note',
    'Продукты',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public response leaked ${forbidden}`);
  }
}

test('Writer API first create exposes only minimal immutable CREATED acknowledgement', async () => {
  const store = new MemoryStore();
  const response = await executeWriterExpenseCreateApiRequest({
    references: references(),
    store,
    randomUuid: () => TX_ID,
  }, REQUEST);

  assertMinimalResponse(response, 'CREATED');
  assert.equal(store.creates, 1);
});

test('Writer API accepts paidByMemberId while keeping the public acknowledgement payer-free', async () => {
  const store = new MemoryStore();
  const response = await executeWriterExpenseCreateApiRequest({
    references: references(),
    store,
    randomUuid: () => TX_ID,
  }, { ...REQUEST, paidByMemberId: MEMBER_ID });

  assertMinimalResponse(response, 'CREATED');
  assert.equal(store.records.get(KEY).request.paidByMemberId, MEMBER_ID);
  assert.equal(store.records.get(KEY).result.transaction.paidByMemberId, MEMBER_ID);
});

test('Writer API exact replay exposes the same transaction identity with REPLAY and no second create', async () => {
  const store = new MemoryStore();
  const dependencies = {
    references: references(),
    store,
    randomUuid: () => TX_ID,
  };

  const created = await executeWriterExpenseCreateApiRequest(dependencies, REQUEST);
  const replay = await executeWriterExpenseCreateApiRequest(dependencies, { ...REQUEST });

  assertMinimalResponse(created, 'CREATED');
  assertMinimalResponse(replay, 'REPLAY');
  assert.equal(replay.transactionId, created.transactionId);
  assert.equal(replay.version, created.version);
  assert.equal(store.creates, 1);
});

test('Writer API preserves #394 idempotency conflict semantics without replacing the committed create', async () => {
  const store = new MemoryStore();
  const dependencies = {
    references: references(),
    store,
    randomUuid: () => TX_ID,
  };

  await executeWriterExpenseCreateApiRequest(dependencies, REQUEST);
  await expectCode(
    executeWriterExpenseCreateApiRequest(dependencies, { ...REQUEST, amountMinor: REQUEST.amountMinor + 1 }),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(store.creates, 1);
  assert.equal(store.records.get(KEY).result.id, TX_ID);
});

test('Writer API preserves value-free request/reference/dependency errors from the application contract', async (t) => {
  const cases = [
    ['invalid request', { body: { ...REQUEST, unknown: true }, refs: references(), code: 'INVALID_REQUEST' }],
    ['missing reference', { body: REQUEST, refs: references({ missing: true }), code: 'REFERENCE_NOT_FOUND' }],
    ['wrong category kind', { body: REQUEST, refs: references({ categoryKind: 'INCOME' }), code: 'CATEGORY_KIND_INVALID' }],
    ['reference failure', {
      body: REQUEST,
      refs: references({ error: new Error('private-provider-diagnostic') }),
      code: 'REFERENCE_READ_FAILED',
    }],
  ];

  for (const [name, input] of cases) {
    await t.test(name, async () => {
      const store = new MemoryStore();
      await expectCode(executeWriterExpenseCreateApiRequest({
        references: input.refs,
        store,
        randomUuid: () => TX_ID,
      }, input.body), input.code);
      assert.equal(store.creates, 0);
    });
  }
});

test('Writer API source is framework/provider-neutral and delegates to the existing idempotent create contract', async () => {
  const source = await readFile(new URL('../../src/writer/expenseCreateApi.ts', import.meta.url), 'utf8');

  assert.match(source, /executeIdempotentExpenseCreate/u);
  assert.match(source, /\.\/idempotentExpenseCreate\.js/u);
  assert.doesNotMatch(source, /integration\/ydb|YdbAdapter|fetch\(|indexedDB|requestContext|apiGateway|OWNER_SESSION|cookie|Cloud Function|Yandex/u);
  assert.doesNotMatch(source, /validateTransaction|amountMinor\s*<=|UUID_PATTERN|DATE_PATTERN/u);
});
