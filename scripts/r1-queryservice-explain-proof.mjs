// R1-only offline-testable QueryService EXPLAIN boundary. No financial query executes here.
// This module never emits raw plan, SQL parameters, identifiers, provider errors or statistics.
import { create } from '@bufbuild/protobuf';
import { ExecMode, StatsMode, Syntax } from '@ydbjs/api/query';
import { StatusIds_StatusCode } from '@ydbjs/api/operation';
import { TypedValueSchema } from '@ydbjs/api/value';
import { classifyDurableRead } from './r1-durable-revision-guard.mjs';

export class ExplainProofError extends Error {
  constructor(code) { super(code); this.name='ExplainProofError'; }
}
function stop(code) { throw new ExplainProofError(code); }
const MAX_PLAN_BYTES=250_000;
const ALLOWED_KINDS=new Set(['COUNT','BY_KEY']);

export function makeExplainOnlyRequest(statement, mapParameter, sessionId) {
  const shape=classifyDurableRead(statement);
  if (!shape || !ALLOWED_KINDS.has(shape.kind) || typeof sessionId!=='string'
      || !sessionId || typeof mapParameter!=='function') stop('INVALID_EXPLAIN_REQUEST');
  const parameters={};
  try {
    for(const [key,parameter] of Object.entries(statement.parameters)){
      const value=mapParameter(parameter);
      parameters['$'+key]=create(TypedValueSchema,{
        type:value.type.encode(), value:value.encode(),
      });
    }
  } catch { stop('INVALID_TYPED_PARAMETERS'); }
  return Object.freeze({
    sessionId, execMode:ExecMode.EXPLAIN,
    query:{case:'queryContent',value:{syntax:Syntax.YQL_V1,text:shape.sql}},
    parameters, statsMode:StatsMode.FULL,
    // Critical: no txControl, no commit, no EXECUTE/ANALYZE fallback.
  });
}

function collectOperations(node,out,depth=0) {
  if (depth>40 || out.length>1000) stop('PLAN_UNUSABLE');
  if (Array.isArray(node)) {
    for (const item of node) collectOperations(item,out,depth+1);
    return;
  }
  if (!node || typeof node!=='object') return;
  // Only explicit plan operators qualify; never infer physical proof from raw SQL text.
  if (typeof node.Name==='string' && (typeof node.Table==='string'
      || ['TableFullScan','TableRangeScan','TablePointLookup'].includes(node.Name))) {
    out.push({name:node.Name,table:typeof node.Table==='string'?node.Table:''});
  }
  for(const [key,value] of Object.entries(node)) {
    if (key==='Operators' || key==='Plans' || key==='Plan' || key==='Stages'
        || key==='Children' || key==='Inputs') collectOperations(value,out,depth+1);
  }
}
export function classifyPhysicalExplainPlan(plan,kind){
  if(!ALLOWED_KINDS.has(kind) || typeof plan!=='string'
      || plan.length<2 || Buffer.byteLength(plan,'utf8')>MAX_PLAN_BYTES) return 'PLAN_UNCLASSIFIED';
  let parsed;
  try { parsed=JSON.parse(plan); } catch { return 'PLAN_UNCLASSIFIED'; }
  const ops=[];
  try { collectOperations(parsed,ops); } catch { return 'PLAN_UNCLASSIFIED'; }
  if(ops.length===0) return 'PLAN_UNCLASSIFIED';
  if(ops.some(x=>x.name==='TableFullScan')) return 'FULL_SCAN_OBSERVED';
  if(kind==='COUNT'){
    // Secondary-index VIEW must resolve to the index implementation table.
    // An additional unexpected read prevents optimistic index-only claims.
    const index='/idx_source_record_revisions_run_revision/indexImplTable';
    const accesses=ops.filter(x=>['TablePointLookup','TableRangeScan'].includes(x.name));
    const indexReads=accesses.filter(x=>x.table.includes(index));
    const otherRange=accesses.some(x=>x.name==='TableRangeScan' && !x.table.includes(index));
    return indexReads.length>0 && !otherRange
      ?'COUNT_INDEX_READ_OBSERVED':'PLAN_UNCLASSIFIED';
  }
  // A BY_KEY join can have multiple accesses. Reject if any scan appears.
  if(ops.some(x=>x.name==='TableRangeScan')) return 'PLAN_UNCLASSIFIED';
  return ops.some(x=>x.name==='TablePointLookup'
    && (x.table==='source_record_revisions' || x.table.endsWith('/source_record_revisions')))
    ? 'BY_KEY_POINT_LOOKUP_OBSERVED':'PLAN_UNCLASSIFIED';
}

export async function explainWithSession({client,statement,mapParameter,signal}) {
  const shape=classifyDurableRead(statement);
  if(!shape || !ALLOWED_KINDS.has(shape.kind)) stop('INVALID_EXPLAIN_REQUEST');
  if (!client || typeof client.createSession!=='function'
      || typeof client.executeQuery!=='function' || typeof client.deleteSession!=='function')
    stop('CLIENT_UNAVAILABLE');
  let sessionId='';
  let result, failure;
  try {
    const created=await client.createSession({}, {signal});
    if (created?.status!==StatusIds_StatusCode.SUCCESS
        || typeof created.sessionId!=='string'||!created.sessionId) stop('SESSION_UNAVAILABLE');
    sessionId=created.sessionId;
    const request=makeExplainOnlyRequest(statement,mapParameter,sessionId);
    let parts=0, rawPlan=null;
    const stream=client.executeQuery(request,{signal});
    if(!stream || typeof stream[Symbol.asyncIterator]!=='function') stop('STREAM_UNAVAILABLE');
    for await (const part of stream) {
      if(++parts>8) stop('STREAM_UNBOUNDED');
      if(part?.status!==StatusIds_StatusCode.SUCCESS) stop('EXPLAIN_REJECTED');
      if(part.resultSet || part.txMeta) stop('EXPLAIN_UNEXPECTED_RESULTS');
      if(part.execStats?.queryPlan) {
        if(rawPlan!==null) stop('EXPLAIN_AMBIGUOUS_PLAN');
        rawPlan=part.execStats.queryPlan;
      }
    }
    if(parts===0||rawPlan===null) stop('PLAN_NOT_PROVIDED');
    result=classifyPhysicalExplainPlan(rawPlan,shape.kind);
  } catch(error) {
    // No raw external errors cross the boundary.
    failure=error instanceof ExplainProofError?error:new ExplainProofError('EXPLAIN_TRANSPORT_UNPROVEN');
  } finally {
    if(sessionId){
      try{
        const retired=await client.deleteSession({sessionId},{signal});
        if(retired?.status!==StatusIds_StatusCode.SUCCESS) stop('SESSION_RETIREMENT_UNPROVEN');
      } catch{ failure=new ExplainProofError('SESSION_RETIREMENT_UNPROVEN'); }
    }
  }
  if(failure) throw failure;
  return result;
}
