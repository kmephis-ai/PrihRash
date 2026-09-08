import { randomUUID } from 'node:crypto';
import { Driver } from '@ydbjs/core';
import { query } from '@ydbjs/query';
import { Int64, Utf8, Uuid } from '@ydbjs/value/primitive';
import { EnvironCredentialsProvider } from '@ydbjs/auth/environ';
import { SchemeServiceDefinition } from '@ydbjs/api/scheme';
import { OperationParams_OperationMode, StatusIds_StatusCode } from '@ydbjs/api/operation';
import { YdbAdapter } from '../dist/integration/ydb/adapter.js';
import { createYdbJsV6DataTransport } from '../dist/integration/ydb/ydbJsV6DataTransport.js';
import { YdbJsV6SchemeTransport } from '../dist/integration/ydb/ydbJsV6SchemeTransport.js';
import { YdbSchemeAdapter, YdbSchemeTransportOutcomeUnknownError } from '../dist/integration/ydb/scheme.js';
import { recoverUnknownControlledInitialSwapOutcome } from '../dist/migration/initialControlledRebuildSchemeRecovery.js';

const REQUIRED_SCOPE = 'TEST_PRIVATE';
const SAFE_PREFIX = 'prihrash_test_private_smoke';
const SYNTHETIC_TRANSACTION_ID = '00000000-0000-0000-0000-00000000a101';
const SYNTHETIC_SOURCE_ID = '00000000-0000-0000-0000-00000000a102';
const SYNTHETIC_ACCOUNT_ID = '00000000-0000-0000-0000-00000000a103';
const SYNTHETIC_CATEGORY_ID = '00000000-0000-0000-0000-00000000a104';
const SYNTHETIC_AMOUNT_MINOR = 12345;
const OVERLOADED_PROVIDER_STATUS = 400060;
const OVERLOADED_RETRY_DELAYS_MS = Object.freeze([250, 500, 1000]);
const LOGICAL_TABLE = /`(rebuild\/r_[0-9a-f]{32}\/(?:transactions|source_records)|transactions|source_records)`/gu;

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

function safeInternalCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]+$/u.test(value) ? value : null;
}

function safeProviderIssueCodes(issues) {
  const codes = [];
  const visit = (items) => {
    if (!Array.isArray(items)) return;
    for (const issue of items) {
      if (codes.length >= 16) return;
      if (Number.isSafeInteger(issue?.issueCode)) codes.push(issue.issueCode);
      visit(issue?.issues);
      if (codes.length >= 16) return;
    }
  };
  visit(issues);
  return Object.freeze(codes);
}

function safeStageError(error, stage) {
  if (typeof error?.stage === 'string' && safeInternalCode(error?.code) !== null) return error;
  const wrapped = new Error(`TEST_PRIVATE_${stage}_FAILED`, { cause: error });
  wrapped.code = `TEST_PRIVATE_${stage}_FAILED`;
  wrapped.stage = stage;
  wrapped.innerCode = safeInternalCode(error?.code);
  wrapped.providerStatus = Number.isSafeInteger(error?.status)
    ? error.status
    : (Number.isSafeInteger(error?.code) ? error.code : null);
  wrapped.providerIssueCodes = safeProviderIssueCodes(error?.issues);
  return wrapped;
}

async function atStage(stage, work) {
  try {
    return await work();
  } catch (error) {
    throw safeStageError(error, stage);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryExplicitOverloaded(work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const overloaded = Number.isSafeInteger(error?.status) && error.status === OVERLOADED_PROVIDER_STATUS;
      if (!overloaded || attempt >= OVERLOADED_RETRY_DELAYS_MS.length) throw error;
      await sleep(OVERLOADED_RETRY_DELAYS_MS[attempt]);
    }
  }
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
  const value = resultSets?.[0]?.[0]?.c;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  failClosed('INVALID_COUNT_READBACK');
}

async function hasSyntheticId(sql, path, id) {
  const resultSets = await sql`SELECT COUNT(*) AS c FROM ${sql.identifier(path)} WHERE id = ${new Uuid(id)}`;
  const value = resultSets?.[0]?.[0]?.c;
  const count = typeof value === 'bigint' ? Number(value) : value;
  return count === 1;
}

