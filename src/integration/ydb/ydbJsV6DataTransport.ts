import type { CredentialsProvider } from '@ydbjs/auth';
import { StatusIds_StatusCode } from '@ydbjs/api/operation';
import {
  YdbTransportCommitOutcomeUnknownError,
  type YdbQueryResult,
  type YdbStatement,
  type YdbTransport,
} from './adapter.js';
import type { YdbSchemeTransport } from './scheme.js';
import type {
  YdbListStructParameter,
  YdbParameter,
  YdbScalarParameter,
} from './parameters.js';

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;
const textEncoder = new TextEncoder();
const NO_TRANSACTION_BODY_FAILURE = Symbol('NO_TRANSACTION_BODY_FAILURE');

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

export type YdbJsV6QueryExecutionStatusCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'ABORTED'
  | 'UNAVAILABLE'
  | 'OVERLOADED'
  | 'SCHEME_ERROR'
  | 'GENERIC_ERROR'
  | 'TIMEOUT'
  | 'BAD_SESSION'
  | 'PRECONDITION_FAILED'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'CANCELLED'
  | 'UNDETERMINED'
  | 'UNSUPPORTED'
  | 'SESSION_BUSY'
  | 'EXTERNAL_ERROR';

export type YdbJsV6DataTransportErrorCode =
  | 'SDK_SHAPE_INVALID'
  | 'PARAMETER_VALUE_INVALID'
  | 'PARAMETER_TYPE_UNSUPPORTED'
  | 'TIMESTAMP_PRECISION_UNSUPPORTED'
  | 'QUERY_EXECUTION_FAILED'
  | `QUERY_EXECUTION_YDB_${YdbJsV6QueryExecutionStatusCode}`
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
  timeout(timeoutMs: number): YdbSqlQueryBuilder;
}

export interface YdbSqlExecutor {
  (text: string): YdbSqlQueryBuilder;
}

interface YdbSqlTransactionOptions {
  readonly isolation: 'serializableReadWrite';
  readonly idempotent: false;
  readonly signal?: AbortSignal;
}

export interface YdbSqlClient extends YdbSqlExecutor {
  begin<T>(
    options: Readonly<YdbSqlTransactionOptions>,
    work: (transaction: YdbSqlExecutor) => Promise<T>,
  ): Promise<T>;
}

interface YdbJsCommonDataClientConfig {
  readonly connectionString: string;
  readonly poolMaxSize?: number;
  readonly readyTimeoutMs?: number;
  readonly readTimeoutMs?: number;
  readonly transactionTimeoutMs?: number;
}

export interface YdbJsDataClientConfig extends YdbJsCommonDataClientConfig {
  readonly credentialFile: string;
}

export interface YdbJsMetadataDataClientConfig extends YdbJsCommonDataClientConfig {}

export interface YdbJsDataClient {
  readonly transport: YdbTransport;
  createSchemeTransport(): Promise<YdbSchemeTransport>;
  close(): Promise<void>;
}

export interface YdbJsDriverReadyLifecycle {
  ready(signal?: AbortSignal): Promise<void>;
  close(): void;
}

export async function waitForYdbJsDriverReady(
  driver: YdbJsDriverReadyLifecycle,
  readyTimeoutMs?: number,
): Promise<void> {
  try {
    await driver.ready(
      readyTimeoutMs === undefined ? undefined : AbortSignal.timeout(readyTimeoutMs),
    );
  } catch (error) {
    try {
      driver.close();
    } catch {
      // Preserve the primary readiness failure; cleanup is best-effort on this failed creation path.
    }
    throw error;
  }
}

function fail(code: YdbJsV6DataTransportErrorCode): never {
  throw new YdbJsV6DataTransportError(code);
}

const YDB_QUERY_EXECUTION_STATUS_BY_CODE = new Map<number, YdbJsV6QueryExecutionStatusCode>([
  [StatusIds_StatusCode.BAD_REQUEST, 'BAD_REQUEST'],
  [StatusIds_StatusCode.UNAUTHORIZED, 'UNAUTHORIZED'],
  [StatusIds_StatusCode.INTERNAL_ERROR, 'INTERNAL_ERROR'],
  [StatusIds_StatusCode.ABORTED, 'ABORTED'],
  [StatusIds_StatusCode.UNAVAILABLE, 'UNAVAILABLE'],
  [StatusIds_StatusCode.OVERLOADED, 'OVERLOADED'],
  [StatusIds_StatusCode.SCHEME_ERROR, 'SCHEME_ERROR'],
  [StatusIds_StatusCode.GENERIC_ERROR, 'GENERIC_ERROR'],
  [StatusIds_StatusCode.TIMEOUT, 'TIMEOUT'],
  [StatusIds_StatusCode.BAD_SESSION, 'BAD_SESSION'],
  [StatusIds_StatusCode.PRECONDITION_FAILED, 'PRECONDITION_FAILED'],
  [StatusIds_StatusCode.ALREADY_EXISTS, 'ALREADY_EXISTS'],
  [StatusIds_StatusCode.NOT_FOUND, 'NOT_FOUND'],
  [StatusIds_StatusCode.SESSION_EXPIRED, 'SESSION_EXPIRED'],
  [StatusIds_StatusCode.CANCELLED, 'CANCELLED'],
  [StatusIds_StatusCode.UNDETERMINED, 'UNDETERMINED'],
  [StatusIds_StatusCode.UNSUPPORTED, 'UNSUPPORTED'],
  [StatusIds_StatusCode.SESSION_BUSY, 'SESSION_BUSY'],
  [StatusIds_StatusCode.EXTERNAL_ERROR, 'EXTERNAL_ERROR'],
]);

