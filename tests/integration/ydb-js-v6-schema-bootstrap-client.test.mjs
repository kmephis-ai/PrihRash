import assert from 'node:assert/strict';
import test from 'node:test';

import { readStatement, writeStatement } from '../../dist/integration/ydb/adapter.js';
import { stringParameter, timestampParameter, uint64Parameter } from '../../dist/integration/ydb/parameters.js';
import {
  createYdbJsV6SchemaBootstrapExecutor,
  createYdbJsV6SchemaBootstrapParameterMapper,
  YdbJsV6SchemaBootstrapClientError,
} from '../../dist/integration/ydb/ydbJsV6SchemaBootstrapClient.js';

class FakeValue {
  constructor(value) {
    this.value = value;
  }
}

function fakeSdk() {
  return Object.freeze({
    Bytes: FakeValue,
    Uint64: FakeValue,
    Timestamp: FakeValue,
  });
}

function makeExecutor(events, rows = []) {
  return (text) => {
    events.push(['query', text]);
    return Object.assign(Promise.resolve([rows]), {
      parameter(name, value) {
        events.push(['parameter', name, value]);
        return this;
      },
      idempotent(value = true) {
        events.push(['idempotent', value]);
        return this;
      },
    });
  };
}

test('schema bootstrap executor runs trusted DDL directly and binds its narrow ledger parameter types', async () => {
  const events = [];
  const sql = makeExecutor(events);
  const executor = createYdbJsV6SchemaBootstrapExecutor(
    sql,
    createYdbJsV6SchemaBootstrapParameterMapper(fakeSdk()),
  );
  const statement = writeStatement(
    'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES ($version, $checksum, $applied_at)',
    {
      '$version': uint64Parameter(1),
      '$checksum': stringParameter('sha256:synthetic'),
      '$applied_at': timestampParameter('2026-09-11T10:50:00.000Z'),
    },
  );

  await executor.execute(statement);

  assert.deepEqual(events[0], ['query', statement.text]);
  assert.equal(events.some(([kind]) => kind === 'begin'), false);
  assert.deepEqual(events.filter(([kind]) => kind === 'parameter').map(([, name]) => name), [
    '$version',
    '$checksum',
    '$applied_at',
  ]);
  assert.equal(events.some(([kind]) => kind === 'idempotent'), false);
});

test('schema bootstrap executor marks only read statements idempotent for SDK retry', async () => {
  const events = [];
  const executor = createYdbJsV6SchemaBootstrapExecutor(
    makeExecutor(events, [{ version: 1n }]),
    createYdbJsV6SchemaBootstrapParameterMapper(fakeSdk()),
  );
  const statement = readStatement('SELECT version FROM schema_migrations ORDER BY version ASC');

  const result = await executor.execute(statement);

  assert.deepEqual(result.rows, [{ version: 1n }]);
  assert.deepEqual(events.filter(([kind]) => kind === 'idempotent'), [['idempotent', true]]);
  assert.equal(events.some(([kind]) => kind === 'parameter'), false);
});

test('schema bootstrap parameter mapper rejects unsupported application parameter types', () => {
  const mapper = createYdbJsV6SchemaBootstrapParameterMapper(fakeSdk());
  assert.throws(
    () => mapper({ type: 'Utf8', value: 'forbidden-broad-type' }),
    (error) => error instanceof YdbJsV6SchemaBootstrapClientError
      && error.code === 'PARAMETER_TYPE_UNSUPPORTED',
  );
});

test('schema bootstrap executor rejects an invalid SDK executor shape before provider access', () => {
  assert.throws(
    () => createYdbJsV6SchemaBootstrapExecutor(null, () => null),
    (error) => error instanceof YdbJsV6SchemaBootstrapClientError && error.code === 'SDK_SHAPE_INVALID',
  );
});
