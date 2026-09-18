import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { normalizeYdbTimestampReadback, ydbTimestampReadbackMatches } from '../integration/ydb/readbackTimestamp.js';
import {
  listStructParameter,
  uint64Parameter,
  uuidParameter,
  type YdbListStructColumn,
} from '../integration/ydb/parameters.js';
import type { RawPayload } from './rawPayloadDecoder.js';
import { serializeRawPayload } from './rawPayloadProvenance.js';
import { diffSequences } from './sequenceDiff.js';

export type InitialBootstrapStagingRevisionDiagnostic =
  | 'NO_REVISION_EVIDENCE'
  | 'PARTIAL_CURRENT_RUN_ONLY'
  | 'COMPLETE_CURRENT_RUN_ONLY'
  | 'CROSS_RUN_PK_COLLISION'
  | 'STAGING_MANIFEST_CARDINALITY_MISMATCH'
  | 'STAGING_MANIFEST_STRUCTURE_MISMATCH'
  | 'STAGING_DURABLE_METADATA_MISMATCH'
  | 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH'
  | 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED'
  | 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY'
  | 'AUTHORITATIVE_ROW_COUNT_MISMATCH'
  | 'AUTHORITATIVE_BINDING_MISMATCH'
  | 'REVISION_ROW_MALFORMED'
  | 'REVISION_ROW_DUPLICATE'
  | 'REVISION_ROW_UNEXPECTED_SOURCE'
  | 'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH'
  | 'REVISION_EVIDENCE_DIAGNOSTIC_FAILED';

export type InitialBootstrapStagingDurableRevisionDiagnostic = Exclude<
  InitialBootstrapStagingRevisionDiagnostic,
  | 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH'
  | 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED'
  | 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY'
  | 'AUTHORITATIVE_ROW_COUNT_MISMATCH'
  | 'AUTHORITATIVE_BINDING_MISMATCH'
>;

type InitialBootstrapStagingManifestDiagnostic = Extract<
  InitialBootstrapStagingDurableRevisionDiagnostic,
  | 'STAGING_MANIFEST_CARDINALITY_MISMATCH'
  | 'STAGING_MANIFEST_STRUCTURE_MISMATCH'
  | 'STAGING_DURABLE_METADATA_MISMATCH'
>;

export interface InitialBootstrapStagingRevisionObservation {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly digest: string;
}

export interface InitialBootstrapStagingExactRevisionObservation extends InitialBootstrapStagingRevisionObservation {
  readonly rawPayload: RawPayload;
}

export type InitialBootstrapStagingExactRevisionDiagnostic =
  | 'EXACT_CURRENT_RUN_MATCH'
  | 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN'
  | 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH'
  | 'EXACT_CURRENT_RUN_REVISION_MALFORMED'
  | 'EXACT_CURRENT_RUN_REVISION_DUPLICATE'
  | 'EXACT_CURRENT_RUN_REVISION_UNEXPECTED_SOURCE'
  | 'EXACT_CURRENT_RUN_MIGRATION_RUN_MISMATCH'
  | 'EXACT_CURRENT_RUN_OBSERVED_AT_MISMATCH'
  | 'EXACT_CURRENT_RUN_ROW_HINT_MISMATCH'
  | 'EXACT_CURRENT_RUN_ROW_DIGEST_MISMATCH'
  | 'EXACT_CURRENT_RUN_CHANGE_CLASS_MISMATCH'
  | 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MALFORMED'
  | 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH'
  | 'EXACT_CURRENT_RUN_DIAGNOSTIC_FAILED';

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
  readonly snapshot_captured_at?: unknown;
}

interface ExistingRevisionEvidenceRow {
  readonly source_record_id?: unknown;
  readonly revision?: unknown;
  readonly migration_run_id?: unknown;
  readonly observed_at?: unknown;
  readonly row_hint?: unknown;
  readonly row_digest?: unknown;
  readonly change_class?: unknown;
  readonly raw_payload?: unknown;
}

interface ManifestBinding {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly sourceRecordId: string;
}

