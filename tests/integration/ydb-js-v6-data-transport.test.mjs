import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { StatusIds_StatusCode } from '@ydbjs/api/operation';
import { List } from '@ydbjs/value/list';
import { Optional, OptionalType } from '@ydbjs/value/optional';
import * as primitive from '@ydbjs/value/primitive';
import { Struct, StructType } from '@ydbjs/value/struct';

import {
  YdbAdapter,
  YdbCommitOutcomeUnknownError,
  readStatement,
  writeStatement,
} from '../../dist/integration/ydb/adapter.js';
import {
  int64Parameter,
  listStructParameter,
  stringParameter,
  timestampParameter,
  uint64Parameter,
  utf8Parameter,
  uuidParameter,
} from '../../dist/integration/ydb/parameters.js';
import {
  YDB_JS_DATA_SDK_VERSIONS,
  YdbJsV6DataTransportError,
  createYdbJsV6DataClient,
  createYdbJsV6DataTransport,
  createYdbJsV6ParameterMapper,
} from '../../dist/integration/ydb/ydbJsV6DataTransport.js';

function valueClass(name) {
  return class {
    constructor(value) {
      this.kind = name;
      this.value = value;
    }
  };
}

function typeClass(name) {
  return class {
    constructor() {
      this.kind = name;
    }
  };
}

function fakeSdk() {
  const sdk = {
    Optional: class {
      constructor(item, itemType) {
        this.kind = 'Optional';
        this.item = item;
        this.itemType = itemType;
      }
    },
    OptionalType: class {
      constructor(itemType) {
        this.kind = 'OptionalType';
        this.itemType = itemType;
      }
    },
    StructType: class {
      constructor(names, types) {
        this.kind = 'StructType';
        this.names = names;
        this.types = types;
      }
    },
    Struct: class {
      constructor(fields, type) {
        this.kind = 'Struct';
        this.fields = fields;
        this.type = type;
      }
    },
    List: class {
      constructor(...items) {
        this.kind = 'List';
        this.items = items;
      }
    },
  };
  for (const type of ['Uuid', 'Utf8', 'Int64', 'Uint64', 'Uint32', 'Date', 'Timestamp', 'JsonDocument']) {
    sdk[type] = valueClass(type);
    sdk[`${type}Type`] = typeClass(`${type}Type`);
  }
  sdk.Bytes = valueClass('Bytes');
  sdk.BytesType = typeClass('BytesType');
  return sdk;
}

function makeExecutor(events, rows = []) {
  return function executor(text) {
    events.push(['query', text]);
    const builder = {
      parameter(name, value) {
        events.push(['parameter', name, value]);
        return builder;
      },
      timeout(timeoutMs) {
        events.push(['timeout', timeoutMs]);
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve([rows]).then(resolve, reject);
      },
    };
    return builder;
  };
}

function makeRejectingExecutor(error) {
  return function executor() {
    const builder = {
      parameter() {
        return builder;
      },
      then(resolve, reject) {
        return Promise.reject(error).then(resolve, reject);
      },
    };
    return builder;
  };
}

function makeSql(options = {}) {
  const events = [];
  const sql = makeExecutor(events, options.readRows ?? []);
  sql.begin = async (txOptions, work) => {
    events.push(['begin', txOptions]);
    const tx = makeExecutor(events, options.transactionRows ?? []);
    let result;
    try {
      result = await work(tx);
    } catch (error) {
      events.push(['rollback']);
      throw error;
    }
    events.push(['commit']);
    if (options.commitError) throw options.commitError;
    return result;
  };
  return { events, sql };
}

test('production data transport pins the reviewed calibration SDK versions in root package', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../../package.json', import.meta.url),
    'utf8',
  ));
  for (const [name, version] of Object.entries(YDB_JS_DATA_SDK_VERSIONS)) {
    assert.equal(packageJson.dependencies[name], version);
  }
});

test('parameter mapper preserves typed values, null target type and byte String encoding', () => {
  const map = createYdbJsV6ParameterMapper(fakeSdk());
  assert.equal(map(uuidParameter('123e4567-e89b-42d3-a456-426614174000')).kind, 'Uuid');
  assert.equal(map(utf8Parameter('RUB')).kind, 'Utf8');
  assert.equal(map(int64Parameter(-3n)).value, -3n);
  assert.equal(map(timestampParameter('2026-09-07T17:00:00.123Z')).value.toISOString(), '2026-09-07T17:00:00.123Z');

  const bytes = map(stringParameter('synthetic-digest'));
  assert.equal(bytes.kind, 'Bytes');
  assert.equal(new TextDecoder().decode(bytes.value), 'synthetic-digest');

  const nullString = map(stringParameter(null));
  assert.equal(nullString.kind, 'Optional');
  assert.equal(nullString.item, null);
  assert.equal(nullString.itemType.kind, 'BytesType');
});

