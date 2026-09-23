import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWu7TemporaryThrottlingGate } from '../../dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.js';

const environment = Object.freeze({
  PRIHRASH_YC_FOLDER_ID: 'folder-safe',
  PRIHRASH_YDB_CONNECTION_STRING: 'grpcs://ydb.example.test:2135/?database=/ru-central1/folder-safe/database-safe',
});
const context = Object.freeze({ token: Object.freeze({ access_token: 'token-safe' }) });
const noSleep = async () => {};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function database(limit, extra = {}) {
  return {
    id: 'database-safe',
    folderId: 'folder-safe',
    serverlessDatabase: {
      enableThrottlingRcuLimit: true,
      throttlingRcuLimit: String(limit),
      ...extra,
    },
  };
}

function sequence(values) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (values.length === 0) throw new Error('unexpected fetch');
    return values.shift();
  };
  return { calls, fetchImpl };
}
test('READ exposes only exact safe 10/14 state and proto3 omitted provisioned=0', async () => {
  const io = sequence([response(database(10))]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'READ' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'PASS',
    code: 'WU7_THROTTLING_STATE_CLASSIFIED',
    throttlingEnabled: true,
    throttlingRcuLimit: 10,
    provisionedRcuLimit: 0,
  });
  assert.equal(io.calls.length, 1);
  assert.equal(io.calls[0].init.method, 'GET');
});

test('SET_14 changes only throttlingRcuLimit, waits operation, then proves exact read-back', async () => {
  const io = sequence([
    response(database(10, { provisionedRcuLimit: '0' })),
    response({ id: 'operation-safe', done: false }),
    response({ id: 'operation-safe', done: true, response: {} }),
    response(database(14)),
  ]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, { status: 'PASS', code: 'WU7_THROTTLING_SET_14' });
  assert.equal(io.calls[1].init.method, 'PATCH');
  assert.equal(io.calls[2].init.method, 'PATCH');
  assert.equal(io.calls[1].input, io.calls[2].input);
  assert.equal(io.calls[1].init.body, io.calls[2].init.body);
  const idempotencyKey = io.calls[1].init.headers['Idempotency-Key'];
  assert.match(idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(io.calls[2].init.headers['Idempotency-Key'], idempotencyKey);
  assert.equal(io.calls.some((call) => String(call.input).includes('operation.api.cloud.yandex.net')), false);
  const body = JSON.parse(io.calls[1].init.body);
  assert.deepEqual(body, {
    folderId: 'folder-safe',
    updateMask: 'serverlessDatabase.throttlingRcuLimit',
    serverlessDatabase: { throttlingRcuLimit: '14' },
  });
  assert.equal(Object.hasOwn(body.serverlessDatabase, 'enableThrottlingRcuLimit'), false);
  assert.equal(Object.hasOwn(body.serverlessDatabase, 'provisionedRcuLimit'), false);
});
test('RESTORE_10 is read-only when state already proves exact 10', async () => {
  const io = sequence([response(database(10))]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'RESTORE_10' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, { status: 'PASS', code: 'WU7_THROTTLING_RESTORED_10' });
  assert.equal(io.calls.length, 1);
});

test('RESTORE_10 changes exact 14 back to exact 10', async () => {
  const io = sequence([
    response(database(14)),
    response({ id: 'operation-safe', done: false }),
    response({ id: 'operation-safe', done: true, response: {} }),
    response(database(10)),
  ]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'RESTORE_10' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, { status: 'PASS', code: 'WU7_THROTTLING_RESTORED_10' });
  assert.equal(JSON.parse(io.calls[1].init.body).serverlessDatabase.throttlingRcuLimit, '10');
});

test('unexpected cap or provisioned capacity fails closed before mutation', async () => {
  for (const current of [
    database(14),
    database(15),
    database(10, { provisionedRcuLimit: '1' }),
  ]) {
    const io = sequence([response(current)]);
    const result = await executeWu7TemporaryThrottlingGate(
      { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
    );
    assert.deepEqual(result, {
      status: 'STOP',
      code: 'WU7_THROTTLING_GATE_STOP',
      stage: 'STATE_NOT_EXACT',
    });
    assert.equal(io.calls.length, 1);
  }
});

test('unknown update outcome never becomes success', async () => {
  const io = sequence([response(database(10)), response({}, 503)]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'STOP',
    code: 'WU7_THROTTLING_GATE_STOP',
    stage: 'UPDATE_TRANSPORT',
  });
});


test('terminal provider operation error stays fail-closed without read-back success', async () => {
  const io = sequence([
    response(database(10)),
    response({ id: 'operation-safe', done: false }),
    response({ id: 'operation-safe', done: true, error: { code: 1 } }),
  ]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'STOP',
    code: 'WU7_THROTTLING_GATE_STOP',
    stage: 'UPDATE_FAILED',
  });
  assert.equal(io.calls.length, 3);
});


test('operation permission failure is classified without waiting or exposing provider payload', async () => {
  const io = sequence([
    response(database(10)),
    response({ id: 'operation-safe', done: false }),
    response({}, 403),
  ]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'STOP',
    code: 'WU7_THROTTLING_GATE_STOP',
    stage: 'UPDATE_AUTH',
  });
  assert.equal(io.calls.length, 3);
});

test('operation not-found is a distinct fail-closed terminal-proof failure', async () => {
  const io = sequence([
    response(database(10)),
    response({ id: 'operation-safe', done: false }),
    response({}, 404),
  ]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'STOP',
    code: 'WU7_THROTTLING_GATE_STOP',
    stage: 'UPDATE_NOT_FOUND',
  });
});

test('operation that never becomes terminal is not accepted from state transition alone', async () => {
  const values = [
    response(database(10)),
    response({ id: 'operation-safe', done: false }),
    ...Array.from({ length: 149 }, () => response({ id: 'operation-safe', done: false })),
  ];
  const io = sequence(values);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'STOP',
    code: 'WU7_THROTTLING_GATE_STOP',
    stage: 'UPDATE_NOT_TERMINAL',
  });
  assert.equal(io.calls.some((call) => String(call.input).includes('/operations/')), false);
});

test('malformed terminal operation never becomes success', async () => {
  const io = sequence([
    response(database(10)),
    response({ id: 'operation-safe', done: false }),
    response({ id: 'operation-safe', done: true }),
  ]);
  const result = await executeWu7TemporaryThrottlingGate(
    { action: 'SET_14' }, environment, context, io.fetchImpl, noSleep,
  );
  assert.deepEqual(result, {
    status: 'STOP',
    code: 'WU7_THROTTLING_GATE_STOP',
    stage: 'UPDATE_MALFORMED',
  });
});