interface ParsedStagingManifest {
  readonly migrationRunId: string;
  readonly durableSnapshotDigest: string;
  readonly durableSnapshotCapturedAt: string | null;
  readonly durableRowCount: number;
  readonly bindings: readonly Readonly<ManifestBinding>[];
}

type ManifestParseResult =
  | Readonly<{ readonly ok: true; readonly manifest: Readonly<ParsedStagingManifest> }>
  | Readonly<{ readonly ok: false; readonly diagnostic: InitialBootstrapStagingManifestDiagnostic }>;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SOURCE_KEY_COLUMNS = Object.freeze([
  Object.freeze({ name: 'source_record_id', type: 'Uuid', nullable: false }),
] satisfies readonly YdbListStructColumn[]);

const TEXT_ENCODER = new TextEncoder();
const EXACT_REVISION_READ_BATCH_BYTES_LIMIT = 512 * 1024;
const EXACT_REVISION_READ_FIXED_ROW_BYTES = 256;

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
      + 'CAST(s.snapshot_digest AS Utf8) AS snapshot_digest, s.row_count AS snapshot_row_count, '
      + 's.captured_at AS snapshot_captured_at '
      + 'FROM migration_runs AS r '
      + 'JOIN initial_bootstrap_identity_manifests AS m ON m.migration_run_id = r.id '
      + 'JOIN source_snapshots AS s ON s.id = m.source_snapshot_id '
      + "WHERE r.state = 'STAGING' LIMIT 2",
  );
}

function parseStagingManifest(
  rows: readonly Readonly<StagingManifestEvidenceRow>[],
): ManifestParseResult {
  if (rows.length !== 1) {
    return Object.freeze({ ok: false, diagnostic: 'STAGING_MANIFEST_CARDINALITY_MISMATCH' as const });
  }
  const row = rows[0];
  if (row === undefined || row.run_state !== 'STAGING') {
    return Object.freeze({ ok: false, diagnostic: 'STAGING_MANIFEST_STRUCTURE_MISMATCH' as const });
  }
  const migrationRunId = normalizedUuid(row.migration_run_id);
  const runDigest = digest(row.run_snapshot_digest);
  const manifestDigest = digest(row.manifest_snapshot_digest);
  const snapshotDigest = digest(row.snapshot_digest);
  const rowsSeen = safeInteger(row.rows_seen, 0);
  const bindingCount = safeInteger(row.binding_count, 0);
  const snapshotRowCount = safeInteger(row.snapshot_row_count, 0);
  const snapshotCapturedAt = normalizeYdbTimestampReadback(row.snapshot_captured_at);
  const bindings = parseBindings(row.bindings);
  if (
    migrationRunId === null
    || runDigest === null
    || manifestDigest === null
    || snapshotDigest === null
    || rowsSeen === null
    || bindingCount === null
    || snapshotRowCount === null
    || bindings === null
  ) {
    return Object.freeze({ ok: false, diagnostic: 'STAGING_MANIFEST_STRUCTURE_MISMATCH' as const });
  }
  if (
    runDigest !== manifestDigest
    || runDigest !== snapshotDigest
    || rowsSeen !== bindingCount
    || rowsSeen !== snapshotRowCount
    || rowsSeen !== bindings.length
  ) {
    return Object.freeze({ ok: false, diagnostic: 'STAGING_DURABLE_METADATA_MISMATCH' as const });
  }
  return Object.freeze({
    ok: true,
    manifest: Object.freeze({
      migrationRunId,
      durableSnapshotDigest: runDigest,
      durableSnapshotCapturedAt: snapshotCapturedAt,
      durableRowCount: rowsSeen,
      bindings,
    }),
  });
}

function bindingMatchesObservation(
  binding: Readonly<ManifestBinding>,
  observation: Readonly<InitialBootstrapStagingRevisionObservation> | undefined,
): boolean {
  return observation !== undefined
    && binding.sourceOrdinal === observation.sourceOrdinal
    && binding.rowHint === observation.rowHint
    && binding.rowDigest === observation.digest;
}

