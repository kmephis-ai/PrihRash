import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TransferCreateError,
} from '../../dist/writer/idempotentTransferCreate.js';
import {
  WRITER_TRANSFER_CREATE_API_VERSION,
  executeWriterTransferCreateApiRequest,
} from '../../dist/writer/transferCreateApi.js';

const KEY = 'a0000000-0000-0000-0000-000000000001';
const TX_ID = 'b0000000-0000-0000-0000-000000000001';
const FROM_ACCOUNT_ID = 'c0000000-0000-0000-0000-000000000001';
const TO_ACCOUNT_ID = 'd0000000-0000-0000-0000-000000000001';

const REQUEST = Object.freeze({
  idempotencyKey: KEY,
  occurredOn: '2026-09-10',
  amountMinor: 12345,
  currency: 'RUB',
  fromAccountId: FROM_ACCOUNT_ID,
  toAccountId: TO_ACCOUNT_ID,
  description: 'Между счетами',
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

function references({ missing = false, mismatch = false, error = null } = {}) {
  return {
    async readTransferCreateReferenceEvidence(request) {
      if (error) throw error;
      if (missing) return null;
      return {
        fromAccountId: mismatch ? TO_ACCOUNT_ID : request.fromAccountId,
        toAccountId: request.toAccountId,
      };
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof TransferCreateError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    const serialized = JSON.stringify(error);
    assert.equal(serialized.includes('private-provider-diagnostic'), false);
    assert.equal(serialized.includes('Между счетами'), false);
    return true;
  });
}

function assertMinimalResponse(response, outcome) {
  assert.deepEqual(response, {
    apiVersion: WRITER_TRANSFER_CREATE_API_VERSION,
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
    'toAccountId',
    'categoryId',
    'flowKind',
    'description',
    'note',
    'Между счетами',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public response leaked ${forbidden}`);
  }
}

test('TRANSFER Writer API first create exposes only minimal immutable CREATED acknowledgement', async () => {
  const store = new MemoryStore();
  const response = await executeWriterTransferCreateApiRequest({
    references: references(),
    store,
    randomUuid: () => TX_ID,
  }, REQUEST);

  assertMinimalResponse(response, 'CREATED');
  assert.equal(store.creates, 1);
});

test('TRANSFER Writer API exact replay exposes the same transaction identity with REPLAY and no second create', async () => {
  const store = new MemoryStore();
  const dependencies = {
    references: references(),
    store,
    randomUuid: () => TX_ID,
  };

  const created = await executeWriterTransferCreateApiRequest(dependencies, REQUEST);
  const replay = await executeWriterTransferCreateApiRequest(dependencies, { ...REQUEST });

  assertMinimalResponse(created, 'CREATED');
  assertMinimalResponse(replay, 'REPLAY');
  assert.equal(replay.transactionId, created.transactionId);
  assert.equal(replay.version, created.version);
  assert.equal(store.creates, 1);
});

test('TRANSFER Writer API preserves application idempotency conflict semantics without replacing the committed create', async () => {
  const store = new MemoryStore();
  const dependencies = {
    references: references(),
    store,
    randomUuid: () => TX_ID,
  };

  await executeWriterTransferCreateApiRequest(dependencies, REQUEST);
  await expectCode(
    executeWriterTransferCreateApiRequest(dependencies, { ...REQUEST, amountMinor: REQUEST.amountMinor + 1 }),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(store.creates, 1);
  assert.equal(store.records.get(KEY).result.id, TX_ID);
});

test('TRANSFER Writer API preserves value-free request/reference/dependency errors from the application contract', async (t) => {
  const cases = [
    ['invalid request', { body: { ...REQUEST, flowKind: null }, refs: references(), code: 'INVALID_REQUEST' }],
    ['missing reference', { body: REQUEST, refs: references({ missing: true }), code: 'REFERENCE_NOT_FOUND' }],
    ['mismatched reference', { body: REQUEST, refs: references({ mismatch: true }), code: 'REFERENCE_MISMATCH' }],
    ['reference failure', {
      body: REQUEST,
      refs: references({ error: new Error('private-provider-diagnostic') }),
      code: 'REFERENCE_READ_FAILED',
    }],
  ];

  for (const [name, input] of cases) {
    await t.test(name, async () => {
      const store = new MemoryStore();
      await expectCode(executeWriterTransferCreateApiRequest({
        references: input.refs,
        store,
        randomUuid: () => TX_ID,
      }, input.body), input.code);
      assert.equal(store.creates, 0);
    });
  }
});

test('TRANSFER Writer API source is framework/provider-neutral and delegates only to the existing application contract', async () => {
  const source = await readFile(new URL('../../src/writer/transferCreateApi.ts', import.meta.url), 'utf8');

  assert.match(source, /executeIdempotentTransferCreate/u);
  assert.match(source, /\.\/idempotentTransferCreate\.js/u);
  assert.doesNotMatch(source, /integration\/ydb|YdbAdapter|fetch\(|indexedDB|requestContext|apiGateway|OWNER_SESSION|cookie|Cloud Function|Yandex/u);
  assert.doesNotMatch(source, /validateTransaction|amountMinor\s*<=|UUID_PATTERN|DATE_PATTERN|flowKind\s*:/u);
});
