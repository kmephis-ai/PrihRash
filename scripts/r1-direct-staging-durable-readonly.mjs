// R1 manual-only readback of durable STAGING revision identity evidence.
// NEVER output source IDs, financial records, precise counts, digests, raw SDK errors or SQL results.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';
import { StatsMode } from '@ydbjs/api/query';
import { estimateYdbYqlReadRequestUnits } from '../dist/integration/ydb/ydbJsV6DataTransport.js';
import { classifyDurableRead, classifyDurableOutcome, createDurableTypedParameterMapper } from './r1-durable-revision-guard.mjs';
import {
  diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys,
} from '../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

const uri=process.env.PRIHRASH_YDB_CONNECTION_STRING;
const token=process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
const path=process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
if (!uri || !token || !path || !isExactYdbEndpoint(uri,path)) {
  process.stdout.write('R1_STAGING_DURABLE=CONFIG_INVALID\n');
  process.exit(2);
}

class ReadBudgetExceeded extends Error {}
let driver;
try {
  const [{ Driver }, { AccessTokenCredentialsProvider }, { query }] = await Promise.all([
    import('@ydbjs/core'),
    import('@ydbjs/auth/access-token'),
    import('@ydbjs/query'),
  ]);
  const mapParameter=await createDurableTypedParameterMapper();
  driver=new Driver(uri,{credentialsProvider:new AccessTokenCredentialsProvider({token})});
  await driver.ready(AbortSignal.timeout(12000));
  const sql=query(driver,{poolOptions:{maxSize:1}});
  // No transactions with write capability. All reads share a single consistent snapshot.
  const verdict=await sql.transaction({isolation:'snapshotReadOnly',idempotent:true},
    async tx => {
      let reads=0;
      let estimatedRu=0;
      const readScope=Object.freeze({
        read:async statement => {
          const shape=classifyDurableRead(statement);
          if (!shape || ++reads>73) throw new ReadBudgetExceeded();
          // Only exact indexed run count and at most 128 manifest PK lookups per read.
          let request=tx(shape.sql).timeout(shape.kind==='COUNT' ? 300000 : 30000);
          for (const [name,param] of Object.entries(statement.parameters)) {
            request=request.parameter(name,mapParameter(param));
          }
          if (typeof request.withStats!=='function') throw new ReadBudgetExceeded();
          request=request.withStats(StatsMode.FULL);
          const sets=await request;
          if (!Array.isArray(sets)||sets.length!==1||!Array.isArray(sets[0])
              || sets[0].length>shape.cap) throw new Error('READBACK_LIMIT_OR_SHAPE_INVALID');
          const charge=typeof request.stats==='function'
            ? estimateYdbYqlReadRequestUnits(request.stats()) : null;
          if (charge===null || !Number.isSafeInteger(charge) || charge<0) throw new ReadBudgetExceeded();
          estimatedRu+=charge;
          if(estimatedRu>11000) throw new ReadBudgetExceeded();
          return Object.freeze({rows:Object.freeze([...sets[0]])});
        },
      });
      // All private evidence stays inside one snapshot. RU is estimated per SDK stats,
      // never logged, and exceeding the bound stops before the next read.
      return classifyDurableOutcome(
        await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(readScope));
    });
  process.stdout.write(`R1_STAGING_DURABLE=${verdict}\n`);
  if (verdict==='EVIDENCE_INVALID'||verdict==='READ_BUDGET_NOT_PROVEN'||verdict==='REVISION_EVIDENCE_DIAGNOSTIC_FAILED') process.exitCode=1;
} catch (error) {
  process.stdout.write(error instanceof ReadBudgetExceeded
    ? 'R1_STAGING_DURABLE=READ_BUDGET_NOT_PROVEN\n'
    : 'R1_STAGING_DURABLE=READ_FAILED\n');
  process.exitCode=1;
} finally {
  try { driver?.close(); } catch { process.exitCode=1; }
}
