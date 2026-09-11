import type { YdbQueryResult, YdbStatement } from './adapter.js';
import type { YdbParameter } from './parameters.js';

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;
const textEncoder = new TextEncoder();
const YANDEX_CLOUD_METADATA_AUTH = Object.freeze({
  endpoint: 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
  flavor: 'Google',
});

export type YdbJsV6SchemaBootstrapClientErrorCode =
  | 'SDK_SHAPE_INVALID'
  | 'CLIENT_CONFIG_INVALID'
  | 'PARAMETER_VALUE_INVALID'
  | 'PARAMETER_TYPE_UNSUPPORTED'
  | 'TIMESTAMP_PRECISION_UNSUPPORTED';

export class YdbJsV6SchemaBootstrapClientError extends Error {
  readonly code: YdbJsV6SchemaBootstrapClientErrorCode;

  constructor(code: YdbJsV6SchemaBootstrapClientErrorCode) {
    super(code);
    this.name = 'YdbJsV6SchemaBootstrapClientError';
    this.code = code;
  }
}

export interface YdbJsV6SchemaBootstrapClient {
  execute<Row = Readonly<Record<string, unknown>>>(
    statement: Readonly<YdbStatement>,
  ): Promise<YdbQueryResult<Row>>;
  close(): Promise<void>;
}

interface YdbJsV6SchemaBootstrapClientConfig {
  readonly connectionString: string;
  readonly poolMaxSize?: number;
}

interface YdbSqlQueryBuilder extends PromiseLike<unknown> {
  parameter(name: string, value: unknown): YdbSqlQueryBuilder;
}

interface YdbSqlExecutor {
  (text: string): YdbSqlQueryBuilder;
}

type SdkConstructor = new (...args: readonly unknown[]) => unknown;
type SdkSurface = Readonly<Record<string, unknown>>;

function fail(code: YdbJsV6SchemaBootstrapClientErrorCode): never {
  throw new YdbJsV6SchemaBootstrapClientError(code);
}

function requireConstructor(sdk: SdkSurface, name: string): SdkConstructor {
  const value = sdk[name];
  if (typeof value !== 'function') fail('SDK_SHAPE_INVALID');
  return value as SdkConstructor;
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

export function createYdbJsV6SchemaBootstrapParameterMapper(
  sdk: SdkSurface,
): (parameter: Readonly<YdbParameter>) => unknown {
  return (parameter) => {
    if (parameter.value === null) fail('PARAMETER_VALUE_INVALID');
    switch (parameter.type) {
      case 'String': {
        if (typeof parameter.value !== 'string') fail('PARAMETER_VALUE_INVALID');
        const Bytes = requireConstructor(sdk, 'Bytes');
        return new Bytes(textEncoder.encode(parameter.value));
      }
      case 'Uint64': {
        if (typeof parameter.value !== 'bigint') fail('PARAMETER_VALUE_INVALID');
        const Uint64 = requireConstructor(sdk, 'Uint64');
        return new Uint64(parameter.value);
      }
      case 'Timestamp': {
        if (typeof parameter.value !== 'string') fail('PARAMETER_VALUE_INVALID');
        const Timestamp = requireConstructor(sdk, 'Timestamp');
        return new Timestamp(toTimestampDate(parameter.value));
      }
      default:
        return fail('PARAMETER_TYPE_UNSUPPORTED');
    }
  };
}

function validateConfig(config: Readonly<YdbJsV6SchemaBootstrapClientConfig>): void {
  if (
    typeof config.connectionString !== 'string'
    || config.connectionString.length === 0
    || config.connectionString !== config.connectionString.trim()
    || (config.poolMaxSize !== undefined && (!Number.isSafeInteger(config.poolMaxSize) || config.poolMaxSize <= 0))
  ) {
    fail('CLIENT_CONFIG_INVALID');
  }
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

export function createYdbJsV6SchemaBootstrapExecutor(
  sql: YdbSqlExecutor,
  mapParameter: (parameter: Readonly<YdbParameter>) => unknown,
): Readonly<Pick<YdbJsV6SchemaBootstrapClient, 'execute'>> {
  if (typeof sql !== 'function') fail('SDK_SHAPE_INVALID');
  return Object.freeze({
    execute<Row = Readonly<Record<string, unknown>>>(statement: Readonly<YdbStatement>) {
      return executeStatement<Row>(sql, statement, mapParameter);
    },
  });
}

export async function createYdbJsV6MetadataSchemaBootstrapClient(
  config: Readonly<YdbJsV6SchemaBootstrapClientConfig>,
): Promise<Readonly<YdbJsV6SchemaBootstrapClient>> {
  validateConfig(config);
  const [core, queryModule, primitive, metadata] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/query'),
    import('@ydbjs/value/primitive'),
    import('@ydbjs/auth/metadata'),
  ]);

  const credentialsProvider = new metadata.MetadataCredentialsProvider(YANDEX_CLOUD_METADATA_AUTH);
  const driver = new core.Driver(config.connectionString, { credentialsProvider });
  await driver.ready();
  const rawSql = queryModule.query(driver, { poolOptions: { maxSize: config.poolMaxSize ?? 1 } });
  const sql = rawSql as unknown as YdbSqlExecutor;
  const sdk: SdkSurface = Object.freeze({ ...primitive });
  const direct = createYdbJsV6SchemaBootstrapExecutor(
    sql,
    createYdbJsV6SchemaBootstrapParameterMapper(sdk),
  );

  return Object.freeze({
    execute: direct.execute,
    async close() {
      const asyncDispose = (Symbol as unknown as Readonly<{ asyncDispose: symbol }>).asyncDispose;
      const dispose = Reflect.get(rawSql, asyncDispose);
      if (typeof dispose === 'function') await Reflect.apply(dispose, rawSql, []);
      driver.close();
    },
  });
}
