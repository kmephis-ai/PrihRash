import {
  createCanonicalSourceDigest,
  type CanonicalSourceDigest,
} from '../integration/google/canonicalSourceDigest.js';
import {
  GoogleSheetsFullSnapshotReader,
  type GoogleSheetsFullSnapshotLease,
} from '../integration/google/googleSheetsFullSnapshotReader.js';
import { createGoogleServiceAccountSheetsAccessTokenProvider } from '../integration/google/googleServiceAccountTokenProvider.js';
import { YdbAdapter, type YdbTransport } from '../integration/ydb/adapter.js';
import {
  createYdbJsV6MetadataDataClient,
  type YdbJsDataClient,
} from '../integration/ydb/ydbJsV6DataTransport.js';
import {
  retireInitialBootstrapStaleStagingRun,
} from '../migration/initialBootstrapStaleStagingRetirement.js';
import {
  readInitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobConfig,
  type InitialBootstrapRecoveryJobEnvironment,
} from './initialBootstrapRecoveryJob.js';

export type InitialBootstrapStaleStagingRetirementJobEnvironment =
  InitialBootstrapRecoveryJobEnvironment;

export interface InitialBootstrapStaleStagingRetirementJobSource {
  readFullSnapshotObservation(): Promise<Readonly<GoogleSheetsFullSnapshotLease>>;
}

export interface InitialBootstrapStaleStagingRetirementJobYdbClient {
  readonly transport: YdbTransport;
  close(): Promise<void>;
}

export interface InitialBootstrapStaleStagingRetirementJobRuntime {
  createDigest(): Readonly<CanonicalSourceDigest>;
  createSource(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapStaleStagingRetirementJobSource>;
  createYdbClient(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
  ): Promise<Readonly<InitialBootstrapStaleStagingRetirementJobYdbClient>>;
  now(): string;
  retire(adapter: YdbAdapter, authoritativeSnapshotDigest: string, finishedAt: string): Promise<unknown>;
}

const productionRuntime: Readonly<InitialBootstrapStaleStagingRetirementJobRuntime> = Object.freeze({
  createDigest: createCanonicalSourceDigest,
  createSource(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
    digest: Readonly<CanonicalSourceDigest>,
  ): Readonly<InitialBootstrapStaleStagingRetirementJobSource> {
    const accessTokenProvider = createGoogleServiceAccountSheetsAccessTokenProvider({
      clientEmail: config.googleServiceAccountEmail,
      privateKey: config.googleServiceAccountPrivateKey,
    });
    return new GoogleSheetsFullSnapshotReader({
      spreadsheetId: config.spreadsheetId,
      fetch: async (input, init) => fetch(input, init),
      accessTokenProvider,
      digest,
    });
  },
  createYdbClient(
    config: Readonly<InitialBootstrapRecoveryJobConfig>,
  ): Promise<Readonly<YdbJsDataClient>> {
    return createYdbJsV6MetadataDataClient({
      connectionString: config.ydbConnectionString,
      poolMaxSize: 1,
    });
  },
  now(): string {
    return new Date().toISOString();
  },
  retire: retireInitialBootstrapStaleStagingRun,
});

export async function executeInitialBootstrapStaleStagingRetirementJob(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
  runtime: Readonly<InitialBootstrapStaleStagingRetirementJobRuntime>,
): Promise<void> {
  const digest = runtime.createDigest();
  const source = runtime.createSource(config, digest);
  const lease = await source.readFullSnapshotObservation();
  const ydbClient = await runtime.createYdbClient(config);
  let primaryError: unknown = null;

  try {
    await runtime.retire(
      new YdbAdapter(ydbClient.transport),
      lease.snapshotDigest,
      runtime.now(),
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await ydbClient.close();
    } catch (error) {
      if (primaryError === null) throw error;
    }
  }
}

export function runInitialBootstrapStaleStagingRetirementJobFromEnvironment(
  environment: InitialBootstrapStaleStagingRetirementJobEnvironment = process.env,
): Promise<void> {
  const config = readInitialBootstrapRecoveryJobConfig(environment);
  return executeInitialBootstrapStaleStagingRetirementJob(config, productionRuntime);
}
