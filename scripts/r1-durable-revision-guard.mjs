// Strict, synthetic-testable allowlist for the existing R1 durable staging reader.
// This is NOT proof of authoritative Google source identity.
const manifest = "SELECT r.id AS migration_run_id, r.state AS run_state, "
  + "CAST(r.source_snapshot_digest AS Utf8) AS run_snapshot_digest, r.rows_seen AS rows_seen, "
  + "CAST(m.source_snapshot_digest AS Utf8) AS manifest_snapshot_digest, "
  + "m.binding_count AS binding_count, m.bindings AS bindings, "
  + "CAST(s.snapshot_digest AS Utf8) AS snapshot_digest, s.row_count AS snapshot_row_count, "
  + "s.captured_at AS snapshot_captured_at "
  + "FROM migration_runs AS r "
  + "JOIN initial_bootstrap_identity_manifests AS m ON m.migration_run_id = r.id "
  + "JOIN source_snapshots AS s ON s.id = m.source_snapshot_id "
  + "WHERE r.state = 'STAGING' LIMIT 2";
const cardinality = "SELECT r.state AS run_state, r.rows_seen AS rows_seen, "
  + "m.binding_count AS binding_count, s.row_count AS snapshot_row_count "
  + "FROM migration_runs AS r "
  + "JOIN initial_bootstrap_identity_manifests AS m ON m.migration_run_id = r.id "
  + "JOIN source_snapshots AS s ON s.id = m.source_snapshot_id "
  + "WHERE r.state = 'STAGING' LIMIT 2";
const byKey = "SELECT r.source_record_id, r.revision, r.migration_run_id, r.row_hint, "
  + "CAST(r.row_digest AS Utf8) AS row_digest "
  + "FROM source_record_revisions AS r "
  + "INNER JOIN AS_TABLE($source_keys) AS k ON r.source_record_id = k.source_record_id "
  + "WHERE r.revision = $revision";
const count = "SELECT COUNT(*) AS run_revision_count "
  + "FROM source_record_revisions VIEW idx_source_record_revisions_run_revision "
  + "WHERE revision = $revision AND migration_run_id = $migration_run_id";
const allowed = Object.freeze({
  MANIFEST: Object.freeze({ sql: manifest, keys: [], cap: 2 }),
  CARDINALITY: Object.freeze({ sql: cardinality, keys: [], cap: 2 }),
  COUNT: Object.freeze({ sql: count, keys: ['migration_run_id', 'revision'], cap: 1 }),
  BY_KEY: Object.freeze({ sql: byKey, keys: ['revision', 'source_keys'], cap: 128 }),
});
export function classifyDurableRead(statement) {
  if (statement?.kind !== 'READ' || typeof statement.text !== 'string'
      || statement.parameters === null || typeof statement.parameters !== 'object' || Array.isArray(statement.parameters)) return null;
  const keys = Object.keys(statement.parameters).sort();
  for (const [kind, shape] of Object.entries(allowed)) {
    if (statement.text !== shape.sql || keys.join(',') !== [...shape.keys].sort().join(',')) continue;
    if (kind === 'COUNT' && (statement.parameters.revision?.type !== 'Uint64'
        || statement.parameters.revision.value !== 1n
        || statement.parameters.migration_run_id?.type !== 'Uuid')) return null;
    if (kind === 'BY_KEY' && (statement.parameters.revision?.type !== 'Uint64'
        || statement.parameters.revision.value !== 1n
        || statement.parameters.source_keys?.type !== 'ListStruct'
        || !Array.isArray(statement.parameters.source_keys.value?.rows)
        || statement.parameters.source_keys.value.rows.length < 1
        || statement.parameters.source_keys.value.rows.length > 128)) return null;
    return Object.freeze({ kind, cap: shape.cap, sql: shape.sql });
  }
  return null;
}
/** Canonical SQL + dummy-only typed parameters for compile-only R1 plan proof. */
export async function createDurableSyntheticExplainStatements() {
  const { uuidParameter, uint64Parameter, listStructParameter } =
    await import('../dist/integration/ydb/parameters.js');
  const dummyId = i => '00000000-0000-0000-0000-'+String(100+i).padStart(12,'0');
  const base = { kind: 'READ' };
  const count = {
    ...base, text: allowed.COUNT.sql,
    parameters: {
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(dummyId(0)),
    },
  };
  const byKey = {
    ...base, text: allowed.BY_KEY.sql,
    parameters: {
      revision: uint64Parameter(1),
      source_keys: listStructParameter([{name:'source_record_id',type:'Uuid',nullable:false}],
        Array.from({length:128},(_,i)=>({source_record_id:uuidParameter(dummyId(i))}))),
    },
  };
  if(classifyDurableRead(count)?.kind!=='COUNT' || classifyDurableRead(byKey)?.kind!=='BY_KEY')
    throw new Error('EXPLAIN_CANONICAL_SHAPE_UNPROVEN');
  return Object.freeze([count,byKey]);
}

export function classifyDurableOutcome(value) {
  const allowedOutcomes = new Set([
    'READ_BUDGET_NOT_PROVEN',
    'NO_REVISION_EVIDENCE', 'PARTIAL_CURRENT_RUN_ONLY',
    'COMPLETE_CURRENT_RUN_ONLY', 'CROSS_RUN_PK_COLLISION',
    'STAGING_MANIFEST_CARDINALITY_MISMATCH', 'STAGING_MANIFEST_STRUCTURE_MISMATCH',
    'STAGING_DURABLE_METADATA_MISMATCH', 'REVISION_ROW_MALFORMED',
    'REVISION_ROW_DUPLICATE', 'REVISION_ROW_UNEXPECTED_SOURCE',
    'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH', 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED',
  ]);
  return allowedOutcomes.has(value) ? value : 'EVIDENCE_INVALID';
}

/**
 * Build the existing canonical typed-parameter mapper from the actual YDB v6
 * submodule constructors. The package root exports conversion helpers, not
 * Optional/Uuid/Uint64 constructors; importing the root fails before a read.
 */
export async function createDurableTypedParameterMapper() {
  const [{ createYdbJsV6ParameterMapper }, primitive, optional, list, struct] = await Promise.all([
    import('../dist/integration/ydb/ydbJsV6DataTransport.js'),
    import('@ydbjs/value/primitive'),
    import('@ydbjs/value/optional'),
    import('@ydbjs/value/list'),
    import('@ydbjs/value/struct'),
  ]);
  return createYdbJsV6ParameterMapper(Object.freeze({
    ...primitive,
    Optional: optional.Optional,
    OptionalType: optional.OptionalType,
    List: list.List,
    Struct: struct.Struct,
    StructType: struct.StructType,
  }));
}
