import { readFile } from 'node:fs/promises';

import { createYdbJsV6MetadataSchemaBootstrapClient } from '../integration/ydb/ydbJsV6SchemaBootstrapClient.js';
import {
  createYdbSchemaUpgrade004Migration,
  runYdbSchemaUpgrade004,
  YdbSchemaUpgrade004Error,
  type YdbSchemaUpgrade004Client,
  type YdbSchemaUpgrade004Clock,
  type YdbSchemaUpgrade004Result,
} from './ydbSchemaUpgrade004.js';

export interface YandexSchemaUpgrade004Environment {
  readonly PRIHRASH_YDB_CONNECTION_STRING?: string;
}

export interface YandexSchemaUpgrade004Runtime {
  loadMigration004(): Promise<string>;
  createClient(connectionString: string): Promise<Readonly<YdbSchemaUpgrade004Client>>;
  readonly clock: YdbSchemaUpgrade004Clock;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function connectionString(environment: Readonly<YandexSchemaUpgrade004Environment>): string {
  const value = environment.PRIHRASH_YDB_CONNECTION_STRING;
  if (!nonBlank(value)) throw new YdbSchemaUpgrade004Error('CONFIG_INVALID');
  return value;
}

const productionRuntime: Readonly<YandexSchemaUpgrade004Runtime> = Object.freeze({
  loadMigration004() {
    return readFile(new URL('../../migrations/004_source_record_revision_run_index.sql', import.meta.url), 'utf8')
      .then((sql) => sql.replace(/\r\n/g, '\n'));
  },
  async createClient(value: string) {
    try {
      return await createYdbJsV6MetadataSchemaBootstrapClient({
        connectionString: value,
        poolMaxSize: 1,
      });
    } catch {
      throw new YdbSchemaUpgrade004Error('YDB_CLIENT_CREATE_FAILED');
    }
  },
  clock: Object.freeze({
    now() {
      return new Date();
    },
  }),
});

export async function executeYandexSchemaUpgrade004Function(
  environment: Readonly<YandexSchemaUpgrade004Environment>,
  runtime: Readonly<YandexSchemaUpgrade004Runtime>,
): Promise<Readonly<YdbSchemaUpgrade004Result>> {
  const value = connectionString(environment);

  let migration;
  try {
    migration = createYdbSchemaUpgrade004Migration(await runtime.loadMigration004());
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade004Error) throw error;
    throw new YdbSchemaUpgrade004Error('MIGRATION_BUNDLE_INVALID');
  }

  let client: Readonly<YdbSchemaUpgrade004Client>;
  try {
    client = await runtime.createClient(value);
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade004Error && error.code === 'YDB_CLIENT_CREATE_FAILED') throw error;
    throw new YdbSchemaUpgrade004Error('YDB_CLIENT_CREATE_FAILED');
  }

  let primaryError: unknown = null;
  try {
    return await runYdbSchemaUpgrade004(client, migration, runtime.clock);
  } catch (error) {
    primaryError = error;
    if (error instanceof YdbSchemaUpgrade004Error) throw error;
    throw new YdbSchemaUpgrade004Error('YDB_PREFLIGHT_READ_FAILED');
  } finally {
    try {
      await client.close();
    } catch {
      if (primaryError === null) throw new YdbSchemaUpgrade004Error('YDB_CLIENT_CLOSE_FAILED');
    }
  }
}

export async function schemaUpgrade004Handler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YdbSchemaUpgrade004Result>> {
  return executeYandexSchemaUpgrade004Function(process.env, productionRuntime);
}
