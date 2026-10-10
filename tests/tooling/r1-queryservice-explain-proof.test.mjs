import test from 'node:test';
import assert from 'node:assert/strict';
import { toBinary, fromBinary, create } from '@bufbuild/protobuf';
import { spawnSync } from 'node:child_process';
import { ExecMode, ExecuteQueryRequestSchema } from '@ydbjs/api/query';
import { StatusIds_StatusCode } from '@ydbjs/api/operation';
import { uuidParameter, uint64Parameter, listStructParameter } from '../../dist/integration/ydb/parameters.js';
import { classifyDurableRead, createDurableTypedParameterMapper } from '../../scripts/r1-durable-revision-guard.mjs';
import {
  ExplainProofError, makeExplainOnlyRequest, classifyPhysicalExplainPlan, explainWithSession,
} from '../../scripts/r1-queryservice-explain-proof.mjs';

const RUN='00000000-0000-0000-0000-000000000001';
const countSql='SELECT COUNT(*) AS run_revision_count '
  +'FROM source_record_revisions VIEW idx_source_record_revisions_run_revision '
  +'WHERE revision = $revision AND migration_run_id = $migration_run_id';
const byKeySql='SELECT r.source_record_id, r.revision, r.migration_run_id, r.row_hint, '
  +'CAST(r.row_digest AS Utf8) AS row_digest FROM source_record_revisions AS r '
  +'INNER JOIN AS_TABLE($source_keys) AS k ON r.source_record_id = k.source_record_id '
  +'WHERE r.revision = $revision';
const count=()=>({kind:'READ',text:countSql,parameters:{
  revision:uint64Parameter(1),migration_run_id:uuidParameter(RUN),
}});
const byKey=(n=128)=>({kind:'READ',text:byKeySql,parameters:{
  revision:uint64Parameter(1),
  source_keys:listStructParameter([{name:'source_record_id',type:'Uuid',nullable:false}],
    Array.from({length:n},(_,i)=>({source_record_id:uuidParameter(
      '00000000-0000-0000-0000-'+String(i+100).padStart(12,'0'))}))),
}});
const INDEX='/location/source_record_revisions/idx_source_record_revisions_run_revision/indexImplTable';
const BASE='/location/source_record_revisions';
const plan=(operators)=>JSON.stringify({Plan:{Plans:[{Operators:operators}]}});
const indexed=plan([{Name:'TableRangeScan',Table:INDEX}]);
const points=plan([{Name:'TablePointLookup',Table:BASE}]);
const good=(data)=>({status:StatusIds_StatusCode.SUCCESS,...data});
function mock({answer=good({execStats:{queryPlan:indexed}}),createResponse=good({sessionId:'test-session'}),
  deleteResponse=good({}),throwStream=false}={}){
  const seen=[];
  return {seen,client:{
    async createSession(){seen.push('create');return createResponse;},
    executeQuery(request){
      seen.push('explain');
      assert.equal(request.execMode,ExecMode.EXPLAIN);
      assert.equal(request.txControl,undefined);
      assert.equal(request.query.case,'queryContent');
      return (async function*(){if(throwStream)throw Error('SENSITIVE_PROVIDER_ERROR');
        for(const part of Array.isArray(answer)?answer:[answer])yield part;
      })();
    },
    async deleteSession(request){seen.push('delete');assert.equal(request.sessionId,'test-session');return deleteResponse;},
  }};
}
let mapParameter;
test.before(async()=>{mapParameter=await createDurableTypedParameterMapper();});

