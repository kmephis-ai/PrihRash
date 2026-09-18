import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { ydbTimestampReadbackMatches } from '../integration/ydb/readbackTimestamp.js';
import {
  listStructParameter,
  uint64Parameter,
  uuidParameter,
  type YdbListStructColumn,
  type YdbParameter,
} from '../integration/ydb/parameters.js';
import {
  PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT,
  PRELIVE_PROMOTION_QUERY_BYTES_LIMIT,
} from './atomicPromotion.js';
import type { InitialSourceRecordRevisionProjection } from './initialSourceLineage.js';
import { serializeRawPayload } from './rawPayloadProvenance.js';

interface ExistingInitialRevisionRow {
  readonly source_record_id?: unknown;
  readonly revision?: unknown;
  readonly migration_run_id?: unknown;
  readonly observed_at?: unknown;
  readonly row_hint?: unknown;
  readonly row_digest?: unknown;
  readonly change_class?: unknown;
  readonly raw_payload?: unknown;
}

export interface InitialSourceRevisionResumePlan {
  readonly existingSourceRecordIds: readonly string[];
  readonly missingRevisions: readonly Readonly<InitialSourceRecordRevisionProjection>[];
}

export type InitialSourceRevisionEvidenceRecoveryErrorCode =
  | 'INVALID_EXPECTED_REVISION'
  | 'MIXED_EXPECTED_RUN'
  | 'MALFORMED_EXISTING_REVISION'
  | 'DUPLICATE_EXISTING_REVISION'
  | 'EXTRA_EXISTING_REVISION'
  | 'EXISTING_REVISION_MISMATCH';

export class InitialSourceRevisionEvidenceRecoveryError extends Error {
  readonly code: InitialSourceRevisionEvidenceRecoveryErrorCode;

  constructor(code: InitialSourceRevisionEvidenceRecoveryErrorCode) {
    super(code);
    this.name = 'InitialSourceRevisionEvidenceRecoveryError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SOURCE_KEY_COLUMNS = Object.freeze([
  Object.freeze({ name: 'source_record_id', type: 'Uuid', nullable: false }),
] satisfies readonly YdbListStructColumn[]);

const TEXT_ENCODER = new TextEncoder();
// Reuse the live-calibrated 512 KiB envelope as a conservative upper bound for
// one exact revision-evidence verification response batch. This is not a row cap:
// batching is derived from the expected payload bytes and preserves full raw-payload verification.
const REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT = PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT;
const REVISION_EVIDENCE_READ_FIXED_ROW_BYTES = 256;

function malformed(): never {
  throw new InitialSourceRevisionEvidenceRecoveryError('MALFORMED_EXISTING_REVISION');
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) malformed();
  return value.toLowerCase();
}

function positiveInteger(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) malformed();
    return Number(value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) malformed();
  return value;
}

function digestString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) malformed();
  return value;
}

function canonicalRawPayload(value: unknown): string {
  let payload: unknown = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      malformed();
    }
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) malformed();
  try {
    return serializeRawPayload(payload as Readonly<Record<string, unknown>>);
  } catch {
    malformed();
  }
}

function expectedMap(
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
): Readonly<{
  runId: string | null;
  bySourceId: ReadonlyMap<string, Readonly<InitialSourceRecordRevisionProjection>>;
}> {
  const bySourceId = new Map<string, Readonly<InitialSourceRecordRevisionProjection>>();
  let runId: string | null = null;
  for (const revision of revisions) {
    if (
      revision.revision !== 1
      || !UUID_PATTERN.test(revision.sourceRecordId)
      || !UUID_PATTERN.test(revision.migrationRunId)
      || !Number.isSafeInteger(revision.rowHint)
      || revision.rowHint < 1
      || revision.rowDigest.trim().length === 0
      || revision.rawPayload.trim().length === 0
    ) {
      throw new InitialSourceRevisionEvidenceRecoveryError('INVALID_EXPECTED_REVISION');
    }
    const sourceRecordId = revision.sourceRecordId.toLowerCase();
    if (bySourceId.has(sourceRecordId)) {
      throw new InitialSourceRevisionEvidenceRecoveryError('INVALID_EXPECTED_REVISION');
    }
    const normalizedRunId = revision.migrationRunId.toLowerCase();
    if (runId === null) runId = normalizedRunId;
    else if (runId !== normalizedRunId) {
      throw new InitialSourceRevisionEvidenceRecoveryError('MIXED_EXPECTED_RUN');
    }
    bySourceId.set(sourceRecordId, revision);
  }
  return Object.freeze({ runId, bySourceId });
}