function insertionOnlySequencePreserved(
  manifest: Readonly<ParsedStagingManifest>,
  observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
): boolean {
  if (manifest.bindings.length === 0 || observations.length <= manifest.bindings.length) return false;
  const operations = diffSequences(
    manifest.bindings.map((binding) => ({
      sourceRecordId: binding.sourceRecordId,
      rowHint: binding.rowHint,
      digest: binding.rowDigest,
    })),
    observations.map((observation) => ({
      rowHint: observation.rowHint,
      digest: observation.digest,
    })),
  );
  if (!operations.some((operation) => operation.kind === 'INSERTED')) return false;
  if (!operations.every((operation) => operation.kind === 'UNCHANGED' || operation.kind === 'INSERTED')) return false;
  const unchangedSourceIds = new Set(
    operations.flatMap((operation) => operation.kind === 'UNCHANGED' ? [operation.sourceRecordId] : []),
  );
  return unchangedSourceIds.size === manifest.bindings.length
    && manifest.bindings.every((binding) => unchangedSourceIds.has(binding.sourceRecordId));
}

function authoritativeBindingDiagnostic(
  manifest: Readonly<ParsedStagingManifest>,
  sourceSnapshotDigest: string,
  observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
): InitialBootstrapStagingRevisionDiagnostic | null {
  if (sourceSnapshotDigest.trim().length === 0) {
    return 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH';
  }
  const digestMatches = sourceSnapshotDigest === manifest.durableSnapshotDigest;
  const normalizedObservations = normalizeObservations(observations);
  if (!digestMatches) {
    if (normalizedObservations === null || normalizedObservations.length <= manifest.durableRowCount) {
      return 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH';
    }
    const exactPrefix = manifest.bindings.every((binding, index) => (
      bindingMatchesObservation(binding, normalizedObservations[index])
    ));
    if (exactPrefix) return 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED';
    if (insertionOnlySequencePreserved(manifest, normalizedObservations)) {
      return 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY';
    }
    return 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH';
  }
  if (normalizedObservations === null) return 'AUTHORITATIVE_BINDING_MISMATCH';
  if (
    normalizedObservations.length !== manifest.durableRowCount
    || normalizedObservations.length !== manifest.bindings.length
  ) {
    return 'AUTHORITATIVE_ROW_COUNT_MISMATCH';
  }
  for (const [index, binding] of manifest.bindings.entries()) {
    if (!bindingMatchesObservation(binding, normalizedObservations[index])) {
      return 'AUTHORITATIVE_BINDING_MISMATCH';
    }
  }
  return null;
}

function runRevisionEvidenceStatement(migrationRunId: string) {
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest FROM source_record_revisions '
      + 'WHERE revision = $revision AND migration_run_id = $migration_run_id '
      + 'ORDER BY source_record_id',
    {
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(migrationRunId),
    },
  );
}

function sourceKeyRevisionEvidenceStatement(
  bindings: readonly Readonly<ManifestBinding>[],
) {
  const sourceKeys = bindings.map((binding) => Object.freeze({
    source_record_id: uuidParameter(binding.sourceRecordId),
  }));
  return readStatement(
    'SELECT r.source_record_id, r.revision, r.migration_run_id, r.row_hint, '
      + 'CAST(r.row_digest AS Utf8) AS row_digest '
      + 'FROM source_record_revisions AS r '
      + 'INNER JOIN AS_TABLE($source_keys) AS k ON r.source_record_id = k.source_record_id '
      + 'WHERE r.revision = $revision',
    {
      revision: uint64Parameter(1),
      source_keys: listStructParameter(SOURCE_KEY_COLUMNS, sourceKeys),
    },
  );
}

function inspectRevisionRows(
  rows: readonly Readonly<ExistingRevisionEvidenceRow>[],
  migrationRunId: string,
  expected: ReadonlyMap<string, Readonly<ManifestBinding>>,
  seen: Set<string>,
): InitialBootstrapStagingDurableRevisionDiagnostic | null {
  for (const row of rows) {
    const sourceRecordId = normalizedUuid(row.source_record_id);
    const rowRunId = normalizedUuid(row.migration_run_id);
    const revision = safeInteger(row.revision, 1);
    const rowHint = safeInteger(row.row_hint, 1);
    const rowDigest = digest(row.row_digest);
    if (sourceRecordId === null || rowRunId === null || revision !== 1 || rowHint === null || rowDigest === null) {
      return 'REVISION_ROW_MALFORMED';
    }
    if (seen.has(sourceRecordId)) return 'REVISION_ROW_DUPLICATE';
    const expectedBinding = expected.get(sourceRecordId);
    if (expectedBinding === undefined) return 'REVISION_ROW_UNEXPECTED_SOURCE';
    if (rowRunId !== migrationRunId) return 'CROSS_RUN_PK_COLLISION';
    if (rowHint !== expectedBinding.rowHint || rowDigest !== expectedBinding.rowDigest) {
      return 'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH';
    }
    seen.add(sourceRecordId);
  }
  return null;
}


