import type { CredentialsProvider } from '@ydbjs/auth';
import {
  YdbTransportCommitOutcomeUnknownError,
  type YdbQueryResult,
  type YdbStatement,
  type YdbTransport,
} from './adapter.js';
import type { YdbParameter } from './parameters.js';

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;
const textEncoder = new TextEncoder();

export const YANDEX_CLOUD_METADATA_AUTH = Object.freeze({
  endpoint: 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
  flavor: 'Google',
});

export const YDB_JS_DATA_SDK_VERSIONS = Object.freeze({
  '@ydbjs/auth': '6.3.1',
  '@ydbjs/auth-yandex-cloud': '0.2.0',
  '@ydbjs/core': '6.3.1',
  '@ydbjs/query': '6.3.0',
  '@ydbjs/value': '6.0.8',
});

export type YdbJsV6DataTransportErrorCode =
  | 'SDK_SHAPE_INVALID'
  | 'PARAMETER_VALUE_INVALID'
  | 'PARAMETER_TYPE_UNSUPPORTED'
  | 'TIMESTAMP_PRECISION_UNSUPPORTED'
  | 'CLIENT_CONFIG_INVALID';

export class YdbJsV6DataTransportError extends Error {
  readonly code: YdbJsV6DataTransportErrorCode;

  constructor(code: YdbJsV6DataTransportErrorCode) {
    super(code);
    this.name = 'YdbJsV6DataTransportError';
    this.code = code;
  }
}

type SdkConstructor = new (...args: readonly unknown[]) => unknown;
type SdkSurface = Readonly<Record<string, unknown>>;

interface YdbSqlQueryBuilder extends PromiseLike<unknown> {
  parameter(name: string, value: unknown): YdbSqlQueryBuilder;
}

export interface YdbSqlExecutor {
  (text: string): YdbSqlQueryBuilder;
}

export interface YdbSqlClient extends YdbSqlExecutor {
  begin<T>(
    options: Readonly<{ isolation: 'serializableReadWrite'; idempotent: false }>,
    work: (transaction: YdbSqlExecutor) => Promise<T>,
  ): Promise<T>;
}

interface YdbJsCommonDataClientConfig {
  readonly connectionString: string;
  readonly poolMaxSize?: number;
}

export interface YdbJsDataClientConfig extends YdbJsCommonDataClientConfig {
  readonly credentialFile: string;
}

export interface YdbJsMetadataDataClientConfig extends YdbJsCommonDataClientConfig {}

export interface YdbJsDataClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

function fail(code: YdbJsV6DataTransportErrorCode): never {
  throw new YdbJsV6DataTransportError(code);
}

function requireConstructor(sdk: SdkSurface, name: string): SdkConstructor {
  const value = sdk[name];
  if (typeof value !== 'function') fail('SDK_SHAPE_INVALID');
  return value as SdkConstructor;
}

function itemTypeFor(sdk: SdkSurface, type: YdbParameter['type']): unknown {
  const className = type === 'String' ? 'BytesType' : `${type}Type`;
  const TypeClass = requireConstructor(sdk, className);
  return new TypeClass();
}

function toTimestampDate(value: string): Date {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (match === null || match[1] === undefined) fail('PARAMETER_VALUE_INVALID');
  const fraction = (match[2] ?? '').padEnd(6, '0');
  const microseconds = Number(fraction || '0');
  if (microseconds % 1000 !== 0) fail('TIMESTAMP_PRECISION_UNSUPPORTED');
  const milliseconds = String(microseconds / 1000).padStart(3, '0');
  const date = new Date(`${match[1]}.${milliseconds}Z`);
  if (!Number.isFinite(date.getTime())) fail('PARAMETER_VALUE_INVALID');
  return date;
}

function toDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) fail('PARAMETER_VALUE_INVALID');
  return date;
}

export function createYdbJsV6ParameterMapper(
  sdk: SdkSurface,
): (parameter: Readonly<YdbParameter>) => unknown {
  const Optional = requireConstructor(sdk, 'Optional');

  return (parameter) => {
    const { type, value } = parameter;
    if (value === null) return new Optional(null, itemTypeFor(sdk, type));

    switch (type) {
      case 'Uuid':
      case 'Utf8':
      case 'JsonDocument': {
        if (typeof value !== 'string') fail('PARAMETER_VALUE_INVALID');
        const ValueClass = requireConstructor(sdk, type);
        return new ValueClass(value);
      }
      case 'String': {
        if (typeof value !== 'string') fail('PARAMETER_VALUE_INVALID');
        const Bytes = requireConstructor(sdk, 'Bytes');
        return new Bytes(textEncoder.encode(value));
      }
      case 'Int64':
      case 'Uint64': {
        if (typeof value !== 'bigint') fail('PARAMETER_VALUE_INVALID');
        const ValueClass = requireConstructor(sdk, type);
        return new ValueClass(value);
      }
      case 'Uint32': {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('PARAMETER_VALUE_INVALID');
        const Uint32 = requireConstructor(sdk, 'Uint32');
        return new Uint32(value);
      }
      case 'Date': {
        if (typeof value !== 'string') fail('PARAMETER_VALUE_INVALID');
        const DateValue = requireConstructor(sdk, 'Date');
        return new DateValue(toDate(value));
      }
      case 'Timestamp': {
        if (typeof value !== 'string') fail('PARAMETER_VALUE_INVALID');
        const Timestamp = requireConstructor(sdk, 'Timestamp');
        return new Timestamp(toTimestampDate(value));
      }
      default:
        return fail('PARAMETER_TYPE_UNSUPPORTED');
    }
  };
}

