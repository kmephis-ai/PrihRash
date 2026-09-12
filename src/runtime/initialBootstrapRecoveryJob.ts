import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  probeInitialBootstrapRecovery,
  type InitialBootstrapRecoveryVerdict,
} from '../migration/initialBootstrapRecoveryProbe.js';

export const INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV = Object.freeze({
  ydbConnectionString: 'PRIHRASH_YDB_CONNECTION_STRING',
});

export type InitialBootstrapRecoveryJobEnvironment = Readonly<Record<string, string | undefined>>;

export interface InitialBootstrapRecoveryJobConfig {
  readonly ydbConnectionString: string;
}

export type InitialBootstrapRecoveryJobErrorCode =
  | 'INVALID_YDB_CONNECTION_STRING'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class InitialBootstrapRecoveryJobError extends Error {
  readonly code: InitialBootstrapRecoveryJobErrorCode;

  constructor(code: InitialBootstrapRecoveryJobErrorCode) {
    super(code);
    this.name = 'InitialBootstrapRecoveryJobError';
    this.code = code;
  }
}

export interface InitialBootstrapRecoveryJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapRecoveryJobRuntime {
  createYdbClient(config: Readonly<InitialBootstrapRecoveryJobConfig>): Promise<Readonly<InitialBootstrapRecoveryJobYdbClient>>;
}

function requiredConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new InitialBootstrapRecoveryJobError('INVALID_YDB_CONNECTION_STRING');
  }
  return value;
}

export function readInitialBootstrapRecoveryJobConfig(
  environment: InitialBootstrapRecoveryJobEnvironment,
): Readonly<InitialBootstrapRecoveryJobConfig> {
  return Object.freeze({
    ydbConnectionString: requiredConnectionString(
      environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.ydbConnectionString],
    ),
  });
}

const productionRuntime: Readonly<InitialBootstrapRecoveryJobRuntime> = Object.freeze({
  createYdbClient(config: Readonly<InitialBootstrapRecoveryJobConfig>): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
});

export async function executeInitialBootstrapRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  runtime: Readonly<InitialBootstrapRecoveryJobRuntime>,
): Promise<InitialBootstrapRecoveryVerdict> {
  const validated = Object.freeze({
    ydbConnectionString: requiredConnectionString(config.ydbConnectionString),
  });
  const ydbClient = await runtime.createYdbClient(validated);
  const adapter = new YdbAdapter(ydbClient.transport);
  let primaryError: unknown = null;

  try {
    return await probeInitialBootstrapRecovery(adapter);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch {
      if (primaryError === null) throw new InitialBootstrapRecoveryJobError('YDB_CLIENT_CLOSE_FAILED');
    }
  }
}

export function runInitialBootstrapRecoveryJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
): Promise<InitialBootstrapRecoveryVerdict> {
  return executeInitialBootstrapRecoveryJob(config, productionRuntime);
}

export function runInitialBootstrapRecoveryJobFromEnvironment(
  environment: InitialBootstrapRecoveryJobEnvironment = process.env,
): Promise<InitialBootstrapRecoveryVerdict> {
  return runInitialBootstrapRecoveryJob(readInitialBootstrapRecoveryJobConfig(environment));
}
