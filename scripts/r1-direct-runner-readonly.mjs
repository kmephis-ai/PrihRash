// R1 Closure Path: read-only YDB reachability proof outside Cloud Functions.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';

const conn = process.env.PRIHRASH_YDB_CONNECTION_STRING;
const token = process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
const databasePath = process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
if (!conn || !token || !databasePath) {
  process.stdout.write('R1_DIRECT_PROBE=CONFIG_MISSING_OR_INVALID\n');
  process.exit(2);
}
if (!isExactYdbEndpoint(conn, databasePath)) {
  process.stdout.write('R1_DIRECT_PROBE=DB_PATH_INVALID\n');
  process.exit(2);
}

function safeFailureClass(error) {
  const value = [error?.code, error?.name, error?.status?.code]
    .filter((part) => typeof part === 'string' || typeof part === 'number')
    .map((part) => String(part).toUpperCase())
    .join(' ');
  if (/UNAUTHENTICATED|UNAUTHORIZED|PERMISSION_DENIED/.test(value)) return 'AUTH';
  if (/INVALID_ARGUMENT|BAD_REQUEST/.test(value)) return 'INVALID_REQUEST';
  if (/TIMEOUT|DEADLINE|ABORT/.test(value)) return 'TIMEOUT';
  if (/UNAVAILABLE|ECONN|ENOTFOUND|EAI_AGAIN/.test(value)) return 'TRANSPORT';
  // Message is inspected only in memory. Never publish its raw contents.
  const detail = [error?.message, error?.cause?.message]
    .filter((part) => typeof part === 'string')
    .join(' ').toUpperCase();
  if (/PERMISSION|UNAUTHORIZED|UNAUTHENTICATED|ACCESS DENIED|FORBIDDEN/.test(detail)) return 'AUTH';
  if (/CERTIFICATE|TLS|SSL|HANDSHAKE/.test(detail)) return 'TLS';
  if (/INVALID.*(CONNECTION|DATABASE|ENDPOINT)|MALFORMED|BAD URI/.test(detail)) return 'INVALID_REQUEST';
  if (/DEADLINE|TIMED OUT|TIMEOUT|ABORT/.test(detail)) return 'TIMEOUT';
  if (/DISCOVERY|NO ENDPOINTS|GETADDRINFO|ENOTFOUND|ECONN|UNAVAILABLE/.test(detail)) return 'TRANSPORT';
  if (error instanceof TypeError) return 'SDK_TYPE_ERROR';
  return 'UNCLASSIFIED';
}

let driver;
let stage = 'CONNECT';
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
  stage = 'QUERY';
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  await sql`SELECT 1 AS r1_readonly_probe;`.timeout(10000);
  process.stdout.write('R1_DIRECT_PROBE=READ_ONLY_SELECT_OK\n');
} catch (error) {
  process.stdout.write(`R1_DIRECT_PROBE=${stage}_FAILED_${safeFailureClass(error)}\n`);
  process.exitCode = 1;
} finally {
  try { driver?.close(); } catch { process.exitCode = 1; }
}