async function executeStatement<Row>(
  executor: YdbSqlExecutor,
  statement: Readonly<YdbStatement>,
  mapParameter: (parameter: Readonly<YdbParameter>) => unknown,
): Promise<YdbQueryResult<Row>> {
  let query = executor(statement.text);
  if (query === null || typeof query !== 'object' || typeof query.parameter !== 'function') {
    fail('SDK_SHAPE_INVALID');
  }
  for (const [name, parameter] of Object.entries(statement.parameters)) {
    query = query.parameter(name, mapParameter(parameter));
  }
  const resultSets = await query;
  const rows = Array.isArray(resultSets) && Array.isArray(resultSets[0])
    ? resultSets[0] as readonly Row[]
    : [];
  return Object.freeze({ rows: Object.freeze([...rows]) });
}

export function createYdbJsV6DataTransport(
  sql: YdbSqlClient,
  mapParameter: (parameter: Readonly<YdbParameter>) => unknown,
): YdbTransport {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') fail('SDK_SHAPE_INVALID');

  return Object.freeze({
    executeRead<Row>(statement: Readonly<YdbStatement>) {
      return executeStatement<Row>(sql, statement, mapParameter);
    },
    async serializableReadWrite<T>(work: (transaction: { execute<Row>(statement: YdbStatement): Promise<YdbQueryResult<Row>> }) => Promise<T>) {
      let bodyCompleted = false;
      try {
        return await sql.begin(
          { isolation: 'serializableReadWrite', idempotent: false },
          async (transaction) => {
            const transportTransaction = Object.freeze({
              execute<Row>(statement: Readonly<YdbStatement>) {
                return executeStatement<Row>(transaction, statement, mapParameter);
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

function validateCommonClientConfig(config: Readonly<YdbJsCommonDataClientConfig>): void {
  if (
    typeof config.connectionString !== 'string'
    || config.connectionString.length === 0
    || config.connectionString !== config.connectionString.trim()
    || (config.poolMaxSize !== undefined && (!Number.isSafeInteger(config.poolMaxSize) || config.poolMaxSize <= 0))
  ) {
    fail('CLIENT_CONFIG_INVALID');
  }
}

function validateClientConfig(config: Readonly<YdbJsDataClientConfig>): void {
  validateCommonClientConfig(config);
  if (
    typeof config.credentialFile !== 'string'
    || config.credentialFile.length === 0
    || config.credentialFile !== config.credentialFile.trim()
  ) {
    fail('CLIENT_CONFIG_INVALID');
  }
}

async function createDataClientWithCredentials(
  config: Readonly<YdbJsCommonDataClientConfig>,
  credentialsProvider: CredentialsProvider,
): Promise<Readonly<YdbJsDataClient>> {
  const [core, queryModule, primitive, optional] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/query'),
    import('@ydbjs/value/primitive'),
    import('@ydbjs/value/optional'),
  ]);

  const driver = new core.Driver(config.connectionString, { credentialsProvider });
  await driver.ready();
  const rawSql = queryModule.query(driver, { poolOptions: { maxSize: config.poolMaxSize ?? 4 } });
  const sql = rawSql as unknown as YdbSqlClient;
  const sdk: SdkSurface = Object.freeze({ ...primitive, Optional: optional.Optional });
  const transport = createYdbJsV6DataTransport(sql, createYdbJsV6ParameterMapper(sdk));

  return Object.freeze({
    transport,
    async close() {
      const asyncDispose = (Symbol as unknown as Readonly<{ asyncDispose: symbol }>).asyncDispose;
      const dispose = Reflect.get(rawSql, asyncDispose);
      if (typeof dispose === 'function') await Reflect.apply(dispose, rawSql, []);
      driver.close();
    },
  });
}

export async function createYdbJsV6DataClient(
  config: Readonly<YdbJsDataClientConfig>,
): Promise<Readonly<YdbJsDataClient>> {
  validateClientConfig(config);
  const authYandexCloud = await import('@ydbjs/auth-yandex-cloud');
  const credentialsProvider = authYandexCloud.ServiceAccountCredentialsProvider.fromFile(
    config.credentialFile,
  );
  return createDataClientWithCredentials(config, credentialsProvider);
}

export async function createYdbJsV6MetadataDataClient(
  config: Readonly<YdbJsMetadataDataClientConfig>,
): Promise<Readonly<YdbJsDataClient>> {
  validateCommonClientConfig(config);
  const { MetadataCredentialsProvider } = await import('@ydbjs/auth/metadata');
  const credentialsProvider = new MetadataCredentialsProvider(YANDEX_CLOUD_METADATA_AUTH);
  return createDataClientWithCredentials(config, credentialsProvider);
}
