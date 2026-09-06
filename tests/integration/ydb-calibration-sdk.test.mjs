import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { YdbTransportCommitOutcomeUnknownError, readStatement, writeStatement } from '../../dist/integration/ydb/adapter.js';
import {
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
import {
  CALIBRATION_SDK_VERSIONS,
  YdbCalibrationBindingError,
  createSdkParameterMapper,
  createYdbJsTransport,
  validateCalibrationConfig,
} from '../../tools/ydb-calibration/sdk-binding.mjs';

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
  };
  for (const type of ['Uuid', 'Utf8', 'Int64', 'Uint64', 'Uint32', 'Date', 'Timestamp', 'JsonDocument']) {
    sdk[type] = valueClass(type);
    sdk[`${type}Type`] = typeClass(`${type}Type`);
  }
  sdk.Bytes = valueClass('Bytes');
  sdk.BytesType = typeClass('BytesType');
  return sdk;
}

function expectBindingError(code, fn) {
  assert.throws(fn, (error) => error instanceof YdbCalibrationBindingError && error.code === code);
}

function makeExecutor(events, rows = []) {
  return function executor(text) {
    events.push(['query', text]);
    const builder = {
      parameter(name, value) {
        events.push(['parameter', name, value]);
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve([rows]).then(resolve, reject);
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
    const tx = makeExecutor(events, []);
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

test('calibration tooling pins the current reviewed SDK versions exactly', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../../tools/ydb-calibration/package.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(packageJson.dependencies, CALIBRATION_SDK_VERSIONS);
});

test('calibration config fails closed unless endpoint and scope are explicitly test/private Serverless YDB', () => {
  const valid = {
    PRIHRASH_YDB_CALIBRATION_SCOPE: 'TEST_PRIVATE',
    YDB_CALIBRATION_CONNECTION_STRING: 'grpcs://ydb.serverless.yandexcloud.net:2135/?database=/synthetic/test',
    YDB_SERVICE_ACCOUNT_KEY_FILE_CREDENTIALS: '/runner/private/key.json',
  };
  const config = validateCalibrationConfig(valid);
  assert.deepEqual(config.safeSummary, {
    scope: 'TEST_PRIVATE',
    protocol: 'grpcs',
    provider: 'YANDEX_CLOUD_SERVERLESS_YDB',
    databaseIdentity: 'CONFIGURED_PRIVATE',
    credentials: 'CONFIGURED_PRIVATE',
  });
  assert.equal(JSON.stringify(config.safeSummary).includes('/synthetic/test'), false);
  assert.equal(JSON.stringify(config.safeSummary).includes('/runner/private/key.json'), false);

  expectBindingError('CALIBRATION_SCOPE_NOT_TEST_PRIVATE', () => validateCalibrationConfig({ ...valid, PRIHRASH_YDB_CALIBRATION_SCOPE: 'PRODUCTION' }));
  expectBindingError('CALIBRATION_CONNECTION_STRING_NOT_SERVERLESS_TEST_SHAPE', () => validateCalibrationConfig({ ...valid, YDB_CALIBRATION_CONNECTION_STRING: 'grpc://ydb.serverless.yandexcloud.net:2135/?database=/synthetic/test' }));
  expectBindingError('CALIBRATION_CONNECTION_STRING_NOT_SERVERLESS_TEST_SHAPE', () => validateCalibrationConfig({ ...valid, YDB_CALIBRATION_CONNECTION_STRING: 'grpcs://example.invalid:2135/?database=/synthetic/test' }));
  expectBindingError('CALIBRATION_CONNECTION_STRING_NOT_SERVERLESS_TEST_SHAPE', () => validateCalibrationConfig({ ...valid, YDB_CALIBRATION_CONNECTION_STRING: 'grpcs://ydb.serverless.yandexcloud.net:2135/' }));
  expectBindingError('CALIBRATION_CREDENTIAL_FILE_MISSING', () => validateCalibrationConfig({ ...valid, YDB_SERVICE_ACCOUNT_KEY_FILE_CREDENTIALS: '' }));
});

test('SDK parameter mapper preserves explicit primitives and encodes YDB String as bytes', () => {
  const map = createSdkParameterMapper(fakeSdk());
  assert.equal(map(uuidParameter('123e4567-e89b-42d3-a456-426614174000')).kind, 'Uuid');
  assert.equal(map(utf8Parameter('RUB')).kind, 'Utf8');
  assert.equal(map(int64Parameter(-3n)).value, -3n);
  assert.equal(map(uint64Parameter(3n)).value, 3n);
  assert.equal(map(uint32Parameter(3)).value, 3);
  assert.equal(map(dateParameter('2026-09-06')).value.toISOString(), '2026-09-06T00:00:00.000Z');
  assert.equal(map(jsonDocumentParameter('{"synthetic":true}')).kind, 'JsonDocument');

  const bytes = map(stringParameter('digest'));
  assert.equal(bytes.kind, 'Bytes');
  assert.equal(new TextDecoder().decode(bytes.value), 'digest');
});

test('typed null keeps its target item type', () => {
  const map = createSdkParameterMapper(fakeSdk());

  const uuidNull = map(uuidParameter(null));
  assert.equal(uuidNull.kind, 'Optional');
  assert.equal(uuidNull.item, null);
  assert.equal(uuidNull.itemType.kind, 'UuidType');

  const stringNull = map(stringParameter(null));
  assert.equal(stringNull.kind, 'Optional');
  assert.equal(stringNull.item, null);
  assert.equal(stringNull.itemType.kind, 'BytesType');
});

test('Timestamp mapping rejects microseconds that JS Date would silently lose', () => {
  const map = createSdkParameterMapper(fakeSdk());
  const exact = map(timestampParameter('2026-09-06T17:00:00.123000Z'));
  assert.equal(exact.value.toISOString(), '2026-09-06T17:00:00.123Z');

  expectBindingError(
    'SDK_TIMESTAMP_PRECISION_UNSUPPORTED',
    () => map(timestampParameter('2026-09-06T17:00:00.123456Z')),
  );
});

test('transport binds values separately and returns the first result set as adapter rows', async () => {
  const fake = makeSql({ readRows: [{ id: 'synthetic' }] });
  const map = createSdkParameterMapper(fakeSdk());
  const transport = createYdbJsTransport(fake.sql, map);
  const statement = readStatement('SELECT id FROM source_records WHERE current_digest = $digest', {
    digest: stringParameter("synthetic'); DROP TABLE x; --"),
  });

  const result = await transport.executeRead(statement);
  assert.deepEqual(result.rows, [{ id: 'synthetic' }]);
  assert.equal(fake.events[0][1].includes('DROP TABLE'), false);
  assert.equal(fake.events[1][0], 'parameter');
  assert.equal(new TextDecoder().decode(fake.events[1][2].value), "synthetic'); DROP TABLE x; --");
});

test('transaction binding uses explicit non-idempotent serializable callback and preserves body failures', async () => {
  const fake = makeSql();
  const transport = createYdbJsTransport(fake.sql, createSdkParameterMapper(fakeSdk()));
  const statement = writeStatement('UPSERT INTO migration_runs (id) VALUES ($id)', {
    id: uuidParameter('123e4567-e89b-42d3-a456-426614174000'),
  });

  const bodyError = new Error('synthetic body failure');
  await assert.rejects(
    () => transport.serializableReadWrite(async (tx) => {
      await tx.execute(statement);
      throw bodyError;
    }),
    (error) => error === bodyError,
  );
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'query', 'parameter', 'rollback']);
  assert.deepEqual(fake.events[0][1], { isolation: 'serializableReadWrite', idempotent: false });
});

test('failure after a completed transaction body is classified as commit outcome unknown', async () => {
  const commitError = new Error('synthetic commit response lost');
  const fake = makeSql({ commitError });
  const transport = createYdbJsTransport(fake.sql, createSdkParameterMapper(fakeSdk()));

  await assert.rejects(
    () => transport.serializableReadWrite(async () => 'candidate'),
    (error) => error instanceof YdbTransportCommitOutcomeUnknownError && error.cause === commitError,
  );
  assert.deepEqual(fake.events.map(([name]) => name), ['begin', 'commit']);
});
