import { readFile } from 'node:fs/promises';

import { createYdbJsV6MetadataSchemaBootstrapClient } from '../integration/ydb/ydbJsV6SchemaBootstrapClient.js';
import {
  createYdbSchemaUpgrade003Migration,
  runYdbSchemaUpgrade003,
  YdbSchemaUpgrade003Error,
  type YdbSchemaUpgrade003Client,
  type YdbSchemaUpgrade003Clock,
  type YdbSchemaUpgrade003Result,
} from './ydbSchemaUpgrade003.js';

export interface YandexSchemaUpgrade003Environment {
  readonly PRIHRASH_YDB_CONNECTION_STRING?: string;
}

export interface YandexSchemaUpgrade003Runtime {
  loadMigration003(): Promise<string>;
  createClient(connectionString: string): Promise<Readonly<YdbSchemaUpgrade003Client>>;
  readonly clock: YdbSchemaUpgrade003Clock;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function connectionString(environment: Readonly<YandexSchemaUpgrade003Environment>): string {
  const value = environment.PRIHRASH_YDB_CONNECTION_STRING;
  if (!nonBlank(value)) throw new YdbSchemaUpgrade003Error('CONFIG_INVALID');
  return value;
}

const productionRuntime: Readonly<YandexSchemaUpgrade003Runtime> = Object.freeze({
  loadMigration003() {
    return readFile(new URL('../../migrations/003_initial_bootstrap_identity_manifest.sql', import.meta.url), 'utf8');
  },
  async createClient(value: string) {
    try {
      return await createYdbJsV6MetadataSchemaBootstrapClient({
        connectionString: value,
        poolMaxSize: 1,
      });
    } catch {
      throw new YdbSchemaUpgrade003Error('YDB_CLIENT_CREATE_FAILED');
    }
  },
  clock: Object.freeze({
    now() {
      return new Date();
    },
  }),
});

export async function executeYandexSchemaUpgrade003Function(
  environment: Readonly<YandexSchemaUpgrade003Environment>,
  runtime: Readonly<YandexSchemaUpgrade003Runtime>,
): Promise<Readonly<YdbSchemaUpgrade003Result>> {
  const value = connectionString(environment);

  let migration;
  try {
    migration = createYdbSchemaUpgrade003Migration(await runtime.loadMigration003());
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade003Error) throw error;
    throw new YdbSchemaUpgrade003Error('MIGRATION_BUNDLE_INVALID');
  }

  let client: Readonly<YdbSchemaUpgrade003Client>;
  try {
    client = await runtime.createClient(value);
  } catch (error) {
    if (error instanceof YdbSchemaUpgrade003Error && error.code === 'YDB_CLIENT_CREATE_FAILED') throw error;
    throw new YdbSchemaUpgrade003Error('YDB_CLIENT_CREATE_FAILED');
  }

  let primaryError: unknown = null;
  try {
    return await runYdbSchemaUpgrade003(client, migration, runtime.clock);
  } catch (error) {
    primaryError = error;
    if (error instanceof YdbSchemaUpgrade003Error) throw error;
    throw new YdbSchemaUpgrade003Error('YDB_PREFLIGHT_READ_FAILED');
  } finally {
    try {
      await client.close();
    } catch {
      if (primaryError === null) throw new YdbSchemaUpgrade003Error('YDB_CLIENT_CLOSE_FAILED');
    }
  }
}

export async function schemaUpgrade003Handler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YdbSchemaUpgrade003Result>> {
  return executeYandexSchemaUpgrade003Function(process.env, productionRuntime);
}