function canonicalRawPayload(value: unknown): string | null {
  let payload: unknown = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  try {
    return serializeRawPayload(payload as Readonly<Record<string, unknown>>);
  } catch {
    return null;
  }
}

interface ExactExpectedRevision {
  readonly binding: Readonly<ManifestBinding>;
  readonly rawPayload: string;
}

function exactExpectedRevisions(
  manifest: Readonly<ParsedStagingManifest>,
  observations: readonly Readonly<InitialBootstrapStagingExactRevisionObservation>[],
): readonly Readonly<ExactExpectedRevision>[] | null {
  const result: Readonly<ExactExpectedRevision>[] = [];
  for (const binding of manifest.bindings) {
    const observation = observations[binding.sourceOrdinal];
    if (observation === undefined) return null;
    let rawPayload: string;
    try {
      rawPayload = serializeRawPayload(observation.rawPayload);
    } catch {
      return null;
    }
    result.push(Object.freeze({ binding, rawPayload }));
  }
  return Object.freeze(result);
}

function estimatedExactRevisionReadBytes(expected: Readonly<ExactExpectedRevision>): number {
  return EXACT_REVISION_READ_FIXED_ROW_BYTES
    + TEXT_ENCODER.encode(expected.binding.sourceRecordId).byteLength
    + TEXT_ENCODER.encode(expected.binding.rowDigest).byteLength
    + TEXT_ENCODER.encode(expected.rawPayload).byteLength;
}

function exactRunPayloadRevisionRangeStatement(
  migrationRunId: string,
  expected: readonly Readonly<ExactExpectedRevision>[],
) {
  const first = expected[0];
  const last = expected.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error('EMPTY_EXACT_REVISION_RANGE');
  }
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class, raw_payload '
      + 'FROM source_record_revisions '
      + 'WHERE source_record_id >= $source_record_id_from '
      + 'AND source_record_id <= $source_record_id_to '
      + 'AND revision = $revision AND migration_run_id = $migration_run_id',
    {
      source_record_id_from: uuidParameter(first.binding.sourceRecordId),
      source_record_id_to: uuidParameter(last.binding.sourceRecordId),
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(migrationRunId),
    },
  );
}

function planExactRevisionReadBatches(
  expected: readonly Readonly<ExactExpectedRevision>[],
): readonly (readonly Readonly<ExactExpectedRevision>[])[] {
  const batches: Readonly<ExactExpectedRevision>[][] = [];
  let current: Readonly<ExactExpectedRevision>[] = [];
  let currentBytes = 0;
  for (const revision of expected) {
    const estimatedBytes = estimatedExactRevisionReadBytes(revision);
    if (
      current.length > 0
      && currentBytes + estimatedBytes > EXACT_REVISION_READ_BATCH_BYTES_LIMIT
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(revision);
    currentBytes += estimatedBytes;
  }
  if (current.length > 0) batches.push(current);
  return Object.freeze(batches.map((batch) => Object.freeze([...batch])));
}

function inspectExactRevisionRows(
  rows: readonly Readonly<ExistingRevisionEvidenceRow>[],
  manifest: Readonly<ParsedStagingManifest>,
  expected: ReadonlyMap<string, Readonly<ExactExpectedRevision>>,
  seen: Set<string>,
): InitialBootstrapStagingExactRevisionDiagnostic | null {
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
    ) {
      return 'EXACT_CURRENT_RUN_REVISION_MALFORMED';
    }
    if (seen.has(sourceRecordId)) return 'EXACT_CURRENT_RUN_REVISION_DUPLICATE';
    const expectedRevision = expected.get(sourceRecordId);
    if (expectedRevision === undefined) return 'EXACT_CURRENT_RUN_REVISION_UNEXPECTED_SOURCE';
    if (rowRunId !== manifest.migrationRunId) return 'EXACT_CURRENT_RUN_MIGRATION_RUN_MISMATCH';
    if (manifest.durableSnapshotCapturedAt === null) return 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN';
    if (!ydbTimestampReadbackMatches(row.observed_at, manifest.durableSnapshotCapturedAt)) {
      return 'EXACT_CURRENT_RUN_OBSERVED_AT_MISMATCH';
    }
    if (rowHint !== expectedRevision.binding.rowHint) return 'EXACT_CURRENT_RUN_ROW_HINT_MISMATCH';
    if (rowDigest !== expectedRevision.binding.rowDigest) return 'EXACT_CURRENT_RUN_ROW_DIGEST_MISMATCH';
    if (row.change_class !== null) return 'EXACT_CURRENT_RUN_CHANGE_CLASS_MISMATCH';
    const rawPayload = canonicalRawPayload(row.raw_payload);
    if (rawPayload === null) return 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MALFORMED';
    if (rawPayload !== expectedRevision.rawPayload) return 'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH';
    seen.add(sourceRecordId);
  }
  return null;
}

