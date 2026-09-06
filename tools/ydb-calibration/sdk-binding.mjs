import { YdbTransportCommitOutcomeUnknownError } from '../../dist/integration/ydb/adapter.js';

const SERVERLESS_HOST = 'ydb.serverless.yandexcloud.net';
const SERVERLESS_PORT = '2135';
const TEST_PRIVATE_SCOPE = 'TEST_PRIVATE';
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;
const textEncoder = new TextEncoder();

export const CALIBRATION_SDK_VERSIONS = Object.freeze({
  '@ydbjs/auth-yandex-cloud': '0.2.0',
  '@ydbjs/core': '6.3.1',
  '@ydbjs/query': '6.3.0',
  '@ydbjs/value': '6.0.8',
});

export class YdbCalibrationBindingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'YdbCalibrationBindingError';
    this.code = code;
  }
}

function fail(code) {
  throw new YdbCalibrationBindingError(code);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasDatabaseIdentity(url) {
  const queryDatabase = url.searchParams.get('database');
  if (nonEmptyString(queryDatabase) && queryDatabase.startsWith('/')) return true;
  return url.pathname.length > 1;
}

export function validateCalibrationConfig(env) {
  if (env.PRIHRASH_YDB_CALIBRATION_SCOPE !== TEST_PRIVATE_SCOPE) {
    fail('CALIBRATION_SCOPE_NOT_TEST_PRIVATE');
  }

  const connectionString = env.YDB_CALIBRATION_CONNECTION_STRING;
  if (!nonEmptyString(connectionString)) fail('CALIBRATION_CONNECTION_STRING_MISSING');

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    fail('CALIBRATION_CONNECTION_STRING_INVALID');
  }

  if (
    url.protocol !== 'grpcs:'
    || url.hostname !== SERVERLESS_HOST
    || url.port !== SERVERLESS_PORT
    || !hasDatabaseIdentity(url)
  ) {
    fail('CALIBRATION_CONNECTION_STRING_NOT_SERVERLESS_TEST_SHAPE');
  }

  const credentialFile = env.YDB_SERVICE_ACCOUNT_KEY_FILE_CREDENTIALS;
  if (!nonEmptyString(credentialFile)) fail('CALIBRATION_CREDENTIAL_FILE_MISSING');

  return Object.freeze({
    scope: TEST_PRIVATE_SCOPE,
    connectionString,
    credentialFile,
    safeSummary: Object.freeze({
      scope: TEST_PRIVATE_SCOPE,
      protocol: 'grpcs',
      provider: 'YANDEX_CLOUD_SERVERLESS_YDB',
      databaseIdentity: 'CONFIGURED_PRIVATE',
      credentials: 'CONFIGURED_PRIVATE',
    }),
  });
}

function requireSdkClass(sdk, name) {
  const value = sdk[name];
  if (typeof value !== 'function') fail('CALIBRATION_SDK_SHAPE_INVALID');
  return value;
}

function itemTypeFor(sdk, type) {
  const className = type === 'String' ? 'BytesType' : `${type}Type`;
  const TypeClass = requireSdkClass(sdk, className);
  return new TypeClass();
}

function toTimestampDate(value) {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (match === null) fail('CALIBRATION_PARAMETER_VALUE_INVALID');

  const fraction = (match[2] ?? '').padEnd(6, '0');
  const microseconds = Number(fraction || '0');
  if (microseconds % 1000 !== 0) fail('SDK_TIMESTAMP_PRECISION_UNSUPPORTED');

  const milliseconds = String(microseconds / 1000).padStart(3, '0');
  const date = new globalThis.Date(`${match[1]}.${milliseconds}Z`);
  if (!Number.isFinite(date.getTime())) fail('CALIBRATION_PARAMETER_VALUE_INVALID');
  return date;
}

function toDate(value) {
  const date = new globalThis.Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) fail('CALIBRATION_PARAMETER_VALUE_INVALID');
  return date;
}