test('locked SDK typed COUNT and 128-key BY_KEY requests serialize without EXECUTE',()=>{
  for(const stmt of [count(),byKey()]){
    const kind=classifyDurableRead(stmt)?.kind;
    assert.ok(kind==='COUNT'||kind==='BY_KEY');
    const req=makeExplainOnlyRequest(stmt,mapParameter,'test-session');
    assert.equal(req.execMode,ExecMode.EXPLAIN);
    assert.equal(req.txControl,undefined);
    const wire=toBinary(ExecuteQueryRequestSchema,create(ExecuteQueryRequestSchema,req));
    const decoded=fromBinary(ExecuteQueryRequestSchema,wire);
    assert.equal(decoded.execMode,ExecMode.EXPLAIN);
    assert.equal(decoded.query.value.text,stmt.text);
    assert.deepEqual(Object.keys(decoded.parameters).sort(),Object.keys(stmt.parameters).map(x=>'$'+x).sort());
  }
});
test('refuse arbitrary SQL or dangerous parameter substitution before session',async()=>{
  const h=mock();
  await assert.rejects(()=>explainWithSession({client:h.client,statement:{
    ...count(),text:'DELETE FROM source_record_revisions',parameters:{},
  },mapParameter}),{message:'INVALID_EXPLAIN_REQUEST'});
  assert.deepEqual(h.seen,[]);
  assert.throws(()=>makeExplainOnlyRequest(count(),mapParameter,''),{message:'INVALID_EXPLAIN_REQUEST'});
  assert.throws(()=>makeExplainOnlyRequest(byKey(129),mapParameter,'session'),{message:'INVALID_EXPLAIN_REQUEST'});
});
test('one session, one streamed explain, mandatory delete, no execution fallback',async()=>{
  const h=mock();
  const result=await explainWithSession({client:h.client,statement:count(),mapParameter});
  assert.equal(result,'COUNT_INDEX_READ_OBSERVED');
  assert.deepEqual(h.seen,['create','explain','delete']);
});
test('BY_KEY point lookup classified only for bounded exact table',async()=>{
  const h=mock({answer:good({execStats:{queryPlan:points}})});
  assert.equal(await explainWithSession({client:h.client,statement:byKey(),mapParameter}),
    'BY_KEY_POINT_LOOKUP_OBSERVED');
  assert.deepEqual(h.seen,['create','explain','delete']);
});
test('full scans beat positive hints, unknown formats remain unclassified',()=>{
  assert.equal(classifyPhysicalExplainPlan(plan([
    {Name:'TablePointLookup',Table:BASE},{Name:'TableFullScan',Table:'private'}]),'BY_KEY'),
    'FULL_SCAN_OBSERVED');
  assert.equal(classifyPhysicalExplainPlan(plan([{Name:'TableRangeScan',Table:BASE}]),'COUNT'),
    'PLAN_UNCLASSIFIED');
  assert.equal(classifyPhysicalExplainPlan(plan([
    {Name:'TablePointLookup',Table:INDEX},{Name:'TableRangeScan',Table:BASE}]),'COUNT'),
    'PLAN_UNCLASSIFIED');
  assert.equal(classifyPhysicalExplainPlan(plan([{Name:'TablePointLookup',Table:BASE}]),'BY_KEY'),
    'BY_KEY_POINT_LOOKUP_OBSERVED');
  assert.equal(classifyPhysicalExplainPlan(JSON.stringify({sql:'TablePointLookup'}),'COUNT'),
    'PLAN_UNCLASSIFIED');
  assert.equal(classifyPhysicalExplainPlan('not-json','COUNT'),'PLAN_UNCLASSIFIED');
  assert.equal(classifyPhysicalExplainPlan('x'.repeat(260000),'COUNT'),'PLAN_UNCLASSIFIED');
});
test('missing session does not execute or attempt uninformed delete',async()=>{
  const h=mock({createResponse:good({sessionId:''})});
  await assert.rejects(()=>explainWithSession({client:h.client,statement:count(),mapParameter}),
    {message:'SESSION_UNAVAILABLE'});
  assert.deepEqual(h.seen,['create']);
});
test('server failure, transport errors and result rows are fail-closed and retire session',async()=>{
  for(const entry of [
    {answer:{status:StatusIds_StatusCode.BAD_REQUEST},error:'EXPLAIN_REJECTED'},
    {throwStream:true,error:'EXPLAIN_TRANSPORT_UNPROVEN'},
    {answer:good({resultSet:{rows:[{}]}}),error:'EXPLAIN_UNEXPECTED_RESULTS'},
    {answer:good({txMeta:{}}),error:'EXPLAIN_UNEXPECTED_RESULTS'},
    {answer:good({}),error:'PLAN_NOT_PROVIDED'},
  ]){
    const h=mock(entry);
    await assert.rejects(()=>explainWithSession({client:h.client,statement:count(),mapParameter}),
      {message:entry.error});
    assert.deepEqual(h.seen,['create','explain','delete']);
  }
});
test('duplicate or oversized plans reject and session is always retired',async()=>{
  const h=mock({answer:[good({execStats:{queryPlan:indexed}}),
    good({execStats:{queryPlan:indexed}})]});
  await assert.rejects(()=>explainWithSession({client:h.client,statement:count(),mapParameter}),
    {message:'EXPLAIN_AMBIGUOUS_PLAN'});
  assert.deepEqual(h.seen,['create','explain','delete']);
});
test('failed session retirement overrides any optimistic plan classification',async()=>{
  const h=mock({deleteResponse:{status:StatusIds_StatusCode.BAD_REQUEST}});
  await assert.rejects(()=>explainWithSession({client:h.client,statement:count(),mapParameter}),
    {message:'SESSION_RETIREMENT_UNPROVEN'});
  assert.deepEqual(h.seen,['create','explain','delete']);
});
test('raw provider failure text cannot escape the error boundary',async()=>{
  const h=mock({throwStream:true});
  try {
    await explainWithSession({client:h.client,statement:count(),mapParameter});
    assert.fail('expected to reject');
  }catch(error){
    assert.ok(error instanceof ExplainProofError);
    assert.equal(error.message,'EXPLAIN_TRANSPORT_UNPROVEN');
    assert.ok(!String(error.stack).includes('SENSITIVE_PROVIDER_ERROR'));
  }
});

