// Privacy-safe read-only current/manifest discriminator for initial STAGING recovery.
// Reuse existing canonical YdbReadScope readers; never output counts, IDs or financial rows.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';
import { readInitialBootstrapStaleStagingRetirementCurrentState }
  from '../dist/migration/initialBootstrapStaleStagingRetirementDiagnostic.js';
import { diagnoseInitialBootstrapStagingRevisionCardinality }
  from '../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

const conn = process.env.PRIHRASH_YDB_CONNECTION_STRING;
const token = process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
const expected = process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
if (!conn || !token || !expected || !isExactYdbEndpoint(conn, expected)) {
  process.stdout.write('R1_STAGING_CURRENT=CONFIG_INVALID\n');
  process.exit(2);
}

// Both canonical diagnostics have fixed SQL. Accept only the precise 3 read shapes.
// If those source contracts change, stop rather than issuing an unreviewed query.
const COUNTS = new Set([
  'SELECT COUNT(*) AS row_count FROM source_records',
  'SELECT COUNT(*) AS row_count FROM transactions',
]);
function allowedStatement(statement) {
  if (statement?.kind !== 'READ' || Object.keys(statement.parameters ?? {}).length !== 0) return false;
  const text = statement.text;
  return typeof text === 'string' && (COUNTS.has(text) || (
    text.startsWith('SELECT r.state AS run_state, r.rows_seen AS rows_seen, ')
    && text.includes('FROM migration_runs AS r JOIN initial_bootstrap_identity_manifests AS m ')
    && text.includes('JOIN source_snapshots AS s ON s.id = m.source_snapshot_id ')
    && text.endsWith("WHERE r.state = 'STAGING' LIMIT 2")
  ));
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
  // A single consistent read-only snapshot across canonical-current and manifest reads.
  const [current, cardinality] = await sql.transaction(
    { isolation: 'snapshotReadOnly', idempotent: true },
    async (tx) => {
      const scope = Object.freeze({
        read: async (statement) => {
          if (!allowedStatement(statement)) throw new Error('READ_SCOPE_NOT_ALLOWLISTED');
          const sets = await tx(statement.text).timeout(10000);
          if (!Array.isArray(sets) || sets.length !== 1 || !Array.isArray(sets[0])) {
            throw new Error('READBACK_SHAPE_INVALID');
          }
          return Object.freeze({ rows: Object.freeze([...sets[0]]) });
        },
      });
      return [
        await readInitialBootstrapStaleStagingRetirementCurrentState(scope),
        await diagnoseInitialBootstrapStagingRevisionCardinality(scope),
      ];
    },
  );
  // Cardinality bucket is private and deliberately never logged.
  const manifest = cardinality === 'DIAGNOSTIC_FAILED'
    ? 'NOT_PROVEN' : 'STRUCTURAL_COUNTS_CONSISTENT_UNVERIFIED';
  process.stdout.write(`R1_STAGING_CURRENT=${current}\n`);
  process.stdout.write(`R1_STAGING_MANIFEST=${manifest}\n`);
  if (current === 'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED' || manifest === 'NOT_PROVEN') {
    process.exitCode = 1;
  }
} catch {
  process.stdout.write('R1_STAGING_CURRENT=READ_FAILED\n');
  process.exitCode = 1;
} finally {
  try { driver?.close(); } catch { process.exitCode = 1; }
}
