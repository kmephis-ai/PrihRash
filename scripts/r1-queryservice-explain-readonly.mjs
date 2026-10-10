// Manual, explicitly gated EXPLAIN-only entrypoint. No IAM grant, bootstrap or row reads.
// Credential/environment injection and mandatory ACL retirement belong to the Owner
// approved outer operation; this script never creates, changes, or revokes access rights.
import { isExactYdbEndpoint } from './r1-direct-ydb-endpoint.mjs';
import { createDurableSyntheticExplainStatements, createDurableTypedParameterMapper }
  from './r1-durable-revision-guard.mjs';
import { explainWithSession, ExplainProofError } from './r1-queryservice-explain-proof.mjs';

const uri=process.env.PRIHRASH_YDB_CONNECTION_STRING;
const path=process.env.PRIHRASH_R1_EXPECTED_DATABASE_PATH;
const token=process.env.PRIHRASH_R1_YDB_IAM_TOKEN;
if (process.env.PRIHRASH_R1_EXPLAIN_ONE_SHOT!=='EXPLICIT_OWNER_AUTHORITY'
  || !uri || !path || !token || !isExactYdbEndpoint(uri,path)) {
  process.stdout.write('R1_EXPLAIN=CONFIG_INVALID\n');
  process.exit(2);
}
let driver;
try {
  const [{Driver},{AccessTokenCredentialsProvider},{QueryServiceDefinition}] = await Promise.all([
    import('@ydbjs/core'), import('@ydbjs/auth/access-token'), import('@ydbjs/api/query'),
  ]);
  const mapParameter=await createDurableTypedParameterMapper();
  const statements=await createDurableSyntheticExplainStatements();
  if(statements.length!==2) throw new ExplainProofError('INVALID_EXPLAIN_REQUEST');
  driver=new Driver(uri,{credentialsProvider:new AccessTokenCredentialsProvider({token})});
  await driver.ready(AbortSignal.timeout(12000));
  const client=driver.createClient(QueryServiceDefinition);
  for(const [idx,statement] of statements.entries()) {
    const kind=idx===0?'COUNT':'BY_KEY';
    const verdict=await explainWithSession({client,statement,mapParameter,signal:AbortSignal.timeout(30000)});
    process.stdout.write(`R1_EXPLAIN_${kind}=${verdict}\n`);
    // Unclassified/scan is terminal: no second request; no implicit approval to
    // execute durable reads or increase limits based solely on a compiled plan.
    const expected=idx===0?'COUNT_INDEX_READ_OBSERVED':'BY_KEY_POINT_LOOKUP_OBSERVED';
    if(verdict!==expected){
      process.exitCode=1;
      break;
    }
  }
} catch(error) {
  const allowed=new Set([
    'INVALID_EXPLAIN_REQUEST','INVALID_TYPED_PARAMETERS','CLIENT_UNAVAILABLE','SESSION_UNAVAILABLE',
    'STREAM_UNAVAILABLE','STREAM_UNBOUNDED','EXPLAIN_REJECTED','EXPLAIN_UNEXPECTED_RESULTS',
    'EXPLAIN_AMBIGUOUS_PLAN','PLAN_NOT_PROVIDED','SESSION_RETIREMENT_UNPROVEN',
    'EXPLAIN_TRANSPORT_UNPROVEN',
  ]);
  const code=error instanceof ExplainProofError && allowed.has(error.message)
    ?error.message:'PROVIDER_OR_SDK_UNPROVEN';
  process.stdout.write(`R1_EXPLAIN=${code}\n`);
  process.exitCode=1;
} finally {
  try {driver?.close();}catch{process.exitCode=1;}
}