function existingMetadataMatches(
  row: Readonly<ExistingInitialRevisionRow>,
  expected: Readonly<InitialSourceRecordRevisionProjection>,
): boolean {
  return positiveInteger(row.revision) === 1
    && uuid(row.migration_run_id) === expected.migrationRunId.toLowerCase()
    && ydbTimestampReadbackMatches(row.observed_at, expected.observedAt)
    && positiveInteger(row.row_hint) === expected.rowHint
    && digestString(row.row_digest) === expected.rowDigest
    && row.change_class === null;
}

function existingMatches(
  row: Readonly<ExistingInitialRevisionRow>,
  expected: Readonly<InitialSourceRecordRevisionProjection>,
): boolean {
  return existingMetadataMatches(row, expected)
    && canonicalRawPayload(row.raw_payload) === expected.rawPayload;
}

function validateRevisionRows(
  rows: readonly Readonly<ExistingInitialRevisionRow>[],
  expected: Readonly<{
    runId: string | null;
    bySourceId: ReadonlyMap<string, Readonly<InitialSourceRecordRevisionProjection>>;
  }>,
  seenSourceIds: Set<string>,
  exactPayload: boolean,
): void {
  for (const row of rows) {
    const sourceRecordId = uuid(row.source_record_id);
    if (seenSourceIds.has(sourceRecordId)) {
      throw new InitialSourceRevisionEvidenceRecoveryError('DUPLICATE_EXISTING_REVISION');
    }
    seenSourceIds.add(sourceRecordId);
    const expectedRevision = expected.bySourceId.get(sourceRecordId);
    if (expectedRevision === undefined) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXTRA_EXISTING_REVISION');
    }
    const matches = exactPayload
      ? existingMatches(row, expectedRevision)
      : existingMetadataMatches(row, expectedRevision);
    if (!matches) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXISTING_REVISION_MISMATCH');
    }
  }
}

function estimatedRevisionReadBytes(
  revision: Readonly<InitialSourceRecordRevisionProjection>,
): number {
  return REVISION_EVIDENCE_READ_FIXED_ROW_BYTES
    + TEXT_ENCODER.encode(revision.sourceRecordId).byteLength
    + TEXT_ENCODER.encode(revision.migrationRunId).byteLength
    + TEXT_ENCODER.encode(revision.observedAt).byteLength
    + TEXT_ENCODER.encode(revision.rowDigest).byteLength
    + TEXT_ENCODER.encode(revision.rawPayload).byteLength;
}

function exactPayloadReadStatement(
  runId: string,
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
) {
  const parameters: Record<string, YdbParameter> = {
    revision: uint64Parameter(1),
    migration_run_id: uuidParameter(runId),
  };
  const predicates = revisions.map((revision, index) => {
    const parameterName = `source_record_id_${index}`;
    parameters[parameterName] = uuidParameter(revision.sourceRecordId);
    return `source_record_id = $${parameterName}`;
  });
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class, raw_payload '
      + 'FROM source_record_revisions '
      + 'WHERE revision = $revision AND migration_run_id = $migration_run_id '
      + `AND (${predicates.join(' OR ')})`,
    parameters,
  );
}

