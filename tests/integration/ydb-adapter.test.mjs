import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YdbAdapter,
  YdbAdapterError,
  YdbCommitOutcomeUnknownError,
  YdbTransportCommitOutcomeUnknownError,
  readStatement,
  writeStatement,
} from '../../dist/integration/ydb/adapter.js';
import {
  YdbParameterError,
  dateParameter,
  int64Parameter,
  jsonDocumentParameter,
  stringParameter,
  timestampParameter,
  uint32Parameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../../dist/integration/ydb/parameters.js';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

function createFakeTransport(options = {}) {
  const events = [];
  const result = { rows: [{ ok: true }] };
  const transport = {
    async executeRead(statement) {
      events.push(['read', statement]);
      return result;
    },
    async serializableReadWrite(work) {
      events.push(['begin']);
      const transaction = Object.freeze({
        async execute(statement) {
          events.push(['execute', statement]);
          if (options.executeError) throw options.executeError;
          return result;
        },
      });

      let value;
      try {
        value = await work(transaction);
      } catch (error) {
        events.push(['rollback']);
        if (options.rollbackError) {
          throw new AggregateError([error, options.rollbackError], 'YDB_TRANSACTION_ROLLBACK_FAILED');
        }
        throw error;
      }

      events.push(['commit']);
      if (options.commitError) {
        throw new YdbTransportCommitOutcomeUnknownError(options.commitError);
      }
      return value;
    },
  };
  return { events, result, transport };
}

function expectParameterError(code, fn) {
  assert.throws(fn, (error) => error instanceof YdbParameterError && error.code === code);
}

test('typed parameter mapping preserves explicit target types, including null', () => {
  assert.deepEqual(uuidParameter(VALID_UUID.toUpperCase()), { type: 'Uuid', value: VALID_UUID });
  assert.deepEqual(uuidParameter('00000000-0000-0000-0000-000000000001'), {
    type: 'Uuid',
    value: '00000000-0000-0000-0000-000000000001',
  });
  assert.deepEqual(uuidParameter(null), { type: 'Uuid', value: null });
  assert.deepEqual(utf8Parameter('RUB'), { type: 'Utf8', value: 'RUB' });
  assert.deepEqual(stringParameter('digest'), { type: 'String', value: 'digest' });
  assert.deepEqual(int64Parameter(123), { type: 'Int64', value: 123n });
  assert.deepEqual(uint64Parameter(123n), { type: 'Uint64', value: 123n });
  assert.deepEqual(uint32Parameter(14), { type: 'Uint32', value: 14 });
  assert.deepEqual(dateParameter('2026-09-06'), { type: 'Date', value: '2026-09-06' });
  assert.deepEqual(timestampParameter('2026-09-06T17:00:00.123456Z'), {
    type: 'Timestamp',
    value: '2026-09-06T17:00:00.123456Z',
  });
  assert.deepEqual(jsonDocumentParameter('{"adapter_schema_version":1}'), {
    type: 'JsonDocument',
    value: '{"adapter_schema_version":1}',
  });
});

test('parameter mapping fails closed on invalid or lossy values', () => {
  expectParameterError('INVALID_UUID', () => uuidParameter('not-a-uuid'));
  expectParameterError('INVALID_UUID', () => uuidParameter('123e4567e89b42d3a456426614174000'));
  expectParameterError('INVALID_DATE', () => dateParameter('2026-02-30'));
  expectParameterError('INVALID_DATE', () => dateParameter('1969-12-31'));
  expectParameterError('INVALID_DATE', () => dateParameter('2106-01-01'));
  expectParameterError('INVALID_TIMESTAMP', () => timestampParameter('2026-09-06T17:00:00+03:00'));
  expectParameterError('INVALID_TIMESTAMP', () => timestampParameter('2026-09-06T25:00:00Z'));
  expectParameterError('INVALID_TIMESTAMP', () => timestampParameter('1969-12-31T23:59:59Z'));
  expectParameterError('INVALID_TIMESTAMP', () => timestampParameter('2106-01-01T00:00:00Z'));
  expectParameterError('UNSAFE_INTEGER', () => int64Parameter(Number.MAX_SAFE_INTEGER + 1));
  expectParameterError('INT64_OUT_OF_RANGE', () => int64Parameter(1n << 63n));
  expectParameterError('UINT64_OUT_OF_RANGE', () => uint64Parameter(-1n));
  expectParameterError('UINT32_OUT_OF_RANGE', () => uint32Parameter(4_294_967_296));
  expectParameterError('INVALID_JSON_DOCUMENT', () => jsonDocumentParameter('{broken'));
});

test('read path rejects write statements before transport invocation', async () => {
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);
  const statement = writeStatement('UPSERT INTO migration_runs (id) VALUES ($id)', {
    id: uuidParameter(VALID_UUID),
  });

  await assert.rejects(
    () => adapter.read(statement),
    (error) => error instanceof YdbAdapterError && error.code === 'WRITE_REQUIRES_TRANSACTION',
  );
  assert.deepEqual(fake.events, []);
});