export function createSdkParameterMapper(sdk) {
  const Optional = requireSdkClass(sdk, 'Optional');

  return function mapParameter(parameter) {
    if (parameter === null || typeof parameter !== 'object') {
      fail('CALIBRATION_PARAMETER_VALUE_INVALID');
    }

    const { type, value } = parameter;
    if (value === null) return new Optional(null, itemTypeFor(sdk, type));

    switch (type) {
      case 'Uuid': {
        if (typeof value !== 'string') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Uuid'))(value);
      }
      case 'Utf8': {
        if (typeof value !== 'string') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Utf8'))(value);
      }
      case 'String': {
        if (typeof value !== 'string') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Bytes'))(textEncoder.encode(value));
      }
      case 'Int64': {
        if (typeof value !== 'bigint') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Int64'))(value);
      }
      case 'Uint64': {
        if (typeof value !== 'bigint') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Uint64'))(value);
      }
      case 'Uint32': {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
          fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        }
        return new (requireSdkClass(sdk, 'Uint32'))(value);
      }
      case 'Date': {
        if (typeof value !== 'string') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Date'))(toDate(value));
      }
      case 'Timestamp': {
        if (typeof value !== 'string') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'Timestamp'))(toTimestampDate(value));
      }
      case 'JsonDocument': {
        if (typeof value !== 'string') fail('CALIBRATION_PARAMETER_VALUE_INVALID');
        return new (requireSdkClass(sdk, 'JsonDocument'))(value);
      }
      default:
        fail('CALIBRATION_PARAMETER_TYPE_UNSUPPORTED');
    }
  };
}

async function executeStatement(executor, statement, mapParameter) {
  let query = executor(statement.text);
  if (query === null || typeof query !== 'object' || typeof query.parameter !== 'function') {
    fail('CALIBRATION_QUERY_CLIENT_SHAPE_INVALID');
  }

  for (const [name, parameter] of Object.entries(statement.parameters)) {
    query = query.parameter(name, mapParameter(parameter));
  }

  const resultSets = await query;
  const rows = Array.isArray(resultSets) && Array.isArray(resultSets[0]) ? resultSets[0] : [];
  return Object.freeze({ rows: Object.freeze([...rows]) });
}

export function createYdbJsTransport(sql, mapParameter) {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') {
    fail('CALIBRATION_QUERY_CLIENT_SHAPE_INVALID');
  }

  return Object.freeze({
    executeRead(statement) {
      return executeStatement(sql, statement, mapParameter);
    },
    async serializableReadWrite(work) {
      let bodyCompleted = false;
      try {
        return await sql.begin(
          { isolation: 'serializableReadWrite', idempotent: false },
          async (tx) => {
            const transportTransaction = Object.freeze({
              execute(statement) {
                return executeStatement(tx, statement, mapParameter);
              },
            });
            const result = await work(transportTransaction);
            bodyCompleted = true;
            return result;
          },
        );
      } catch (error) {
        if (bodyCompleted) throw new YdbTransportCommitOutcomeUnknownError(error);
        throw error;
      }
    },
  });
}

export async function createLiveCalibrationClient(config) {
  const [core, queryModule, primitive, optional, authYandexCloud] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/query'),
    import('@ydbjs/value/primitive'),
    import('@ydbjs/value/optional'),
    import('@ydbjs/auth-yandex-cloud'),
  ]);

  const credentialsProvider = authYandexCloud.ServiceAccountCredentialsProvider.fromFile(
    config.credentialFile,
  );
  const driver = new core.Driver(config.connectionString, { credentialsProvider });
  await driver.ready();
  const sql = queryModule.query(driver, { poolOptions: { maxSize: 4 } });
  const mapper = createSdkParameterMapper({ ...primitive, Optional: optional.Optional });

  return Object.freeze({
    transport: createYdbJsTransport(sql, mapper),
    async close() {
      await sql[Symbol.asyncDispose]();
      driver.close();
    },
  });
}