test('parameter mapper builds a List<Struct> table parameter with exact nullability', () => {
  const map = createYdbJsV6ParameterMapper(fakeSdk());
  const rows = listStructParameter([
    { name: 'id', type: 'Uuid', nullable: false },
    { name: 'note', type: 'Utf8', nullable: true },
  ], [
    {
      id: uuidParameter('123e4567-e89b-42d3-a456-426614174000'),
      note: utf8Parameter(null),
    },
    {
      id: uuidParameter('123e4567-e89b-42d3-a456-426614174001'),
      note: utf8Parameter('synthetic'),
    },
  ]);

  const mapped = map(rows);
  assert.equal(mapped.kind, 'List');
  assert.equal(mapped.items.length, 2);
  assert.equal(mapped.items[0].kind, 'Struct');
  assert.equal(mapped.items[0].fields.id.kind, 'Uuid');
  assert.equal(mapped.items[0].fields.note.kind, 'Optional');
  assert.equal(mapped.items[0].fields.note.item, null);
  assert.equal(mapped.items[1].fields.note.kind, 'Optional');
  assert.equal(mapped.items[1].fields.note.item.kind, 'Utf8');
  assert.deepEqual(mapped.items[0].type.names, ['id', 'note']);
  assert.equal(mapped.items[0].type.types[0].kind, 'UuidType');
  assert.equal(mapped.items[0].type.types[1].kind, 'OptionalType');
});

test('pinned @ydbjs/value 6.0.8 encodes the List<Struct> table parameter shape', () => {
  const map = createYdbJsV6ParameterMapper(Object.freeze({
    ...primitive,
    Optional,
    OptionalType,
    List,
    Struct,
    StructType,
  }));
  const mapped = map(listStructParameter([
    { name: 'source_record_id', type: 'Uuid', nullable: false },
    { name: 'revision', type: 'Uint64', nullable: false },
    { name: 'change_class', type: 'Utf8', nullable: true },
  ], [{
    source_record_id: uuidParameter('123e4567-e89b-42d3-a456-426614174000'),
    revision: uint64Parameter(1n),
    change_class: utf8Parameter(null),
  }]));

  assert.equal(mapped instanceof List, true);
  assert.doesNotThrow(() => mapped.type.encode());
  assert.doesNotThrow(() => mapped.encode());
});

test('parameter mapper rejects timestamp precision that JS Date would silently lose', () => {
  const map = createYdbJsV6ParameterMapper(fakeSdk());
  assert.throws(
    () => map(timestampParameter('2026-09-07T17:00:00.123456Z')),
    (error) => error instanceof YdbJsV6DataTransportError
      && error.code === 'TIMESTAMP_PRECISION_UNSUPPORTED',
  );
});

test('concrete transport binds values separately and supports adapter read plus serializable write', async () => {
  const { events, sql } = makeSql({
    readRows: [{ id: 'synthetic-read' }],
    transactionRows: [{ id: 'synthetic-write' }],
  });
  const map = createYdbJsV6ParameterMapper(fakeSdk());
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(sql, map));
  const privateLikeValue = "synthetic'); DELETE FROM transactions; --";

  const readResult = await adapter.read(readStatement(
    'SELECT id FROM source_records WHERE current_digest = $digest',
    { digest: stringParameter(privateLikeValue) },
  ));
  const writeResult = await adapter.serializableReadWrite((transaction) => transaction.execute(writeStatement(
    'UPDATE migration_runs SET state = $state WHERE id = $id RETURNING id',
    {
      state: utf8Parameter('VALIDATED'),
      id: uuidParameter('123e4567-e89b-42d3-a456-426614174000'),
    },
  )));

  assert.deepEqual(readResult.rows, [{ id: 'synthetic-read' }]);
  assert.deepEqual(writeResult.rows, [{ id: 'synthetic-write' }]);
  assert.equal(events.some(([kind, text]) => kind === 'query' && String(text).includes(privateLikeValue)), false);
  assert.deepEqual(
    events.filter(([kind]) => kind === 'begin').map(([, options]) => options),
    [{ isolation: 'serializableReadWrite', idempotent: false }],
  );
  assert.equal(events.some(([kind, name]) => kind === 'parameter' && name === 'digest'), true);
});

test('optional read timeout reaches SDK query builder without changing transaction statements', async () => {
  const { events, sql } = makeSql({
    readRows: [{ id: 'synthetic-read' }],
    transactionRows: [{ id: 'synthetic-write' }],
  });
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(
    sql,
    createYdbJsV6ParameterMapper(fakeSdk()),
    { readTimeoutMs: 21_000 },
  ));

  await adapter.read(readStatement('SELECT 1'));
  await adapter.serializableReadWrite((transaction) => (
    transaction.execute(writeStatement('UPSERT INTO synthetic SELECT 1'))
  ));

  assert.deepEqual(
    events.filter(([kind]) => kind === 'timeout'),
    [['timeout', 21_000]],
  );
});

