import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { classifyDurableRead, classifyDurableOutcome } from '../../scripts/r1-durable-revision-guard.mjs';
import { diagnoseInitialBootstrapStagingRevisionCardinality, diagnoseInitialBootstrapStagingDurableRevisionEvidence }
  from '../../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

const run='00000000-0000-0000-0000-000000000001';
const source='00000000-0000-0000-0000-000000000002';
const evidence={source_record_id:source,revision:1n,migration_run_id:run,row_hint:2n,row_digest:'synthetic-digest'};
function reader(revisions){
  const observed=[];
  const bindings={schema_version:1,bindings:[{source_ordinal:0,row_hint:2,
    row_digest:'synthetic-digest',source_record_id:source,transaction_id:null}]};
  return {observed,read:async statement=>{
    const shape=classifyDurableRead(statement);
    assert.ok(shape,'unexpected canonical query shape');
    observed.push(shape.kind);
    if(shape.kind==='CARDINALITY') return {rows:[{
      run_state:'STAGING',rows_seen:1n,binding_count:1n,snapshot_row_count:1n}]};
    if(shape.kind==='MANIFEST') return {rows:[{
      migration_run_id:run,run_state:'STAGING',run_snapshot_digest:'synthetic',
      rows_seen:1n,manifest_snapshot_digest:'synthetic',binding_count:1n,
      bindings,snapshot_digest:'synthetic',snapshot_row_count:1n,
      snapshot_captured_at:'2026-10-01T00:00:00Z'}]};
    if(shape.kind==='BY_RUN') return {rows:revisions};
    return {rows:[]};
  }};
}
test('canonical durable evidence: none, complete, wrong-run',async()=>{
  const none=reader([]);assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidence(none),
    'NO_REVISION_EVIDENCE');assert.deepEqual(none.observed,['MANIFEST','BY_RUN','BY_KEY']);
  const full=reader([evidence]);
  assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidence(full),
    'COMPLETE_CURRENT_RUN_ONLY');assert.deepEqual(full.observed,['MANIFEST','BY_RUN']);
  const clash=reader([{...evidence,migration_run_id:'00000000-0000-0000-0000-000000000003'}]);
  assert.equal(await diagnoseInitialBootstrapStagingDurableRevisionEvidence(clash),
    'CROSS_RUN_PK_COLLISION');
});
test('canonical read-cost preflight is structural and stays private',async()=>{
  const x=reader([]);assert.equal(await diagnoseInitialBootstrapStagingRevisionCardinality(x),'LT_5000_RU');
  assert.deepEqual(x.observed,['CARDINALITY']);
});
test('unknown SQL, unexpected arguments and outcomes fail closed',()=>{
  for(const shape of [null,{kind:'WRITE',text:'SELECT 1',parameters:{}},
    {kind:'READ',text:'SELECT 1',parameters:{}},{kind:'READ',text:'SELECT 1'},
    {kind:'READ',text:'SELECT 1; DELETE FROM transactions',parameters:{}}]){
    assert.equal(classifyDurableRead(shape),null);
  }
  assert.equal(classifyDurableOutcome('COMPLETE_CURRENT_RUN_ONLY'),'COMPLETE_CURRENT_RUN_ONLY');
  assert.equal(classifyDurableOutcome('COMMITTED'),'EVIDENCE_INVALID');
});
test('no credentials never reaches the network',()=>{
  const x=spawnSync(process.execPath,['scripts/r1-direct-staging-durable-readonly.mjs'],{
    encoding:'utf8',timeout:6000,
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},
  });
  assert.equal(x.status,2,x.stderr);
  assert.equal(x.stdout,'R1_STAGING_DURABLE=CONFIG_INVALID\n');
});
test('manual SDK mode stays bounded, read-only, enum-only',()=>{
  const flow=readFileSync('.github/workflows/r1-direct-ydb-readonly.yml','utf8');
  const script=readFileSync('scripts/r1-direct-staging-durable-readonly.mjs','utf8');
  assert.match(flow,/durable_only:/);
  assert.match(flow,/node scripts\/r1-direct-staging-durable-readonly.mjs/);
  assert.match(flow,/r1-staging-durable-readonly\.test\.mjs/);
  assert.match(flow,/MODE_CONFLICT/);
  assert.match(script,/snapshotReadOnly/);
  assert.match(script,/diagnoseInitialBootstrapStagingDurableRevisionEvidence/);
  assert.match(script,/READ_BUDGET_NOT_PROVEN/);
  assert.doesNotMatch(script,/\b(?:INSERT|UPSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+(?:INTO|TABLE|FROM|migration_runs)/i);
  assert.doesNotMatch(script,/console\.log|JSON\.stringify|\.message/);
});

test('real locked YDB v6 submodules supply canonical typed parameter constructors', async () => {
  const [
    { createDurableTypedParameterMapper },
    { uuidParameter, uint64Parameter, listStructParameter },
    root,
  ] = await Promise.all([
    import('../../scripts/r1-durable-revision-guard.mjs'),
    import('../../dist/integration/ydb/parameters.js'),
    import('@ydbjs/value'),
  ]);
  // Regression: the package root is NOT an SDK constructor namespace.
  assert.equal(root.Optional, undefined);
  const map = await createDurableTypedParameterMapper();
  const id = '00000000-0000-0000-0000-000000000011';
  assert.ok(map(uuidParameter(id)));
  assert.ok(map(uint64Parameter(1n)));
  assert.ok(map(listStructParameter([
    { name: 'source_record_id', type: 'Uuid', nullable: false },
  ], [{ source_record_id: uuidParameter(id) }])));
});

test('runner uses tested SDK mapper, not constructor-less @ydbjs/value root', () => {
  const source = readFileSync('scripts/r1-direct-staging-durable-readonly.mjs', 'utf8');
  assert.match(source, /await createDurableTypedParameterMapper\(\)/);
  assert.doesNotMatch(source, /import\(['"]@ydbjs\/value['"]\)/);
});
