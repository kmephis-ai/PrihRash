// Manual, exact-main, read-only observation of migration run lifecycle only.
// The SQL projects no finance columns, IDs, timestamps, totals or raw payloads.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';
import { classifyMigrationLifecycleGroups } from './r1-migration-lifecycle-classifier.mjs';

const conn = process.env.PRIHRASH_YDB_CONNECTION_STRING;
const token = process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
const expected = process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
if (!conn || !token || !expected || !isExactYdbEndpoint(conn, expected)) {
  process.stdout.write('R1_LIFECYCLE=CONFIG_INVALID\n');
  process.exit(2);
}

let driver;
try {
  const [{ Driver }, { AccessTokenCredentialsProvider }, { query }] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/auth/access-token'),
    import('@ydbjs/query'),
  ]);
  driver = new Driver(conn, {
    credentialsProvider: new AccessTokenCredentialsProvider({ token }),
  });
  await driver.ready(AbortSignal.timeout(12000));
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  // One immutable, bounded-output statement: all counts stay in memory.
  // Explicit snapshotReadOnly prevents any data mutation.
  const result = await sql`SELECT state, COUNT(*) AS row_count
    FROM migration_runs
    GROUP BY state;`.isolation('snapshotReadOnly').timeout(10000);
  const verdict = classifyMigrationLifecycleGroups(result);
  process.stdout.write(`R1_LIFECYCLE=${verdict}\n`);
  if (verdict === 'EVIDENCE_INVALID') process.exitCode = 1;
} catch (error) {
  const code = String(error?.code ?? error?.status?.code ?? '').toUpperCase();
  const kind = /UNAUTHENTICATED|UNAUTHORIZED|PERMISSION_DENIED/.test(code)
    ? 'READ_DENIED'
    : /DEADLINE|TIMEOUT/.test(code) ? 'TIMEOUT' : 'READ_FAILED';
  process.stdout.write(`R1_LIFECYCLE=${kind}\n`);
  process.exitCode = 1;
} finally {
  try { driver?.close(); } catch { process.exitCode = 1; }
}