async function diagnoseDurableRevisionEvidenceFromManifest(
  reader: YdbReadScope,
  manifest: Readonly<ParsedStagingManifest>,
): Promise<InitialBootstrapStagingDurableRevisionDiagnostic> {
  if (manifest.bindings.length === 0) return 'NO_REVISION_EVIDENCE';

  const expected = new Map(manifest.bindings.map((binding) => [binding.sourceRecordId, binding]));
  const seen = new Set<string>();
  const runResult = await reader.read<ExistingRevisionEvidenceRow>(
    runRevisionEvidenceStatement(manifest.migrationRunId),
  );
  const runFinding = inspectRevisionRows(runResult.rows, manifest.migrationRunId, expected, seen);
  if (runFinding !== null) return runFinding;

  const unchecked = manifest.bindings.filter((binding) => !seen.has(binding.sourceRecordId));
  if (unchecked.length > 0) {
    const keyResult = await reader.read<ExistingRevisionEvidenceRow>(
      sourceKeyRevisionEvidenceStatement(unchecked),
    );
    const keyFinding = inspectRevisionRows(keyResult.rows, manifest.migrationRunId, expected, seen);
    if (keyFinding !== null) return keyFinding;
  }

  if (seen.size === 0) return 'NO_REVISION_EVIDENCE';
  if (seen.size === manifest.bindings.length) return 'COMPLETE_CURRENT_RUN_ONLY';

  let firstMissingOrdinal = -1;
  for (const [index, binding] of manifest.bindings.entries()) {
    if (!seen.has(binding.sourceRecordId)) {
      firstMissingOrdinal = index;
      break;
    }
  }
  if (firstMissingOrdinal < 0) return 'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH';
  const hasEvidenceAfterFirstMissing = manifest.bindings
    .slice(firstMissingOrdinal + 1)
    .some((binding) => seen.has(binding.sourceRecordId));
  return hasEvidenceAfterFirstMissing
    ? 'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH'
    : 'PARTIAL_CURRENT_RUN_ONLY';
}

export async function diagnoseInitialBootstrapStagingDurableRevisionEvidence(
  reader: YdbReadScope,
): Promise<InitialBootstrapStagingDurableRevisionDiagnostic> {
  const manifestResult = await reader.read<StagingManifestEvidenceRow>(stagingManifestStatement());
  const parsed = parseStagingManifest(manifestResult.rows);
  if (!parsed.ok) {
    return parsed.diagnostic;
  }
  return diagnoseDurableRevisionEvidenceFromManifest(reader, parsed.manifest);
}