function normalCasePaths(caseDirectory) {
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

async function cleanupNormalCase(driver, sql, paths) {
  for (const path of [
    paths.stagingTransactions,
    paths.stagingSourceRecords,
    paths.currentTransactions,
    paths.currentSourceRecords,
  ]) {
    await dropTableBestEffort(sql, path);
  }
  for (const path of [paths.stagingDirectory, paths.currentDirectory, paths.caseDirectory]) {
    try {
      await removeDirectoryRaw(driver, path);
    } catch {
      // Final run-root removal determines whether run-scoped synthetic objects remain.
    }
  }
}

async function normalCopyRenameSmoke(driver, scheme, sql, runDirectory) {
  const paths = normalCasePaths(`${runDirectory}/normal`);
  try {
    await retryExplicitOverloaded(() => scheme.ensureDirectory(paths.caseDirectory));
    await retryExplicitOverloaded(() => scheme.ensureDirectory(paths.currentDirectory));
    await retryExplicitOverloaded(() => scheme.ensureDirectory(paths.stagingDirectory));
    await canonicalTransactionTable(sql, paths.currentTransactions);
    await canonicalSourceRecordTable(sql, paths.currentSourceRecords);
    await sql`INSERT INTO ${sql.identifier(paths.currentTransactions)} (id) VALUES (${new Uuid(SYNTHETIC_TRANSACTION_ID)})`;
    await sql`INSERT INTO ${sql.identifier(paths.currentSourceRecords)} (id) VALUES (${new Uuid(SYNTHETIC_SOURCE_ID)})`;

    const copyStarted = performance.now();
    await scheme.copyTables([
      { source: paths.currentTransactions, destination: paths.stagingTransactions, omitIndexes: false },
      { source: paths.currentSourceRecords, destination: paths.stagingSourceRecords, omitIndexes: false },
    ]);
    const copyLatencyMs = msSince(copyStarted);
    if (
      await rowCount(sql, paths.stagingTransactions) !== 1
      || await rowCount(sql, paths.stagingSourceRecords) !== 1
    ) failClosed('STAGING_COPY_READBACK_MISMATCH');

    const renameStarted = performance.now();
    await scheme.renameTables([
      { source: paths.stagingTransactions, destination: paths.currentTransactions, replace: true },
      { source: paths.stagingSourceRecords, destination: paths.currentSourceRecords, replace: true },
    ]);
    const renameLatencyMs = msSince(renameStarted);
    if (
      !await hasSyntheticId(sql, paths.currentTransactions, SYNTHETIC_TRANSACTION_ID)
      || !await hasSyntheticId(sql, paths.currentSourceRecords, SYNTHETIC_SOURCE_ID)
    ) failClosed('CANONICAL_READBACK_MISMATCH');

    return Object.freeze({ copyLatencyMs, renameLatencyMs });
  } finally {
    await cleanupNormalCase(driver, sql, paths);
  }
}

async function removeDirectoryRaw(driver, relativePath) {
  const root = driver.database.replace(/\/+$/u, '');
  const client = driver.createClient(SchemeServiceDefinition);
  await retryExplicitOverloaded(async () => {
    const response = await client.removeDirectory({
      operationParams: { operationMode: OperationParams_OperationMode.SYNC },
      path: `${root}/${relativePath}`,
    });
    const operation = response.operation;
    if (operation?.ready !== true || operation.status !== StatusIds_StatusCode.SUCCESS) {
      const error = new Error('REMOVE_DIRECTORY_FAILED');
      error.code = 'REMOVE_DIRECTORY_FAILED';
      error.status = Number.isSafeInteger(operation?.status) ? operation.status : null;
      throw error;
    }
  });
}

async function dropTableBestEffort(sql, path) {
  try {
    await sql`DROP TABLE ${sql.identifier(path)}`;
  } catch {
    // Run-scoped cleanup is idempotent best effort; parent removal remains the final guard.
  }
}

function logicalRunDirectory(runId) {
  return `rebuild/r_${runId.replaceAll('-', '')}`;
}

function casePaths(caseDirectory, runId) {
  const rebuildDirectory = `${caseDirectory}/rebuild`;
  const stagingDirectory = `${caseDirectory}/${logicalRunDirectory(runId)}`;
  return Object.freeze({
    caseDirectory,
    rebuildDirectory,
    stagingDirectory,
    currentTransactions: `${caseDirectory}/transactions`,
    currentSourceRecords: `${caseDirectory}/source_records`,
    stagingTransactions: `${stagingDirectory}/transactions`,
    stagingSourceRecords: `${stagingDirectory}/source_records`,
  });
}

function candidatePlan() {
  return Object.freeze({
    sourceRecords: Object.freeze([
      Object.freeze({ classification: 'FINANCIAL_RECORD', state: null }),
    ]),
    transactions: Object.freeze([
      Object.freeze({
        sourceRecordId: SYNTHETIC_SOURCE_ID,
        transactionId: SYNTHETIC_TRANSACTION_ID,
        transaction: Object.freeze({
          type: 'EXPENSE',
          occurredOn: '2026-08-01',
          recordGranularity: 'TRANSACTION',
          datePrecision: 'DAY',
          aggregatePeriodMonth: null,
          financialPeriodId: null,
          periodAssignmentQuality: 'UNASSIGNED',
          amountMinor: SYNTHETIC_AMOUNT_MINOR,
          currency: 'RUB',
          fromAccountId: SYNTHETIC_ACCOUNT_ID,
          toAccountId: null,
          categoryId: SYNTHETIC_CATEGORY_ID,
          paidByMemberId: null,
          description: 'Synthetic recovery proof',
          note: null,
          status: 'POSTED',
          analyticsState: 'INCLUDED',
          flowKind: null,
        }),
      }),
    ]),
  });
}

function swapPlan(runId) {
  const directory = logicalRunDirectory(runId);
  return Object.freeze({
    runId,
    replacements: Object.freeze([
      Object.freeze({ source: `${directory}/transactions`, destination: 'transactions', replace: true }),
      Object.freeze({ source: `${directory}/source_records`, destination: 'source_records', replace: true }),
    ]),
  });
}

function physicalPath(prefix, logicalPath) {
  return logicalPath.length === 0 ? prefix : `${prefix}/${logicalPath}`;
}

function createScopedSchemeTransport(base, prefix) {
  const counters = { providerRenameCalls: 0 };
  const transport = Object.freeze({
    ensureDirectory(path) {
      return base.ensureDirectory(physicalPath(prefix, path));
    },
    copyTables(items) {
      return base.copyTables(items.map((item) => ({
        ...item,
        source: physicalPath(prefix, item.source),
        destination: physicalPath(prefix, item.destination),
      })));
    },
    renameTables(items) {
      counters.providerRenameCalls += 1;
      return base.renameTables(items.map((item) => ({
        ...item,
        source: physicalPath(prefix, item.source),
        destination: physicalPath(prefix, item.destination),
      })));
    },
    listDirectory(path) {
      return base.listDirectory(physicalPath(prefix, path));
    },
  });
  return Object.freeze({ transport, counters });
}

function scopedStatement(statement, prefix) {
  return Object.freeze({
    ...statement,
    text: statement.text.replace(LOGICAL_TABLE, (_match, path) => `\`${physicalPath(prefix, path)}\``),
  });
}

function createScopedDataTransport(base, prefix) {
  return Object.freeze({
    executeRead(statement) {
      return base.executeRead(scopedStatement(statement, prefix));
    },
    serializableReadWrite(work) {
      return base.serializableReadWrite((transaction) => work(Object.freeze({
        execute(statement) {
          return transaction.execute(scopedStatement(statement, prefix));
        },
      })));
    },
  });
}

async function createCase(baseScheme, sql, paths, name) {
  await atStage(`${name}_CREATE_ENSURE_CASE_DIRECTORY`, () => retryExplicitOverloaded(() => baseScheme.ensureDirectory(paths.caseDirectory)));
  await atStage(`${name}_CREATE_ENSURE_REBUILD_DIRECTORY`, () => retryExplicitOverloaded(() => baseScheme.ensureDirectory(paths.rebuildDirectory)));
  await atStage(`${name}_CREATE_ENSURE_STAGING_DIRECTORY`, () => retryExplicitOverloaded(() => baseScheme.ensureDirectory(paths.stagingDirectory)));
  await atStage(`${name}_CREATE_CURRENT_TRANSACTIONS`, () => canonicalTransactionTable(sql, paths.currentTransactions));
  await atStage(`${name}_CREATE_CURRENT_SOURCE_RECORDS`, () => canonicalSourceRecordTable(sql, paths.currentSourceRecords));
  await atStage(`${name}_CREATE_STAGING_TRANSACTIONS`, () => canonicalTransactionTable(sql, paths.stagingTransactions));
  await atStage(`${name}_CREATE_STAGING_SOURCE_RECORDS`, () => canonicalSourceRecordTable(sql, paths.stagingSourceRecords));

  await atStage(`${name}_CREATE_INSERT_STAGING_TRANSACTION`, () => sql`INSERT INTO ${sql.identifier(paths.stagingTransactions)} (
    id, type, amount_minor, from_account_id, to_account_id, category_id
  ) VALUES (
    ${new Uuid(SYNTHETIC_TRANSACTION_ID)}, ${new Utf8('EXPENSE')}, ${new Int64(BigInt(SYNTHETIC_AMOUNT_MINOR))},
    ${new Uuid(SYNTHETIC_ACCOUNT_ID)}, NULL, ${new Uuid(SYNTHETIC_CATEGORY_ID)}
  )`);
  await atStage(`${name}_CREATE_INSERT_STAGING_SOURCE_RECORD`, () => sql`INSERT INTO ${sql.identifier(paths.stagingSourceRecords)} (id, classification, state) VALUES (
    ${new Uuid(SYNTHETIC_SOURCE_ID)}, ${new Utf8('FINANCIAL_RECORD')}, NULL
  )`);
}

async function cleanupCase(driver, sql, paths) {
  for (const path of [
    paths.stagingTransactions,
    paths.stagingSourceRecords,
    paths.currentTransactions,
    paths.currentSourceRecords,
  ]) {
    await dropTableBestEffort(sql, path);
  }
  for (const path of [paths.stagingDirectory, paths.rebuildDirectory, paths.caseDirectory]) {
    try {
      await removeDirectoryRaw(driver, path);
    } catch {
      // Final run-root removal determines whether run-scoped synthetic objects remain.
    }
  }
}

async function requireRecoveryVerdict(scheme, data, plan, candidate, expected, counters) {
  const beforeRenameCalls = counters.providerRenameCalls;
  const started = performance.now();
  const result = await recoverUnknownControlledInitialSwapOutcome(scheme, data, plan, candidate);
  const latencyMs = msSince(started);
  if (result.verdict !== expected) failClosed(`RECOVERY_VERDICT_${expected}_NOT_PROVEN`);
  if (counters.providerRenameCalls !== beforeRenameCalls) failClosed('RECOVERY_PERFORMED_RENAME');
  return Object.freeze({ verdict: result.verdict, latencyMs });
}

async function injectUnknown(mode, transport, plan) {
  let mutationAttempts = 0;
  const beforeProviderCalls = transport.counters.providerRenameCalls;
  let observedUnknown = false;
  const started = performance.now();
  try {
    mutationAttempts += 1;
    if (mode === 'APPLIED') {
      await transport.transport.renameTables(plan.replacements);
    } else if (mode === 'RECOVERY_REQUIRED') {
      await transport.transport.renameTables([plan.replacements[0]]);
    }
    throw new YdbSchemeTransportOutcomeUnknownError(new Error(`INJECTED_${mode}`));
  } catch (error) {
    if (!(error instanceof YdbSchemeTransportOutcomeUnknownError)) throw error;
    observedUnknown = true;
  }
  if (!observedUnknown || mutationAttempts !== 1) failClosed('UNKNOWN_OUTCOME_INJECTION_FAILED');
  return Object.freeze({
    latencyMs: msSince(started),
    mutationAttempts,
    providerRenameCalls: transport.counters.providerRenameCalls - beforeProviderCalls,
  });
}

async function triStateCase(driver, baseScheme, baseDataTransport, sql, runDirectory, name, expectedAfter) {
  const runId = randomUUID().toLowerCase();
  const paths = casePaths(`${runDirectory}/${name.toLowerCase()}`, runId);
  const plan = swapPlan(runId);
  const candidate = candidatePlan();
  try {
    await atStage(`${name}_CREATE_CASE`, () => createCase(baseScheme, sql, paths, name));

    const scopedScheme = createScopedSchemeTransport(baseScheme, paths.caseDirectory);
    const scheme = new YdbSchemeAdapter(scopedScheme.transport);
    const data = new YdbAdapter(createScopedDataTransport(baseDataTransport, paths.caseDirectory));

    const before = await atStage(
      `${name}_RECOVER_BEFORE`,
      () => requireRecoveryVerdict(scheme, data, plan, candidate, 'NOT_APPLIED', scopedScheme.counters),
    );
    const injected = await atStage(`${name}_INJECT_UNKNOWN`, () => injectUnknown(expectedAfter, scopedScheme, plan));
    const after = await atStage(
      `${name}_RECOVER_AFTER`,
      () => requireRecoveryVerdict(scheme, data, plan, candidate, expectedAfter, scopedScheme.counters),
    );

    return Object.freeze({
      name,
      before: before.verdict,
      after: after.verdict,
      mutationAttempts: injected.mutationAttempts,
      providerRenameCalls: injected.providerRenameCalls,
      recoveryRenameCalls: 0,
      injectionLatencyMs: injected.latencyMs,
      recoveryLatencyMs: after.latencyMs,
    });
  } finally {
    await atStage(`${name}_CLEANUP`, () => cleanupCase(driver, sql, paths));
  }
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
  const baseScheme = new YdbJsV6SchemeTransport(driver);
  const baseDataTransport = createYdbJsV6DataTransport(sql, () => failClosed('UNEXPECTED_RECOVERY_PARAMETER'));
  const runDirectory = `${SAFE_PREFIX}_r_${randomUUID().replaceAll('-', '')}`;
  const cases = [];
  let cleanupStatus = 'PASS';
  let primaryError = null;
  let stage = 'ENSURE_RUN_DIRECTORY';

  const totalStarted = performance.now();
  try {
    await retryExplicitOverloaded(() => baseScheme.ensureDirectory(runDirectory));

    stage = 'NORMAL_COPY_RENAME';
    const normal = await normalCopyRenameSmoke(driver, baseScheme, sql, runDirectory);
    stage = 'PROVE_APPLIED';
    cases.push(await triStateCase(driver, baseScheme, baseDataTransport, sql, runDirectory, 'APPLIED', 'APPLIED'));
    stage = 'PROVE_NOT_APPLIED';
    cases.push(await triStateCase(driver, baseScheme, baseDataTransport, sql, runDirectory, 'NOT_APPLIED', 'NOT_APPLIED'));
    stage = 'PROVE_RECOVERY_REQUIRED';
    cases.push(await triStateCase(driver, baseScheme, baseDataTransport, sql, runDirectory, 'RECOVERY_REQUIRED', 'RECOVERY_REQUIRED'));

    safeEvidence({
      scope: REQUIRED_SCOPE,
      syntheticOnly: true,
      provider: 'YDB',
      controlledProviderSmoke: {
        copyTables: 'PASS',
        renameTablesReplace: 'PASS',
        copyLatencyMs: normal.copyLatencyMs,
        renameLatencyMs: normal.renameLatencyMs,
      },
      productionDiscriminator: 'recoverUnknownControlledInitialSwapOutcome',
      triStateRecovery: cases.map((item) => ({
        case: item.name,
        before: item.before,
        after: item.after,
        mutationAttempts: item.mutationAttempts,
        providerRenameCalls: item.providerRenameCalls,
        recoveryRenameCalls: item.recoveryRenameCalls,
        injectionLatencyMs: item.injectionLatencyMs,
        recoveryLatencyMs: item.recoveryLatencyMs,
      })),
      status: 'PASS',
    });
  } catch (error) {
    primaryError = safeStageError(error, stage);
  } finally {
    try {
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
    errorCode: safeInternalCode(error?.code) ?? 'TEST_PRIVATE_SMOKE_FAILED',
    stage: typeof error?.stage === 'string' ? error.stage : null,
    innerCode: safeInternalCode(error?.innerCode),
    providerStatus: Number.isSafeInteger(error?.providerStatus) ? error.providerStatus : null,
    providerIssueCodes: Array.isArray(error?.providerIssueCodes) ? error.providerIssueCodes : [],
  });
  process.exitCode = 1;
});
