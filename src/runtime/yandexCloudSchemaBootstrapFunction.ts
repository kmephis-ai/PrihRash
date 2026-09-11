import { readFile } from 'node:fs/promises';

import { createYdbJsV6MetadataSchemaBootstrapClient } from '../integration/ydb/ydbJsV6SchemaBootstrapClient.js';
import {
  createYdbSchemaBootstrapMigrations,
  runYdbSchemaBootstrap,
  YdbSchemaBootstrapError,
  type YdbSchemaBootstrapClient,
  type YdbSchemaBootstrapClock,
  type YdbSchemaBootstrapResult,
} from './ydbSchemaBootstrap.js';

export interface YandexSchemaBootstrapEnvironment {
  readonly PRIHRASH_YDB_CONNECTION_STRING?: string;
}

export interface YandexSchemaBootstrapRuntime {
  loadMigration001(): Promise<string>;
  loadMigration002(): Promise<string>;
  createClient(connectionString: string): Promise<Readonly<YdbSchemaBootstrapClient>>;
  readonly clock: YdbSchemaBootstrapClock;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function connectionString(environment: Readonly<YandexSchemaBootstrapEnvironment>): string {
  const value = environment.PRIHRASH_YDB_CONNECTION_STRING;
  if (!nonBlank(value)) throw new YdbSchemaBootstrapError('CONFIG_INVALID');
  return value;
}

const productionRuntime: Readonly<YandexSchemaBootstrapRuntime> = Object.freeze({
  loadMigration001() {
    return readFile(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8');
  },
  loadMigration002() {
    return readFile(new URL('../../migrations/002_reference_source_labels.sql', import.meta.url), 'utf8');
  },
  async createClient(value: string) {
    try {
      return await createYdbJsV6MetadataSchemaBootstrapClient({
        connectionString: value,
        poolMaxSize: 1,
      });
    } catch {
      throw new YdbSchemaBootstrapError('YDB_CLIENT_CREATE_FAILED');
    }
  },
  clock: Object.freeze({
    now() {
      return new Date();
    },
  }),
});

export async function executeYandexSchemaBootstrapFunction(
  environment: Readonly<YandexSchemaBootstrapEnvironment>,
  runtime: Readonly<YandexSchemaBootstrapRuntime>,
): Promise<Readonly<YdbSchemaBootstrapResult>> {
  const value = connectionString(environment);

  let migrations;
  try {
    migrations = createYdbSchemaBootstrapMigrations({
      migration001Sql: await runtime.loadMigration001(),
      migration002Sql: await runtime.loadMigration002(),
    });
  } catch (error) {
    if (error instanceof YdbSchemaBootstrapError) throw error;
    throw new YdbSchemaBootstrapError('MIGRATION_BUNDLE_INVALID');
  }

  let client: Readonly<YdbSchemaBootstrapClient>;
  try {
    client = await runtime.createClient(value);
  } catch (error) {
    if (error instanceof YdbSchemaBootstrapError && error.code === 'YDB_CLIENT_CREATE_FAILED') throw error;
    throw new YdbSchemaBootstrapError('YDB_CLIENT_CREATE_FAILED');
  }
  let primaryError: unknown = null;
  try {
    return await runYdbSchemaBootstrap(client, migrations, runtime.clock);
  } catch (error) {
    primaryError = error;
    if (error instanceof YdbSchemaBootstrapError) throw error;
    throw new YdbSchemaBootstrapError('YDB_PREFLIGHT_READ_FAILED');
  } finally {
    try {
      await client.close();
    } catch {
      if (primaryError === null) throw new YdbSchemaBootstrapError('YDB_CLIENT_CLOSE_FAILED');
    }
  }
}

export async function schemaBootstrapHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YdbSchemaBootstrapResult>> {
  return executeYandexSchemaBootstrapFunction(process.env, productionRuntime);
}