function planRevisionReadBatches(
  runId: string,
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
): readonly (readonly Readonly<InitialSourceRecordRevisionProjection>[])[] {
  const batches: Readonly<InitialSourceRecordRevisionProjection>[][] = [];
  let current: Readonly<InitialSourceRecordRevisionProjection>[] = [];
  let currentBytes = 0;

  for (const revision of revisions) {
    const estimatedBytes = estimatedRevisionReadBytes(revision);
    const candidate = [...current, revision];
    const candidateQueryBytes = TEXT_ENCODER.encode(
      exactPayloadReadStatement(runId, candidate).text,
    ).byteLength;
    if (
      current.length > 0
      && (
        currentBytes + estimatedBytes > REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT
        || candidateQueryBytes > PRELIVE_PROMOTION_QUERY_BYTES_LIMIT
      )
    ) {
      batches.push(current);
      current = [revision];
      currentBytes = estimatedBytes;
      continue;
    }
    current = candidate;
    currentBytes += estimatedBytes;
  }
  if (current.length > 0) batches.push(current);
  return Object.freeze(batches.map((batch) => Object.freeze([...batch])));
}

function runRevisionReadStatement(runId: string) {
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class '
      + 'FROM source_record_revisions '
      + 'WHERE revision = $revision AND migration_run_id = $migration_run_id',
    {
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(runId),
    },
  );
}

function sourceKeyReadStatement(
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
) {
  const sourceKeys = revisions.map((revision) => Object.freeze({
    source_record_id: uuidParameter(revision.sourceRecordId),
  }));
  return readStatement(
    'SELECT r.source_record_id, r.revision, r.migration_run_id, r.observed_at, r.row_hint, '
      + 'CAST(r.row_digest AS Utf8) AS row_digest, r.change_class '
      + 'FROM source_record_revisions AS r '
      + 'INNER JOIN AS_TABLE($source_keys) AS k ON r.source_record_id = k.source_record_id '
      + 'WHERE r.revision = $revision',
    {
      revision: uint64Parameter(1),
      source_keys: listStructParameter(SOURCE_KEY_COLUMNS, sourceKeys),
    },
  );
}

export async function planInitialSourceRevisionEvidenceResume(
  reader: YdbReadScope,
  expectedRevisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
): Promise<Readonly<InitialSourceRevisionResumePlan>> {
  const expected = expectedMap(expectedRevisions);
  if (expected.runId === null) {
    return Object.freeze({
      existingSourceRecordIds: Object.freeze([]),
      missingRevisions: Object.freeze([]),
    });
  }

  const existingSourceIds = new Set<string>();
  const runResult = await reader.read<ExistingInitialRevisionRow>(
    runRevisionReadStatement(expected.runId),
  );
  validateRevisionRows(runResult.rows, expected, existingSourceIds, false);

  // Exact payload equality remains mandatory, but current-run rows are verified
  // through scalar run-scoped predicates instead of the AS_TABLE join seam. Batches are
  // bounded by both the calibrated response-memory envelope and the query-text envelope.
  const existingRevisions = expectedRevisions.filter(
    (revision) => existingSourceIds.has(revision.sourceRecordId.toLowerCase()),
  );
  const payloadVerifiedSourceIds = new Set<string>();
  for (const batch of planRevisionReadBatches(expected.runId, existingRevisions)) {
    const payloadResult = await reader.read<ExistingInitialRevisionRow>(
      exactPayloadReadStatement(expected.runId, batch),
    );
    validateRevisionRows(payloadResult.rows, expected, payloadVerifiedSourceIds, true);
  }
  for (const sourceRecordId of existingSourceIds) {
    if (!payloadVerifiedSourceIds.has(sourceRecordId)) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXISTING_REVISION_MISMATCH');
    }
  }

  const missingRevisions = expectedRevisions.filter(
    (revision) => !existingSourceIds.has(revision.sourceRecordId.toLowerCase()),
  );
  if (missingRevisions.length > 0) {
    const collisionResult = await reader.read<ExistingInitialRevisionRow>(
      sourceKeyReadStatement(missingRevisions),
    );
    const collisionSourceIds = new Set<string>();
    validateRevisionRows(collisionResult.rows, expected, collisionSourceIds, false);
    if (collisionSourceIds.size > 0) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXISTING_REVISION_MISMATCH');
    }
  }
  return Object.freeze({
    existingSourceRecordIds: Object.freeze([...existingSourceIds].sort()),
    missingRevisions: Object.freeze([...missingRevisions]),
  });
}
