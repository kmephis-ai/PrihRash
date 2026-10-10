// R1: current STAGING timestamp vs exact previously invoked bootstrap child.
// Outputs enum only; no timestamps, counts, ids, source rows, or SDK errors.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';
import { classifyInitialBootstrapStagingRunLineage } from '../dist/migration/initialBootstrapRecoveryProbe.js';

const uri = process.env.PRIHRASH_YDB_CONNECTION_STRING;
const token = process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
const database = process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
const child = process.env.PRIHRASH_R1_CAUSAL_BOOTSTRAP_STARTED_AT;
if (!uri || !token || !database || !isExactYdbEndpoint(uri, database)
    || typeof child !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(child)
    || !Number.isFinite(Date.parse(child))) {
  process.stdout.write('R1_LINEAGE=CONFIG_INVALID\n');
  process.exit(2);
}
let driver;
try {
  const [{ Driver }, { AccessTokenCredentialsProvider }, { query }] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/auth/access-token'),
    import('@ydbjs/query'),
  ]);
  driver = new Driver(uri, {
    credentialsProvider: new AccessTokenCredentialsProvider({ token }),
  });
  await driver.ready(AbortSignal.timeout(12000));
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  // Canonical statement, same as initialBootstrapRecoveryProbe.ts; query is read-only.
  const result = await sql`SELECT started_at FROM migration_runs
    WHERE state = 'STAGING' LIMIT 2;`.isolation('snapshotReadOnly').timeout(10000);
  const rows = Array.isArray(result) && result.length === 1 ? result[0] : null;
  const outcome = Array.isArray(rows) && rows.length === 1
    ? classifyInitialBootstrapStagingRunLineage(rows[0]?.started_at, child)
    : 'STAGING_RUN_CARDINALITY_INVALID';
  process.stdout.write(`R1_LINEAGE=${outcome}\n`);
  if (outcome === 'DIAGNOSTIC_FAILED' || outcome === 'STAGING_RUN_CARDINALITY_INVALID') {
    process.exitCode = 1;
  }
} catch {
  process.stdout.write('R1_LINEAGE=READ_FAILED\n');
  process.exitCode = 1;
} finally {
  try { driver?.close(); } catch { process.exitCode = 1; }
}
