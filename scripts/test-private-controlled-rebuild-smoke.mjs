import { randomUUID } from 'node:crypto';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { Uuid } from '@ydbjs/value/primitive';
import { EnvironCredentialsProvider } from '@ydbjs/auth/environ';
import { SchemeServiceDefinition } from '@ydbjs/api/scheme';
import { OperationParams_OperationMode, StatusIds_StatusCode } from '@ydbjs/api/operation';
import { YdbJsV6SchemeTransport } from '../dist/integration/ydb/ydbJsV6SchemeTransport.js';
import { YdbSchemeTransportOutcomeUnknownError } from '../dist/integration/ydb/scheme.js';

const REQUIRED_SCOPE = 'TEST_PRIVATE';
const SAFE_PREFIX = 'prihrash_test_private_smoke';
const SYNTHETIC_TRANSACTION_ID = '00000000-0000-0000-0000-00000000a101';
const SYNTHETIC_SOURCE_ID = '00000000-0000-0000-0000-00000000a102';

function failClosed(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) failClosed(`MISSING_${name}`);
  return value.trim();
}

function msSince(start) {
  return Math.max(0, Math.round(performance.now() - start));
}

function safeEvidence(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function safeStageError(error, stage) {
  if (typeof error?.code === 'string' && error.code.length > 0) return error;
  const wrapped = new Error(`TEST_PRIVATE_${stage}_FAILED`, { cause: error });
  wrapped.code = `TEST_PRIVATE_${stage}_FAILED`;
  return wrapped;
}

async function credentialsProvider(connectionString) {
  const serviceAccountJson = process.env.TEST_PRIVATE_YDB_SERVICE_ACCOUNT_KEY_JSON?.trim();
  if (serviceAccountJson) {
    const { ServiceAccountCredentialsProvider } = await import('@ydbjs/auth-yandex-cloud');
    let parsed;
    try {
      parsed = JSON.parse(serviceAccountJson);
    } catch {
      failClosed('INVALID_SERVICE_ACCOUNT_SECRET');
    }
    return new ServiceAccountCredentialsProvider(parsed);
  }
  return new EnvironCredentialsProvider(connectionString);
}

function canonicalTransactionTable(sql, path) {
  return sql`CREATE TABLE ${sql.identifier(path)} (
    id Uuid NOT NULL,
    type Utf8,
    occurred_on Date,
    captured_at Timestamp,
    record_granularity Utf8,
    date_precision Utf8,
    aggregate_period_month Date,
    financial_period_id Uuid,
    period_assignment_quality Utf8,
    amount_minor Int64,
    currency Utf8,
    from_account_id Uuid,
    to_account_id Uuid,
    category_id Uuid,
    paid_by_member_id Uuid,
    description Utf8,
    note Utf8,
    status Utf8,
    analytics_state Utf8,
    flow_kind Utf8,
    created_at Timestamp,
    updated_at Timestamp,
    version Uint64,
    PRIMARY KEY (id)
  ) WITH (STORE = ROW)`;
}

function canonicalSourceRecordTable(sql, path) {
  return sql`CREATE TABLE ${sql.identifier(path)} (
    id Uuid NOT NULL,
    source_type Utf8,
    source_sheet Utf8,
    first_seen_at Timestamp,
    last_seen_at Timestamp,
    last_row_hint Uint64,
    current_digest String,
    state Utf8,
    classification Utf8,
    normalization_status Utf8,
    transaction_id Uuid,
    current_revision Uint64,
    resolution_code Utf8,
    resolved_at Timestamp,
    resolved_by Utf8,
    PRIMARY KEY (id)
  ) WITH (STORE = ROW)`;
}

async function rowCount(sql, path) {
  const resultSets = await sql`SELECT COUNT(*) AS c FROM ${sql.identifier(path)}`;
  const row = resultSets?.[0]?.[0];
  const value = row?.c;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  failClosed('INVALID_COUNT_READBACK');
}

async function hasSyntheticId(sql, path, id) {
  const resultSets = await sql`SELECT COUNT(*) AS c FROM ${sql.identifier(path)} WHERE id = ${new Uuid(id)}`;
  const row = resultSets?.[0]?.[0];
  const value = row?.c;
  const count = typeof value === 'bigint' ? Number(value) : value;
  return count === 1;
}

async function removeDirectoryRaw(driver, relativePath) {
  const root = driver.database.replace(/\/+$/u, '');
  const client = driver.createClient(SchemeServiceDefinition);
  const response = await client.removeDirectory({
    operationParams: { operationMode: OperationParams_OperationMode.SYNC },
    path: `${root}/${relativePath}`,
  });
  const operation = response.operation;
  if (operation?.ready !== true || operation.status !== StatusIds_StatusCode.SUCCESS) {
    failClosed('REMOVE_DIRECTORY_FAILED');
  }
}

async function dropTableBestEffort(sql, path) {
  try {
    await sql`DROP TABLE ${sql.identifier(path)}`;
  } catch {
    // Cleanup is idempotent best effort; final run-root removal verifies emptiness.
  }
}

async function cleanupCase(driver, sql, paths) {
  for (const path of [paths.stagingTransactions, paths.stagingSourceRecords, paths.currentTransactions, paths.currentSourceRecords]) {
    await dropTableBestEffort(sql, path);
  }
  for (const path of [paths.stagingDirectory, paths.currentDirectory, paths.caseDirectory]) {
    try {
      await removeDirectoryRaw(driver, path);
    } catch {
      // Final run-root cleanup determines whether run-scoped synthetic objects remain.
    }
  }
}

function casePaths(caseDirectory) {
  const currentDirectory = `${caseDirectory}/current`;
  const stagingDirectory = `${caseDirectory}/staging`;
  return Object.freeze({
    caseDirectory,
    currentDirectory,
    stagingDirectory,
    currentTransactions: `${currentDirectory}/transactions`,
    currentSourceRecords: `${currentDirectory}/source_records`,
    stagingTransactions: `${stagingDirectory}/transactions`,
    stagingSourceRecords: `${stagingDirectory}/source_records`,
  });
}

async function createCase(scheme, sql, paths) {
  let stage = 'ENSURE_CASE_DIRECTORY';
  try {
    await scheme.ensureDirectory(paths.caseDirectory);
    stage = 'ENSURE_CURRENT_DIRECTORY';
    await scheme.ensureDirectory(paths.currentDirectory);
    stage = 'ENSURE_STAGING_DIRECTORY';
    await scheme.ensureDirectory(paths.stagingDirectory);
    stage = 'CREATE_TRANSACTIONS_TABLE';
    await canonicalTransactionTable(sql, paths.currentTransactions);
    stage = 'CREATE_SOURCE_RECORDS_TABLE';
    await canonicalSourceRecordTable(sql, paths.currentSourceRecords);
    stage = 'INSERT_TRANSACTION_ROW';
    await sql`INSERT INTO ${sql.identifier(paths.currentTransactions)} (id) VALUES (${new Uuid(SYNTHETIC_TRANSACTION_ID)})`;
    stage = 'INSERT_SOURCE_RECORD_ROW';
    await sql`INSERT INTO ${sql.identifier(paths.currentSourceRecords)} (id) VALUES (${new Uuid(SYNTHETIC_SOURCE_ID)})`;
  } catch (error) {
    throw safeStageError(error, `CREATE_CASE_${stage}`);
  }
}

async function copyAndVerify(scheme, sql, paths) {
  const started = performance.now();
  await scheme.copyTables([
    { source: paths.currentTransactions, destination: paths.stagingTransactions, omitIndexes: false },
    { source: paths.currentSourceRecords, destination: paths.stagingSourceRecords, omitIndexes: false },
  ]);
  const latencyMs = msSince(started);
  const counts = await Promise.all([
    rowCount(sql, paths.stagingTransactions),
    rowCount(sql, paths.stagingSourceRecords),
  ]);
  if (counts[0] !== 1 || counts[1] !== 1) failClosed('STAGING_COPY_READBACK_MISMATCH');
  return latencyMs;
}

async function renameAndVerify(scheme, sql, paths) {
  const started = performance.now();
  await scheme.renameTables([
    { source: paths.stagingTransactions, destination: paths.currentTransactions, replace: true },
    { source: paths.stagingSourceRecords, destination: paths.currentSourceRecords, replace: true },
  ]);
  const latencyMs = msSince(started);
  const [transactionsCount, sourceRecordsCount, transactionMarker, sourceMarker] = await Promise.all([
    rowCount(sql, paths.currentTransactions),
    rowCount(sql, paths.currentSourceRecords),
    hasSyntheticId(sql, paths.currentTransactions, SYNTHETIC_TRANSACTION_ID),
    hasSyntheticId(sql, paths.currentSourceRecords, SYNTHETIC_SOURCE_ID),
  ]);
  if (transactionsCount !== 1 || sourceRecordsCount !== 1 || !transactionMarker || !sourceMarker) {
    failClosed('CANONICAL_READBACK_MISMATCH');
  }
  return latencyMs;
}

async function unknownOutcomeCase(scheme, sql, paths) {
  let renameCalls = 0;
  const injected = {
    async renameTables(items) {
      renameCalls += 1;
      await scheme.renameTables(items);
      throw new YdbSchemeTransportOutcomeUnknownError(new Error('INJECTED_AFTER_PROVIDER_SUCCESS'));
    },
  };

  let observedUnknown = false;
  const started = performance.now();
  try {
    await injected.renameTables([
      { source: paths.stagingTransactions, destination: paths.currentTransactions, replace: true },
      { source: paths.stagingSourceRecords, destination: paths.currentSourceRecords, replace: true },
    ]);
  } catch (error) {
    if (!(error instanceof YdbSchemeTransportOutcomeUnknownError)) throw error;
    observedUnknown = true;
  }
  const latencyMs = msSince(started);
  if (!observedUnknown || renameCalls !== 1) failClosed('UNKNOWN_OUTCOME_INJECTION_FAILED');

  const [transactionsCount, sourceRecordsCount] = await Promise.all([
    rowCount(sql, paths.currentTransactions),
    rowCount(sql, paths.currentSourceRecords),
  ]);
  if (transactionsCount !== 1 || sourceRecordsCount !== 1) failClosed('UNKNOWN_OUTCOME_RECOVERY_READBACK_MISMATCH');

  return Object.freeze({ latencyMs, renameCalls, recovery: 'APPLIED_WITHOUT_RETRY' });
}

async function main() {
  if (process.env.PRIHRASH_TEST_PRIVATE_SCOPE !== REQUIRED_SCOPE) failClosed('TEST_PRIVATE_SCOPE_REQUIRED');
  const connectionString = requireEnv('TEST_PRIVATE_YDB_CONNECTION_STRING');
  if (!connectionString.startsWith('grpcs://') && !connectionString.startsWith('grpc://')) {
    failClosed('INVALID_CONNECTION_STRING_SCHEME');
  }

  const provider = await credentialsProvider(connectionString);
  const driver = new Driver(connectionString, {
    credentialsProvider: provider,
    ...(provider.secureOptions ? { secureOptions: provider.secureOptions } : {}),
  });
  await driver.ready();

  const sql = query(driver, { poolOptions: { maxSize: 4 } });
  const scheme = new YdbJsV6SchemeTransport(driver);
  const runTag = randomUUID().replaceAll('-', '');
  const runDirectory = `${SAFE_PREFIX}_r_${runTag}`;
  const normalPaths = casePaths(`${runDirectory}/normal`);
  const unknownPaths = casePaths(`${runDirectory}/unknown`);
  let cleanupStatus = 'PASS';
  let primaryError = null;
  let stage = 'ENSURE_RUN_DIRECTORY';

  const totalStarted = performance.now();
  try {
    await scheme.ensureDirectory(runDirectory);

    stage = 'CREATE_NORMAL_CASE';
    await createCase(scheme, sql, normalPaths);
    stage = 'COPY_NORMAL_CASE';
    const copyLatencyMs = await copyAndVerify(scheme, sql, normalPaths);
    stage = 'RENAME_NORMAL_CASE';
    const renameLatencyMs = await renameAndVerify(scheme, sql, normalPaths);

    stage = 'CREATE_UNKNOWN_CASE';
    await createCase(scheme, sql, unknownPaths);
    stage = 'COPY_UNKNOWN_CASE';
    const unknownCopyLatencyMs = await copyAndVerify(scheme, sql, unknownPaths);
    stage = 'UNKNOWN_OUTCOME_CASE';
    const unknown = await unknownOutcomeCase(scheme, sql, unknownPaths);

    safeEvidence({
      scope: REQUIRED_SCOPE,
      syntheticOnly: true,
      provider: 'YDB',
      copyTables: { status: 'PASS', tableCount: 2, latencyMs: copyLatencyMs },
      renameTablesReplace: { status: 'PASS', tableCount: 2, latencyMs: renameLatencyMs },
      canonicalReadBack: { status: 'PASS', transactions: 1, sourceRecords: 1 },
      unknownOutcome: {
        status: 'PASS',
        injected: true,
        providerRenameCalls: unknown.renameCalls,
        recovery: unknown.recovery,
        copyLatencyMs: unknownCopyLatencyMs,
        renameLatencyMs: unknown.latencyMs,
      },
    });
  } catch (error) {
    primaryError = safeStageError(error, stage);
  } finally {
    try {
      await cleanupCase(driver, sql, unknownPaths);
      await cleanupCase(driver, sql, normalPaths);
      await removeDirectoryRaw(driver, runDirectory);
    } catch {
      cleanupStatus = 'FAILED';
    }
    try {
      await driver.close();
    } catch {
      cleanupStatus = 'FAILED';
    }
    safeEvidence({
      scope: REQUIRED_SCOPE,
      syntheticOnly: true,
      cleanup: cleanupStatus,
      totalLatencyMs: msSince(totalStarted),
    });
  }

  if (primaryError !== null) throw primaryError;
  if (cleanupStatus !== 'PASS') failClosed('SYNTHETIC_CLEANUP_FAILED');
}

main().catch((error) => {
  safeEvidence({
    scope: REQUIRED_SCOPE,
    syntheticOnly: true,
    status: 'FAIL',
    errorCode: typeof error?.code === 'string' ? error.code : 'TEST_PRIVATE_SMOKE_FAILED',
  });
  process.exitCode = 1;
});