function classifyQueryExecutionFailure(error: unknown): YdbJsV6DataTransportErrorCode {
  if (error === null || typeof error !== 'object') return 'QUERY_EXECUTION_FAILED';
  const constructor = Reflect.get(error, 'constructor');
  const code = Reflect.get(error, 'code');
  if (
    typeof constructor !== 'function'
    || constructor.name !== 'YDBError'
    || typeof code !== 'number'
  ) {
    return 'QUERY_EXECUTION_FAILED';
  }
  const status = YDB_QUERY_EXECUTION_STATUS_BY_CODE.get(code);
  return status === undefined
    ? 'QUERY_EXECUTION_FAILED'
    : `QUERY_EXECUTION_YDB_${status}`;
}

function requireConstructor(sdk: SdkSurface, name: string): SdkConstructor {
  const value = sdk[name];
  if (typeof value !== 'function') fail('SDK_SHAPE_INVALID');
  return value as SdkConstructor;
}

function itemTypeFor(sdk: SdkSurface, type: YdbScalarParameter['type']): unknown {
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

  const mapScalar = (parameter: Readonly<YdbScalarParameter>): unknown => {
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

  const mapListStruct = (parameter: Readonly<YdbListStructParameter>): unknown => {
    const OptionalType = requireConstructor(sdk, 'OptionalType');
    const List = requireConstructor(sdk, 'List');
    const Struct = requireConstructor(sdk, 'Struct');
    const StructType = requireConstructor(sdk, 'StructType');
    const { columns, rows } = parameter.value;
    if (columns.length === 0 || rows.length === 0) fail('PARAMETER_VALUE_INVALID');

    const names = columns.map((column) => column.name);
    const itemTypes = columns.map((column) => itemTypeFor(sdk, column.type));
    const structTypes = columns.map((column, index) => (
      column.nullable ? new OptionalType(itemTypes[index]) : itemTypes[index]
    ));
    const structType = new StructType(names, structTypes);

    const values = rows.map((row) => {
      const fields: Record<string, unknown> = {};
      for (const column of columns) {
        const cell = row[column.name];
        if (
          cell === undefined
          || cell.type !== column.type
          || (cell.value === null && !column.nullable)
        ) {
          fail('PARAMETER_VALUE_INVALID');
        }
        const mapped = mapScalar(cell);
        fields[column.name] = column.nullable && cell.value !== null
          ? new Optional(mapped)
          : mapped;
      }
      return new Struct(fields, structType);
    });

    return new List(...values);
  };

  return (parameter) => (
    parameter.type === 'ListStruct'
      ? mapListStruct(parameter)
      : mapScalar(parameter)
  );
}

async function executeStatement<Row>(
  executor: YdbSqlExecutor,
  statement: Readonly<YdbStatement>,
  mapParameter: (parameter: Readonly<YdbParameter>) => unknown,
  timeoutMs?: number,
  deferQueryExecutionFailure?: (error: unknown) => never,
): Promise<YdbQueryResult<Row>> {
  let query: YdbSqlQueryBuilder;
  try {
    query = executor(statement.text);
    if (query === null || typeof query !== 'object' || typeof query.parameter !== 'function') {
      fail('SDK_SHAPE_INVALID');
    }
    for (const [name, parameter] of Object.entries(statement.parameters)) {
      query = query.parameter(name, mapParameter(parameter));
    }
    if (timeoutMs !== undefined) {
      if (typeof query.timeout !== 'function') fail('SDK_SHAPE_INVALID');
      query = query.timeout(timeoutMs);
    }
  } catch (error) {
    if (error instanceof YdbJsV6DataTransportError) throw error;
    throw new YdbJsV6DataTransportError(classifyQueryExecutionFailure(error));
  }

  let resultSets: unknown;
  try {
    resultSets = await query;
  } catch (error) {
    if (error instanceof YdbJsV6DataTransportError) throw error;
    if (deferQueryExecutionFailure !== undefined) deferQueryExecutionFailure(error);
    throw new YdbJsV6DataTransportError(classifyQueryExecutionFailure(error));
  }

  const rows = Array.isArray(resultSets) && Array.isArray(resultSets[0])
    ? resultSets[0] as readonly Row[]
    : [];
  return Object.freeze({ rows: Object.freeze([...rows]) });
}

function transactionFailureOriginatesFromBody(
  transactionFailure: unknown,
  bodyFailure: unknown,
): boolean {
  if (transactionFailure === bodyFailure) return true;
  if (transactionFailure === null || typeof transactionFailure !== 'object') return false;
  try {
    return Reflect.get(transactionFailure, 'cause') === bodyFailure;
  } catch {
    return false;
  }
}

function positiveTimeout(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

export function createYdbJsV6DataTransport(
  sql: YdbSqlClient,
  mapParameter: (parameter: Readonly<YdbParameter>) => unknown,
  options: Readonly<{ readTimeoutMs?: number; transactionTimeoutMs?: number }> = {},
): YdbTransport {
  if (typeof sql !== 'function' || typeof sql.begin !== 'function') fail('SDK_SHAPE_INVALID');
  if (!positiveTimeout(options.readTimeoutMs) || !positiveTimeout(options.transactionTimeoutMs)) {
    fail('CLIENT_CONFIG_INVALID');
  }

  return Object.freeze({
    executeRead<Row>(statement: Readonly<YdbStatement>) {
      return executeStatement<Row>(sql, statement, mapParameter, options.readTimeoutMs);
    },
    async serializableReadWrite<T>(work: (transaction: { execute<Row>(statement: YdbStatement): Promise<YdbQueryResult<Row>> }) => Promise<T>) {
      let bodyCompleted = false;
      let bodyFailure: unknown | typeof NO_TRANSACTION_BODY_FAILURE = NO_TRANSACTION_BODY_FAILURE;
      const deferredProviderFailures = new Set<unknown>();
      const beginOptions: Readonly<YdbSqlTransactionOptions> = options.transactionTimeoutMs === undefined
        ? Object.freeze({ isolation: 'serializableReadWrite', idempotent: false })
        : Object.freeze({
            isolation: 'serializableReadWrite',
            idempotent: false,
            signal: AbortSignal.timeout(options.transactionTimeoutMs),
          });
      try {
        return await sql.begin(
          beginOptions,
          async (transaction) => {
            bodyCompleted = false;
            bodyFailure = NO_TRANSACTION_BODY_FAILURE;
            const transportTransaction = Object.freeze({
              execute<Row>(statement: Readonly<YdbStatement>) {
                return executeStatement<Row>(
                  transaction,
                  statement,
                  mapParameter,
                  undefined,
                  (error) => {
                    deferredProviderFailures.add(error);
                    throw error;
                  },
                );
              },
            });
            try {
              const result = await work(transportTransaction);
              bodyCompleted = true;
              return result;
            } catch (error) {
              bodyFailure = error;
              throw error;
            }
          },
        );
      } catch (error) {
        if (bodyCompleted) throw new YdbTransportCommitOutcomeUnknownError(error);
        if (
          bodyFailure !== NO_TRANSACTION_BODY_FAILURE
          && transactionFailureOriginatesFromBody(error, bodyFailure)
        ) {
          if (deferredProviderFailures.has(bodyFailure)) {
            throw new YdbJsV6DataTransportError(classifyQueryExecutionFailure(bodyFailure));
          }
          throw bodyFailure;
        }
        if (error instanceof YdbJsV6DataTransportError) throw error;
        throw new YdbJsV6DataTransportError(classifyQueryExecutionFailure(error));
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
    || !positiveTimeout(config.readyTimeoutMs)
    || !positiveTimeout(config.readTimeoutMs)
    || !positiveTimeout(config.transactionTimeoutMs)
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
  const [core, queryModule, primitive, optional, list, struct] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/query'),
    import('@ydbjs/value/primitive'),
    import('@ydbjs/value/optional'),
    import('@ydbjs/value/list'),
    import('@ydbjs/value/struct'),
  ]);

  const driver = new core.Driver(config.connectionString, { credentialsProvider });
  await waitForYdbJsDriverReady(driver, config.readyTimeoutMs);
  const rawSql = queryModule.query(driver, { poolOptions: { maxSize: config.poolMaxSize ?? 4 } });
  const sql = rawSql as unknown as YdbSqlClient;
  const sdk: SdkSurface = Object.freeze({
    ...primitive,
    Optional: optional.Optional,
    OptionalType: optional.OptionalType,
    List: list.List,
    Struct: struct.Struct,
    StructType: struct.StructType,
  });
  const transport = createYdbJsV6DataTransport(
    sql,
    createYdbJsV6ParameterMapper(sdk),
    Object.freeze({
      ...(config.readTimeoutMs === undefined ? {} : { readTimeoutMs: config.readTimeoutMs }),
      ...(config.transactionTimeoutMs === undefined ? {} : { transactionTimeoutMs: config.transactionTimeoutMs }),
    }),
  );

  return Object.freeze({
    transport,
    async createSchemeTransport(): Promise<YdbSchemeTransport> {
      const { YdbJsV6SchemeTransport } = await import('./ydbJsV6SchemeTransport.js');
      return new YdbJsV6SchemeTransport(driver);
    },
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
