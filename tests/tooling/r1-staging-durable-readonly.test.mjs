import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { classifyDurableRead, classifyDurableOutcome, createDurableTypedParameterMapper }
  from '../../scripts/r1-durable-revision-guard.mjs';
import {
  diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys,
  INITIAL_STAGING_INDEXED_KEY_READ_LIMIT,
  INITIAL_STAGING_INDEXED_KEY_BATCH_SIZE,
} from '../../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

const RUN='00000000-0000-0000-0000-000000000001';
const OTHER='00000000-0000-0000-0000-000000000002';
const id=i=>'00000000-0000-0000-0000-'+String(i+100).padStart(12,'0');
function entry(i, run=RUN) {
  return {source_record_id:id(i),revision:1n,migration_run_id:run,
    row_hint:BigInt(i+2),row_digest:'synthetic-'+i};
}
function makeHarness(count, setup={}) {
  const seen=[];
  const bindings=Array.from({length:count},(_,i)=>({
    source_ordinal:i,row_hint:i+2,row_digest:'synthetic-'+i,
    source_record_id:id(i),transaction_id:null}));
  const rows=new Map(Array.from({length:count},(_,i)=>[id(i),entry(i)]));
  for(const k of setup.omit??[])rows.delete(id(k));
  for(const k of setup.foreign??[])rows.set(id(k),entry(k,OTHER));
  for(const k of setup.corrupt??[])rows.set(id(k),{...entry(k),row_digest:'invalid'});
  const data={migration_run_id:RUN,run_state:'STAGING',run_snapshot_digest:'synthetic-run',
    rows_seen:BigInt(count),manifest_snapshot_digest:'synthetic-run',
    binding_count:BigInt(count),bindings:{schema_version:1,bindings},
    snapshot_digest:'synthetic-run',snapshot_row_count:BigInt(count),
    snapshot_captured_at:'2026-10-01T00:00:00Z'};
  return {seen,read:async stmt=>{
    const shape=classifyDurableRead(stmt);
    assert.ok(shape,'canonical SQL shape must be exact, safe and allowlisted');
    seen.push(shape.kind);
    if(shape.kind==='MANIFEST')return {rows:[data]};
    if(shape.kind==='COUNT')return {rows:[{run_revision_count:BigInt(
      setup.countOverride??[...rows.values()].filter(x=>x.migration_run_id===RUN).length)}]};
    assert.equal(shape.kind,'BY_KEY');
    const keys=stmt.parameters.source_keys.value.rows.map(r=>r.source_record_id.value);
    assert.ok(keys.length<=INITIAL_STAGING_INDEXED_KEY_BATCH_SIZE);
    const selected=keys.map(key=>rows.get(key)).filter(Boolean);
    if(setup.duplicate && seen.filter(s=>s==='BY_KEY').length===1)selected.push(selected[0]);
    return {rows:selected};
  }};
}
test('large synthetic STAGING proof completes by bounded primary-key lookup, not full scan',async()=>{
  const h=makeHarness(6200);
  assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(h),
    'COMPLETE_CURRENT_RUN_ONLY');
  assert.deepEqual(h.seen.slice(0,2),['MANIFEST','COUNT']);
  assert.equal(h.seen.filter(x=>x==='BY_KEY').length,Math.ceil(6200/128));
  assert.ok(!h.seen.includes('BY_RUN'));
});
test('durable proof stays fail-closed for empty, suffix gaps, holes, foreign and mismatch',async()=>{
  const checks=[
    [makeHarness(0),'NO_REVISION_EVIDENCE'],
    [makeHarness(4,{omit:[2,3]}),'PARTIAL_CURRENT_RUN_ONLY'],
    [makeHarness(4,{omit:[1]}),'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH'],
    [makeHarness(4,{foreign:[2]}),'CROSS_RUN_PK_COLLISION'],
    [makeHarness(4,{corrupt:[1]}),'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH'],
    [makeHarness(4,{countOverride:5}),'REVISION_ROW_UNEXPECTED_SOURCE'],
    [makeHarness(4,{duplicate:true}),'REVISION_ROW_DUPLICATE'],
  ];
  for(const [h,expected] of checks){
    assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(h),expected);
  }
});
test('reader rejects malformed run count and bounds manifest before scanning any revisions',async()=>{
  const tooLarge=makeHarness(INITIAL_STAGING_INDEXED_KEY_READ_LIMIT+1);
  assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(tooLarge),
    'READ_BUDGET_NOT_PROVEN');
  assert.deepEqual(tooLarge.seen,['MANIFEST']);
  const malformed=makeHarness(2);
  const read=malformed.read;
  malformed.read=async stmt=>(classifyDurableRead(stmt)?.kind==='COUNT'
    ? {rows:[{run_revision_count:'not-a-number'}]} : read(stmt));
  assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(malformed),
    'REVISION_EVIDENCE_DIAGNOSTIC_FAILED');
  const highCount=makeHarness(2,{countOverride:INITIAL_STAGING_INDEXED_KEY_READ_LIMIT+1});
  assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(highCount),
    'READ_BUDGET_NOT_PROVEN');
  assert.deepEqual(highCount.seen,['MANIFEST','COUNT']);
});
test('SQL allowlist rejects mutation, root scan, oversize key batches, wrong parameter types',async()=>{
  const readOnly=makeHarness(1);
  await diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys(readOnly);
  const stmt={
    kind:'READ',text:'SELECT * FROM source_record_revisions',parameters:{},
  };
  assert.equal(classifyDurableRead(stmt),null);
  assert.equal(classifyDurableRead({kind:'WRITE',text:'DELETE FROM transactions',parameters:{}}),null);
  assert.equal(classifyDurableRead({kind:'READ',text:'SELECT 1',parameters:{}}),null);
  assert.equal(classifyDurableOutcome('COMMITTED'),'EVIDENCE_INVALID');
  assert.equal(classifyDurableOutcome('COMPLETE_CURRENT_RUN_ONLY'),'COMPLETE_CURRENT_RUN_ONLY');
  assert.equal(classifyDurableOutcome('READ_BUDGET_NOT_PROVEN'),'READ_BUDGET_NOT_PROVEN');
});
test('real locked YDB v6 submodules supply typed primitive and list struct constructors',async()=>{
  const [{uuidParameter,uint64Parameter,listStructParameter},root]=await Promise.all([
    import('../../dist/integration/ydb/parameters.js'),import('@ydbjs/value')]);
  assert.equal(root.Optional,undefined);
  const map=await createDurableTypedParameterMapper();
  assert.ok(map(uuidParameter(RUN)));
  assert.ok(map(uint64Parameter(1n)));
  assert.ok(map(listStructParameter([{name:'source_record_id',type:'Uuid',nullable:false}],
    [{source_record_id:uuidParameter(RUN)}])));
});
test('manual workflow rejects unattended execution, unbounded RU or private logs',()=>{
  const runner=readFileSync('scripts/r1-direct-staging-durable-readonly.mjs','utf8');
  const workflow=readFileSync('.github/workflows/r1-direct-ydb-readonly.yml','utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/durable_only:/);
  assert.match(workflow,/timeout-minutes: 30/);
  assert.match(workflow,/MODE_CONFLICT/);
  assert.match(runner,/snapshotReadOnly/);
  assert.match(runner,/StatsMode\.FULL/);
  assert.match(runner,/estimateYdbYqlReadRequestUnits/);
  assert.match(runner,/estimatedRu>11000/);
  assert.match(runner,/reads>73/);
  assert.match(runner,/diagnoseInitialBootstrapStagingDurableRevisionEvidenceByKeys/);
  assert.doesNotMatch(runner,/diagnoseInitialBootstrapStagingRevisionCardinality/);
  assert.doesNotMatch(runner,/console\.log|JSON\.stringify|\.message/);
  assert.doesNotMatch(runner,/\b(?:INSERT|UPSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+(?:INTO|TABLE|FROM|migration_runs)/i);
});
test('no credentials cannot reach the YDB network',()=>{
  const x=spawnSync(process.execPath,['scripts/r1-direct-staging-durable-readonly.mjs'],{
    encoding:'utf8',timeout:6000,
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},
  });
  assert.equal(x.status,2,x.stderr);
  assert.equal(x.stdout,'R1_STAGING_DURABLE=CONFIG_INVALID\n');
});