test('synthetic EXPLAIN statements derive exact guarded SQL, never private source IDs',async()=>{
  const {createDurableSyntheticExplainStatements}=await import('../../scripts/r1-durable-revision-guard.mjs');
  const statements=await createDurableSyntheticExplainStatements();
  assert.deepEqual(statements.map(s=>classifyDurableRead(s)?.kind),['COUNT','BY_KEY']);
  assert.equal(statements[0].parameters.migration_run_id.value,'00000000-0000-0000-0000-000000000100');
  assert.equal(statements[1].parameters.source_keys.value.rows.length,128);
});
test('manual-only runner without new Owner gate rejects before any network/client creation',()=>{
  const env={...process.env};
  for(const name of [
    'PRIHRASH_R1_EXPLAIN_ONE_SHOT','PRIHRASH_YDB_CONNECTION_STRING',
    'PRIHRASH_R1_EXPECTED_DATABASE_PATH','PRIHRASH_R1_YDB_IAM_TOKEN'])delete env[name];
  const res=spawnSync(process.execPath,['scripts/r1-queryservice-explain-readonly.mjs'],{
    cwd:process.cwd(),env,encoding:'utf8',timeout:8000,
  });
  assert.equal(res.status,2);
  assert.equal(res.stdout,'R1_EXPLAIN=CONFIG_INVALID\n');
  assert.equal(res.stderr,'');
});
test('all EXPLAIN runner imports are inert when gate is missing',()=>{
  const env={...process.env,PRIHRASH_R1_EXPLAIN_ONE_SHOT:'EXPLICIT_OWNER_AUTHORITY'};
  for(const name of ['PRIHRASH_YDB_CONNECTION_STRING',
    'PRIHRASH_R1_EXPECTED_DATABASE_PATH','PRIHRASH_R1_YDB_IAM_TOKEN'])delete env[name];
  const res=spawnSync(process.execPath,['scripts/r1-queryservice-explain-readonly.mjs'],{
    cwd:process.cwd(),env,encoding:'utf8',timeout:8000,
  });
  assert.equal(res.status,2);
  assert.equal(res.stdout,'R1_EXPLAIN=CONFIG_INVALID\n');
  assert.equal(res.stderr,'');
});