test('driver query rejection becomes privacy-safe transport code for reads and transaction statements', async () => {
  const providerFailure = new Error('synthetic private provider detail');
  const sql = makeRejectingExecutor(providerFailure);
  sql.begin = async (_options, work) => work(makeRejectingExecutor(providerFailure));
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(
    sql,
    createYdbJsV6ParameterMapper(fakeSdk()),
  ));

  const assertSanitized = (error) => {
    assert.equal(error instanceof YdbJsV6DataTransportError, true);
    assert.equal(error.code, 'QUERY_EXECUTION_FAILED');
    assert.equal(error.message, 'QUERY_EXECUTION_FAILED');
    assert.equal(error.message.includes('provider detail'), false);
    assert.equal('cause' in error, false);
    return true;
  };

  await assert.rejects(
    () => adapter.read(readStatement('SELECT 1')),
    assertSanitized,
  );
  await assert.rejects(
    () => adapter.serializableReadWrite((transaction) => transaction.execute(writeStatement('UPSERT INTO synthetic SELECT 1'))),
    assertSanitized,
  );
});

test('YDB query status is preserved as an enum-only transport code without provider issues', async () => {
  class YDBError extends Error {
    constructor(code) {
      super('synthetic private YDB issue text');
      this.code = code;
      this.issues = [{ message: 'synthetic private issue payload' }];
    }
  }

  for (const [status, expected] of [
    [StatusIds_StatusCode.BAD_REQUEST, 'QUERY_EXECUTION_YDB_BAD_REQUEST'],
    [StatusIds_StatusCode.PRECONDITION_FAILED, 'QUERY_EXECUTION_YDB_PRECONDITION_FAILED'],
    [StatusIds_StatusCode.ALREADY_EXISTS, 'QUERY_EXECUTION_YDB_ALREADY_EXISTS'],
    [StatusIds_StatusCode.UNAVAILABLE, 'QUERY_EXECUTION_YDB_UNAVAILABLE'],
  ]) {
    const providerFailure = new YDBError(status);
    const sql = makeRejectingExecutor(providerFailure);
    sql.begin = async (_options, work) => work(makeRejectingExecutor(providerFailure));
    const adapter = new YdbAdapter(createYdbJsV6DataTransport(
      sql,
      createYdbJsV6ParameterMapper(fakeSdk()),
    ));

    const assertSanitized = (error) => {
      assert.equal(error instanceof YdbJsV6DataTransportError, true);
      assert.equal(error.code, expected);
      assert.equal(error.message, expected);
      assert.equal(error.message.includes('private'), false);
      assert.equal('issues' in error, false);
      assert.equal('cause' in error, false);
      return true;
    };

    await assert.rejects(() => adapter.read(readStatement('SELECT 1')), assertSanitized);
    await assert.rejects(
      () => adapter.serializableReadWrite((transaction) => (
        transaction.execute(writeStatement('UPSERT INTO synthetic SELECT 1'))
      )),
      assertSanitized,
    );
  }
});

test('transaction body failure stays definite while post-body commit failure becomes outcome unknown', async () => {
  const bodyFailure = new Error('synthetic body failure');
  const first = makeSql();
  const firstAdapter = new YdbAdapter(createYdbJsV6DataTransport(
    first.sql,
    createYdbJsV6ParameterMapper(fakeSdk()),
  ));

  await assert.rejects(
    () => firstAdapter.serializableReadWrite(async () => { throw bodyFailure; }),
    (error) => error === bodyFailure,
  );
  assert.equal(first.events.some(([kind]) => kind === 'rollback'), true);

  const commitFailure = new Error('synthetic commit failure');
  const second = makeSql({ commitError: commitFailure });
  const secondAdapter = new YdbAdapter(createYdbJsV6DataTransport(
    second.sql,
    createYdbJsV6ParameterMapper(fakeSdk()),
  ));

  await assert.rejects(
    () => secondAdapter.serializableReadWrite(async () => 'completed-body'),
    (error) => error instanceof YdbCommitOutcomeUnknownError
      && error.code === 'COMMIT_OUTCOME_UNKNOWN'
      && error.cause === commitFailure,
  );
});

test('client config fails before dynamic SDK/client creation', async () => {
  await assert.rejects(
    () => createYdbJsV6DataClient({ connectionString: '', credentialFile: '/synthetic/key.json' }),
    (error) => error instanceof YdbJsV6DataTransportError && error.code === 'CLIENT_CONFIG_INVALID',
  );
  await assert.rejects(
    () => createYdbJsV6DataClient({
      connectionString: 'grpcs://synthetic.invalid:2135/?database=/synthetic',
      credentialFile: '/synthetic/key.json',
      poolMaxSize: 0,
    }),
    (error) => error instanceof YdbJsV6DataTransportError && error.code === 'CLIENT_CONFIG_INVALID',
  );
  await assert.rejects(
    () => createYdbJsV6DataClient({
      connectionString: 'grpcs://synthetic.invalid:2135/?database=/synthetic',
      credentialFile: '/synthetic/key.json',
      readTimeoutMs: 0,
    }),
    (error) => error instanceof YdbJsV6DataTransportError && error.code === 'CLIENT_CONFIG_INVALID',
  );
});
