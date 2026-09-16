import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { uint64Parameter, uuidParameter } from '../integration/ydb/parameters.js';

export type InitialBootstrapStagingRevisionDiagnostic =
  | 'NO_REVISION_EVIDENCE'
  | 'PARTIAL_CURRENT_RUN_ONLY'
  | 'COMPLETE_CURRENT_RUN_ONLY'
  | 'CROSS_RUN_PK_COLLISION'
  | 'REVISION_EVIDENCE_MISMATCH'
  | 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED';

export interface InitialBootstrapStagingRevisionObservation {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly digest: string;
}

interface StagingManifestEvidenceRow {
  readonly migration_run_id?: unknown;
  readonly run_state?: unknown;
  readonly run_snapshot_digest?: unknown;
  readonly rows_seen?: unknown;
  readonly manifest_snapshot_digest?: unknown;
  readonly binding_count?: unknown;
  readonly bindings?: unknown;
  readonly snapshot_digest?: unknown;
  readonly snapshot_row_count?: unknown;
}

interface ExistingRevisionEvidenceRow {
  readonly source_record_id?: unknown;
  readonly revision?: unknown;
  readonly migration_run_id?: unknown;
  readonly row_hint?: unknown;
  readonly row_digest?: unknown;
}

interface ManifestBinding {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly sourceRecordId: string;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const READ_KEYS_PER_QUERY_LIMIT = 50;

function normalizedUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function safeInteger(value: unknown, minimum: number): number | null {
  if (typeof value === 'bigint') {
    if (value < BigInt(minimum) || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function digest(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function exactKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function parseBindings(value: unknown): readonly Readonly<ManifestBinding>[] | null {
  let payload: unknown = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Readonly<Record<string, unknown>>;
  if (!exactKeys(root, ['schema_version', 'bindings']) || root.schema_version !== 1 || !Array.isArray(root.bindings)) {
    return null;
  }

  const parsed: Readonly<ManifestBinding>[] = [];
  const sourceIds = new Set<string>();
  const transactionIds = new Set<string>();
  for (const valueBinding of root.bindings) {
    if (valueBinding === null || typeof valueBinding !== 'object' || Array.isArray(valueBinding)) return null;
    const binding = valueBinding as Readonly<Record<string, unknown>>;
    if (!exactKeys(binding, ['source_ordinal', 'row_hint', 'row_digest', 'source_record_id', 'transaction_id'])) {
      return null;
    }
    const sourceOrdinal = safeInteger(binding.source_ordinal, 0);
    const rowHint = safeInteger(binding.row_hint, 1);
    const rowDigest = digest(binding.row_digest);
    const sourceRecordId = normalizedUuid(binding.source_record_id);
    const transactionId = binding.transaction_id === null ? null : normalizedUuid(binding.transaction_id);
    if (
      sourceOrdinal === null
      || rowHint === null
      || rowDigest === null
      || sourceRecordId === null
      || (binding.transaction_id !== null && transactionId === null)
      || sourceIds.has(sourceRecordId)
      || (transactionId !== null && transactionIds.has(transactionId))
    ) {
      return null;
    }
    sourceIds.add(sourceRecordId);
    if (transactionId !== null) transactionIds.add(transactionId);
    parsed.push(Object.freeze({ sourceOrdinal, rowHint, rowDigest, sourceRecordId }));
  }
  parsed.sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
  for (const [index, binding] of parsed.entries()) {
    if (binding.sourceOrdinal !== index) return null;
  }
  return Object.freeze(parsed);
}

function normalizeObservations(
  observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
): readonly Readonly<InitialBootstrapStagingRevisionObservation>[] | null {
  const normalized = observations.map((observation) => Object.freeze({ ...observation }))
    .sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
  for (const [index, observation] of normalized.entries()) {
    if (
      observation.sourceOrdinal !== index
      || !Number.isSafeInteger(observation.rowHint)
      || observation.rowHint < 1
      || typeof observation.digest !== 'string'
      || observation.digest.trim().length === 0
    ) {
      return null;
    }
  }
  return Object.freeze(normalized);
}

function stagingManifestStatement() {
  return readStatement(
    'SELECT r.id AS migration_run_id, r.state AS run_state, '
      + 'CAST(r.source_snapshot_digest AS Utf8) AS run_snapshot_digest, r.rows_seen AS rows_seen, '
      + 'CAST(m.source_snapshot_digest AS Utf8) AS manifest_snapshot_digest, '
      + 'm.binding_count AS binding_count, m.bindings AS bindings, '
      + 'CAST(s.snapshot_digest AS Utf8) AS snapshot_digest, s.row_count AS snapshot_row_count '
      + 'FROM migration_runs AS r '
      + 'JOIN initial_bootstrap_identity_manifests AS m ON m.migration_run_id = r.id '
      + 'JOIN source_snapshots AS s ON s.id = m.source_snapshot_id '
      + "WHERE r.state = 'STAGING' LIMIT 2",
  );
}

function expectedRowsFromManifest(
  rows: readonly Readonly<StagingManifestEvidenceRow>[],
  sourceSnapshotDigest: string,
  observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
): Readonly<{ migrationRunId: string; bindings: readonly Readonly<ManifestBinding>[] }> | null {
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (row === undefined || row.run_state !== 'STAGING') return null;
  const migrationRunId = normalizedUuid(row.migration_run_id);
  const runDigest = digest(row.run_snapshot_digest);
  const manifestDigest = digest(row.manifest_snapshot_digest);
  const snapshotDigest = digest(row.snapshot_digest);
  const rowsSeen = safeInteger(row.rows_seen, 0);
  const bindingCount = safeInteger(row.binding_count, 0);
  const snapshotRowCount = safeInteger(row.snapshot_row_count, 0);
  const bindings = parseBindings(row.bindings);
  const normalizedObservations = normalizeObservations(observations);
  if (
    migrationRunId === null
    || runDigest !== sourceSnapshotDigest
    || manifestDigest !== sourceSnapshotDigest
    || snapshotDigest !== sourceSnapshotDigest
    || rowsSeen === null
    || bindingCount === null
    || snapshotRowCount === null
    || bindings === null
    || normalizedObservations === null
    || rowsSeen !== normalizedObservations.length
    || bindingCount !== normalizedObservations.length
    || snapshotRowCount !== normalizedObservations.length
    || bindings.length !== normalizedObservations.length
  ) {
    return null;
  }
  for (const [index, binding] of bindings.entries()) {
    const observation = normalizedObservations[index];
    if (
      observation === undefined
      || binding.sourceOrdinal !== observation.sourceOrdinal
      || binding.rowHint !== observation.rowHint
      || binding.rowDigest !== observation.digest
    ) {
      return null;
    }
  }
  return Object.freeze({ migrationRunId, bindings });
}

function revisionEvidenceStatement(
  bindings: readonly Readonly<ManifestBinding>[],
  migrationRunId: string | null,
) {
  const sourceIdParameters = Object.fromEntries(bindings.map((binding, index) => [
    `source_record_id_${index}`,
    uuidParameter(binding.sourceRecordId),
  ]));
  const placeholders = bindings.map((_, index) => `$source_record_id_${index}`).join(', ');
  const runPredicate = migrationRunId === null ? '' : 'migration_run_id = $migration_run_id OR ';
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest FROM source_record_revisions '
      + `WHERE revision = $revision AND (${runPredicate}source_record_id IN (${placeholders}))`,
    {
      revision: uint64Parameter(1),
      ...(migrationRunId === null ? {} : { migration_run_id: uuidParameter(migrationRunId) }),
      ...sourceIdParameters,
    },
  );
}

function inspectRevisionRows(
  rows: readonly Readonly<ExistingRevisionEvidenceRow>[],
  migrationRunId: string,
  expected: ReadonlyMap<string, Readonly<ManifestBinding>>,
  seen: Set<string>,
): InitialBootstrapStagingRevisionDiagnostic | null {
  for (const row of rows) {
    const sourceRecordId = normalizedUuid(row.source_record_id);
    const rowRunId = normalizedUuid(row.migration_run_id);
    const revision = safeInteger(row.revision, 1);
    const rowHint = safeInteger(row.row_hint, 1);
    const rowDigest = digest(row.row_digest);
    if (
      sourceRecordId === null
      || rowRunId === null
      || revision !== 1
      || rowHint === null
      || rowDigest === null
      || seen.has(sourceRecordId)
    ) {
      return 'REVISION_EVIDENCE_MISMATCH';
    }
    const expectedBinding = expected.get(sourceRecordId);
    if (expectedBinding === undefined) return 'REVISION_EVIDENCE_MISMATCH';
    if (rowRunId !== migrationRunId) return 'CROSS_RUN_PK_COLLISION';
    if (rowHint !== expectedBinding.rowHint || rowDigest !== expectedBinding.rowDigest) {
      return 'REVISION_EVIDENCE_MISMATCH';
    }
    seen.add(sourceRecordId);
  }
  return null;
}

export async function diagnoseInitialBootstrapStagingRevisionEvidence(
  reader: YdbReadScope,
  sourceSnapshotDigest: string,
  observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
): Promise<InitialBootstrapStagingRevisionDiagnostic> {
  if (typeof sourceSnapshotDigest !== 'string' || sourceSnapshotDigest.trim().length === 0) {
    return 'REVISION_EVIDENCE_MISMATCH';
  }
  const manifestResult = await reader.read<StagingManifestEvidenceRow>(stagingManifestStatement());
  const manifest = expectedRowsFromManifest(manifestResult.rows, sourceSnapshotDigest, observations);
  if (manifest === null) return 'REVISION_EVIDENCE_MISMATCH';
  if (manifest.bindings.length === 0) return 'NO_REVISION_EVIDENCE';

  const expected = new Map(manifest.bindings.map((binding) => [binding.sourceRecordId, binding]));
  const seen = new Set<string>();
  const firstBatch = manifest.bindings.slice(0, READ_KEYS_PER_QUERY_LIMIT);
  const firstResult = await reader.read<ExistingRevisionEvidenceRow>(
    revisionEvidenceStatement(firstBatch, manifest.migrationRunId),
  );
  const firstFinding = inspectRevisionRows(firstResult.rows, manifest.migrationRunId, expected, seen);
  if (firstFinding !== null) return firstFinding;

  const unchecked = manifest.bindings
    .slice(READ_KEYS_PER_QUERY_LIMIT)
    .filter((binding) => !seen.has(binding.sourceRecordId));
  for (let start = 0; start < unchecked.length; start += READ_KEYS_PER_QUERY_LIMIT) {
    const batch = unchecked.slice(start, start + READ_KEYS_PER_QUERY_LIMIT);
    const result = await reader.read<ExistingRevisionEvidenceRow>(revisionEvidenceStatement(batch, null));
    const finding = inspectRevisionRows(result.rows, manifest.migrationRunId, expected, seen);
    if (finding !== null) return finding;
  }

  if (seen.size === 0) return 'NO_REVISION_EVIDENCE';
  if (seen.size === manifest.bindings.length) return 'COMPLETE_CURRENT_RUN_ONLY';
  return 'PARTIAL_CURRENT_RUN_ONLY';
}