export async function diagnoseInitialBootstrapStagingExactRevisionEvidence(
  reader: YdbReadScope,
  sourceSnapshotDigest: string,
  observations: readonly Readonly<InitialBootstrapStagingExactRevisionObservation>[],
): Promise<InitialBootstrapStagingExactRevisionDiagnostic> {
  const manifestResult = await reader.read<StagingManifestEvidenceRow>(stagingManifestStatement());
  const parsed = parseStagingManifest(manifestResult.rows);
  if (!parsed.ok) return 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN';

  const sourceDiagnostic = authoritativeBindingDiagnostic(parsed.manifest, sourceSnapshotDigest, observations);
  if (sourceDiagnostic !== null) return 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN';

  const expectedRevisions = exactExpectedRevisions(parsed.manifest, observations);
  if (expectedRevisions === null) return 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN';
  if (expectedRevisions.length === 0) return 'EXACT_CURRENT_RUN_MATCH';

  const expected = new Map(
    expectedRevisions.map((revision) => [revision.binding.sourceRecordId, revision]),
  );

  // Ask YDB for the current-run key order explicitly. Uuid is a primitive YDB type
  // and range reads must follow provider ordering instead of client string ordering.
  const orderedResult = await reader.read<ExistingRevisionEvidenceRow>(
    runRevisionEvidenceStatement(parsed.manifest.migrationRunId),
  );
  const orderedSeen = new Set<string>();
  const orderingFinding = inspectRevisionRows(
    orderedResult.rows,
    parsed.manifest.migrationRunId,
    new Map(parsed.manifest.bindings.map((binding) => [binding.sourceRecordId, binding])),
    orderedSeen,
  );
  if (orderingFinding !== null) {
    if (orderingFinding === 'REVISION_ROW_DUPLICATE') return 'EXACT_CURRENT_RUN_REVISION_DUPLICATE';
    if (orderingFinding === 'REVISION_ROW_UNEXPECTED_SOURCE') {
      return 'EXACT_CURRENT_RUN_REVISION_UNEXPECTED_SOURCE';
    }
    if (orderingFinding === 'CROSS_RUN_PK_COLLISION') {
      return 'EXACT_CURRENT_RUN_MIGRATION_RUN_MISMATCH';
    }
    if (orderingFinding === 'REVISION_ROW_MALFORMED') {
      return 'EXACT_CURRENT_RUN_REVISION_MALFORMED';
    }
    return 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN';
  }
  if (orderedSeen.size !== expectedRevisions.length) {
    return 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH';
  }

  const orderedExpectedRevisions: Readonly<ExactExpectedRevision>[] = [];
  for (const row of orderedResult.rows) {
    const sourceRecordId = normalizedUuid(row.source_record_id);
    if (sourceRecordId === null) return 'EXACT_CURRENT_RUN_REVISION_MALFORMED';
    const revision = expected.get(sourceRecordId);
    if (revision === undefined) return 'EXACT_CURRENT_RUN_REVISION_UNEXPECTED_SOURCE';
    orderedExpectedRevisions.push(revision);
  }

  const seen = new Set<string>();
  for (const batch of planExactRevisionReadBatches(orderedExpectedRevisions)) {
    const result = await reader.read<ExistingRevisionEvidenceRow>(
      exactRunPayloadRevisionRangeStatement(parsed.manifest.migrationRunId, batch),
    );
    const finding = inspectExactRevisionRows(result.rows, parsed.manifest, expected, seen);
    if (finding !== null) return finding;
  }
  return seen.size === expectedRevisions.length
    ? 'EXACT_CURRENT_RUN_MATCH'
    : 'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH';
}

export async function diagnoseInitialBootstrapStagingRevisionEvidence(
  reader: YdbReadScope,
  sourceSnapshotDigest: string,
  observations: readonly Readonly<InitialBootstrapStagingRevisionObservation>[],
): Promise<InitialBootstrapStagingRevisionDiagnostic> {
  const manifestResult = await reader.read<StagingManifestEvidenceRow>(stagingManifestStatement());
  const parsed = parseStagingManifest(manifestResult.rows);
  if (!parsed.ok) return parsed.diagnostic;

  const sourceDiagnostic = authoritativeBindingDiagnostic(parsed.manifest, sourceSnapshotDigest, observations);
  if (sourceDiagnostic !== null) return sourceDiagnostic;
  return diagnoseDurableRevisionEvidenceFromManifest(reader, parsed.manifest);
}