test('read path delegates parameterized statement without embedding values in text', async () => {
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);
  const privateLikeValue = "synthetic'); DELETE FROM transactions; --";
  const statement = readStatement('SELECT id FROM source_records WHERE current_digest = $digest', {
    digest: stringParameter(privateLikeValue),
  });

  const result = await adapter.read(statement);

  assert.equal(statement.text.includes(privateLikeValue), false);
  assert.equal(statement.parameters.digest?.value, privateLikeValue);
  assert.equal(result, fake.result);
  assert.deepEqual(fake.events.map(([name]) => name), ['read']);
});

test('serializable transaction commits only after successful callback', async () => {
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);
  const first = writeStatement('UPSERT INTO migration_runs (id, state) VALUES ($id, $state)', {
    id: uuidParameter(VALID_UUID),
    state: utf8Parameter('VALIDATED'),
  });
  const second = writeStatement('UPSERT INTO source_snapshots (id, row_count) VALUES ($id, $rows)', {
    id: uuidParameter('123e4567-e89b-42d3-a456-426614174001'),
    rows: uint64Parameter(17_790),
  });

  const value = await adapter.serializableReadWrite(async (transaction) => {
    assert.deepEqual(Object.keys(transaction), ['execute']);
    await transaction.execute(first);
    await transaction.execute(second);
    return 'committed';
  });

  assert.equal(value, 'committed');
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'execute', 'execute', 'commit']);
});

test('serializable transaction rolls back and preserves original error', async () => {
  const boom = new Error('synthetic write failed');
  const fake = createFakeTransport({ executeError: boom });
  const adapter = new YdbAdapter(fake.transport);
  const statement = writeStatement('UPDATE migration_runs SET state = $state WHERE id = $id', {
    id: uuidParameter(VALID_UUID),
    state: utf8Parameter('FAILED'),
  });

  await assert.rejects(
    () => adapter.serializableReadWrite(async (transaction) => transaction.execute(statement)),
    (error) => error === boom,
  );
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'execute', 'rollback']);
});

test('commit failure is fail-closed as unknown outcome and does not pretend rollback can undo it', async () => {
  const commitError = new Error('synthetic commit failed');
  const fake = createFakeTransport({ commitError });
  const adapter = new YdbAdapter(fake.transport);

  await assert.rejects(
    () => adapter.serializableReadWrite(async () => 'candidate'),
    (error) => (
      error instanceof YdbCommitOutcomeUnknownError
      && error.code === 'COMMIT_OUTCOME_UNKNOWN'
      && error.cause === commitError
    ),
  );
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'commit']);
});

test('rollback failure is not allowed to hide the primary transaction error', async () => {
  const primary = new Error('synthetic primary failure');
  const rollback = new Error('synthetic rollback failure');
  const fake = createFakeTransport({ rollbackError: rollback });
  const adapter = new YdbAdapter(fake.transport);

  await assert.rejects(
    () => adapter.serializableReadWrite(async () => { throw primary; }),
    (error) => (
      error instanceof AggregateError
      && error.message === 'YDB_TRANSACTION_ROLLBACK_FAILED'
      && error.errors[0] === primary
      && error.errors[1] === rollback
    ),
  );
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'rollback']);
});

test('adapter exposes no standalone auto-commit write method', () => {
  const fake = createFakeTransport();
  const adapter = new YdbAdapter(fake.transport);

  assert.equal('write' in adapter, false);
  assert.equal('upsertTransaction' in adapter, false);
  assert.equal('executeWrite' in adapter, false);
});
