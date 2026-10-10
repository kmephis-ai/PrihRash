// R1 manual-only readback of durable STAGING revision identity evidence.
// NEVER output source IDs, financial records, precise counts, digests, raw SDK errors or SQL results.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';
import { classifyDurableRead, classifyDurableOutcome } from './r1-durable-revision-guard.mjs';
import {
  diagnoseInitialBootstrapStagingRevisionCardinality,
  diagnoseInitialBootstrapStagingDurableRevisionEvidence,
} from '../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';
import { createYdbJsV6ParameterMapper } from '../dist/integration/ydb/ydbJsV6DataTransport.js';

const uri=process.env.PRIHRASH_YDB_CONNECTION_STRING;
const token=process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
const path=process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
if (!uri || !token || !path || !isExactYdbEndpoint(uri,path)) {
  process.stdout.write('R1_STAGING_DURABLE=CONFIG_INVALID\n');
  process.exit(2);
}

let driver;
try {
  const [{ Driver }, { AccessTokenCredentialsProvider }, { query }, sdk] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/auth/access-token'),
    import('@ydbjs/query'),
    import('@ydbjs/value'),
  ]);
  const mapParameter=createYdbJsV6ParameterMapper(sdk);
  driver=new Driver(uri,{credentialsProvider:new AccessTokenCredentialsProvider({token})});
  await driver.ready(AbortSignal.timeout(12000));
  const sql=query(driver,{poolOptions:{maxSize:1}});
  // No transactions with write capability. All reads share a single consistent snapshot.
  const verdict=await sql.transaction({isolation:'snapshotReadOnly',idempotent:true},
    async tx => {
      let reads=0;
      const readScope=Object.freeze({
        read:async statement => {
          const shape=classifyDurableRead(statement);
          if (!shape || ++reads>4) throw new Error('READ_SCOPE_NOT_ALLOWLISTED');
          // Explicit server-side cap to avoid unbounded revision scan results.
          const yql=shape.kind==='BY_RUN'||shape.kind==='BY_KEY'
            ? shape.sql+' LIMIT 5001' : shape.sql;
          let request=tx(yql).timeout(12000);
          for (const [name,param] of Object.entries(statement.parameters)) {
            request=request.parameter(name,mapParameter(param));
          }
          const sets=await request;
          if (!Array.isArray(sets)||sets.length!==1||!Array.isArray(sets[0])
              || sets[0].length>shape.cap) throw new Error('READBACK_LIMIT_OR_SHAPE_INVALID');
          return Object.freeze({rows:Object.freeze([...sets[0]])});
        },
      });
      // The canonical RU estimator remains private. The coarse bound is NOT a bill guarantee.
      const bucket=await diagnoseInitialBootstrapStagingRevisionCardinality(readScope);
      if(bucket!=='LT_5000_RU') return 'READ_BUDGET_NOT_PROVEN';
      return classifyDurableOutcome(
        await diagnoseInitialBootstrapStagingDurableRevisionEvidence(readScope));
    });
  process.stdout.write(`R1_STAGING_DURABLE=${verdict}\n`);
  if (verdict==='EVIDENCE_INVALID'||verdict==='READ_BUDGET_NOT_PROVEN'||verdict==='REVISION_EVIDENCE_DIAGNOSTIC_FAILED') process.exitCode=1;
} catch {
  process.stdout.write('R1_STAGING_DURABLE=READ_FAILED\n');
  process.exitCode=1;
} finally {
  try { driver?.close(); } catch { process.exitCode=1; }
}
