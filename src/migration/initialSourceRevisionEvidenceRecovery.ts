import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { ydbTimestampReadbackMatches } from '../integration/ydb/readbackTimestamp.js';
import {
  listStructParameter,
  uint64Parameter,
  uuidParameter,
  type YdbListStructColumn,
} from '../integration/ydb/parameters.js';
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

export type InitialSourceRevisionEvidenceReadStage =
  | 'REVISION_METADATA_SCAN'
  | 'REVISION_PAYLOAD_BATCH'
  | 'REVISION_COLLISION_READ';

export type InitialSourceRevisionEvidenceReadBatchEvidence =
  | 'UNOBSERVED'
  | 'NO_PAYLOAD_BATCH'
  | 'ALL_BATCHES_WITHIN_64_KIB'
  | 'SINGLE_REVISION_EXCEEDS_64_KIB'
  | 'DIAGNOSTIC_FAILED';

export type InitialSourceRevisionEvidenceReadObserver = (
  stage: InitialSourceRevisionEvidenceReadStage,
) => void;

export type InitialSourceRevisionEvidenceReadBatchObserver = (
  evidence: Exclude<InitialSourceRevisionEvidenceReadBatchEvidence, 'UNOBSERVED' | 'DIAGNOSTIC_FAILED'>,
) => void;

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
// Payload batches stay below the 10-RU/s Serverless read budget with a small
// CPU-RU margin. The row limit also bounds the I/O-RU floor (one RU per row).
const REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT = 64 * 1024;
const REVISION_EVIDENCE_READ_BATCH_ROWS_LIMIT = 8;
const REVISION_EVIDENCE_READ_FIXED_ROW_BYTES = 256;
// Stay below the verified 10-RU/s baseline and reserve two RU per query for CPU.
const REVISION_EVIDENCE_READ_RU_PER_SECOND = 8;
const REVISION_EVIDENCE_READ_RU_SAFETY_MARGIN = 2;
const YDB_READ_BLOCK_BYTES = 4 * 1024;

export type InitialSourceRevisionEvidenceReadBudgetWaiter = (
  estimatedRequestUnits: number,
) => Promise<void>;

export async function waitForInitialSourceRevisionEvidenceReadBudget(
  estimatedRequestUnits: number,
): Promise<void> {
  if (!Number.isSafeInteger(estimatedRequestUnits) || estimatedRequestUnits < 1) {
    throw new InitialSourceRevisionEvidenceRecoveryError('INVALID_EXPECTED_REVISION');
  }
  const milliseconds = Math.ceil(
    ((estimatedRequestUnits + REVISION_EVIDENCE_READ_RU_SAFETY_MARGIN)
      / REVISION_EVIDENCE_READ_RU_PER_SECOND) * 1_000,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function observeReadStage(
  observer: InitialSourceRevisionEvidenceReadObserver | undefined,
  stage: InitialSourceRevisionEvidenceReadStage,
): void {
  if (observer === undefined) return;
  try {
    observer(stage);
  } catch {
    // Diagnostics must never alter recovery semantics or provider request count.
  }
}

function observeBatchEvidence(
  observer: InitialSourceRevisionEvidenceReadBatchObserver | undefined,
  evidence: Exclude<InitialSourceRevisionEvidenceReadBatchEvidence, 'UNOBSERVED' | 'DIAGNOSTIC_FAILED'>,
): void {
  if (observer === undefined) return;
  try {
    observer(evidence);
  } catch {
    // Diagnostics must never alter recovery semantics or provider request count.
  }
}

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

function exactPayloadRangeReadStatement(
  runId: string,
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
) {
  const first = revisions[0];
  const last = revisions.at(-1);
  if (first === undefined || last === undefined) {
    throw new InitialSourceRevisionEvidenceRecoveryError('INVALID_EXPECTED_REVISION');
  }
  return readStatement(
    'SELECT r.source_record_id, r.revision, r.migration_run_id, r.observed_at, r.row_hint, '
      + 'CAST(r.row_digest AS Utf8) AS row_digest, r.change_class, r.raw_payload '
      + 'FROM source_record_revisions AS r '
      + 'WHERE r.source_record_id >= $source_record_id_from '
      + 'AND r.source_record_id <= $source_record_id_to '
      + 'AND r.revision = $revision AND r.migration_run_id = $migration_run_id',
    {
      source_record_id_from: uuidParameter(first.sourceRecordId),
      source_record_id_to: uuidParameter(last.sourceRecordId),
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(runId),
    },
  );
}

function planRevisionReadBatches(
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
): readonly (readonly Readonly<InitialSourceRecordRevisionProjection>[])[] {
  const batches: Readonly<InitialSourceRecordRevisionProjection>[][] = [];
  let current: Readonly<InitialSourceRecordRevisionProjection>[] = [];
  let currentBytes = 0;

  for (const revision of revisions) {
    const estimatedBytes = estimatedRevisionReadBytes(revision);
    if (
      current.length > 0
      && (
        current.length >= REVISION_EVIDENCE_READ_BATCH_ROWS_LIMIT
        || currentBytes + estimatedBytes > REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT
      )
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

function runRevisionMetadataStatement(runId: string) {
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class '
      + 'FROM source_record_revisions VIEW idx_source_record_revisions_run_revision '
      + 'WHERE revision = $revision AND migration_run_id = $migration_run_id '
      + 'ORDER BY source_record_id',
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
  observeReadStageEvidence?: InitialSourceRevisionEvidenceReadObserver,
  observeReadBatchEvidence?: InitialSourceRevisionEvidenceReadBatchObserver,
  waitForReadBudget?: InitialSourceRevisionEvidenceReadBudgetWaiter,
): Promise<Readonly<InitialSourceRevisionResumePlan>> {
  const expected = expectedMap(expectedRevisions);
  if (expected.runId === null) {
    observeBatchEvidence(observeReadBatchEvidence, 'NO_PAYLOAD_BATCH');
    return Object.freeze({
      existingSourceRecordIds: Object.freeze([]),
      missingRevisions: Object.freeze([]),
    });
  }

  const existingSourceIds = new Set<string>();
  // Keep the canonical run-scoped metadata proof in one indexed request. A
  // sequence of small pages still pays per-query CPU/compilation RU and can
  // exhaust Serverless burst capacity before exact payload verification starts.
  // The result contains metadata only; raw_payload remains byte-bounded below.
  observeReadStage(observeReadStageEvidence, 'REVISION_METADATA_SCAN');
  const metadataResult = await reader.read<ExistingInitialRevisionRow>(
    runRevisionMetadataStatement(expected.runId),
  );
  validateRevisionRows(metadataResult.rows, expected, existingSourceIds, false);

  // Exact payload equality remains mandatory. The metadata scan already returns
  // the exact current-run source IDs; payload verification reuses those exact keys
  // so sparse UUID ranges cannot amplify read RU. Keep this scan metadata-only: the
  // exact raw payload remains in byte-bounded primary-key range reads below.
  const existingRevisions = metadataResult.rows.map((row) => {
    const sourceRecordId = uuid(row.source_record_id);
    const revision = expected.bySourceId.get(sourceRecordId);
    if (revision === undefined) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXTRA_EXISTING_REVISION');
    }
    return revision;
  });
  const payloadVerifiedSourceIds = new Set<string>();
  const batches = planRevisionReadBatches(existingRevisions);
  if (batches.length === 0) observeBatchEvidence(observeReadBatchEvidence, 'NO_PAYLOAD_BATCH');
  for (const batch of batches) {
    const estimatedBatchBytes = batch.reduce(
      (total, revision) => total + estimatedRevisionReadBytes(revision),
      0,
    );
    observeBatchEvidence(
      observeReadBatchEvidence,
      batch.length === 1 && estimatedBatchBytes > REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT
        ? 'SINGLE_REVISION_EXCEEDS_64_KIB'
        : 'ALL_BATCHES_WITHIN_64_KIB',
    );
    if (waitForReadBudget !== undefined) {
      const estimatedIoRequestUnits = Math.max(
        batch.length,
        Math.ceil(estimatedBatchBytes / YDB_READ_BLOCK_BYTES),
      );
      // The preceding run-scoped metadata scan can consume most of the idle RU
      // burst. Refill budget before every payload range, including the first.
      await waitForReadBudget(estimatedIoRequestUnits);
    }
    observeReadStage(observeReadStageEvidence, 'REVISION_PAYLOAD_BATCH');
    const payloadResult = await reader.read<ExistingInitialRevisionRow>(
      exactPayloadRangeReadStatement(expected.runId, batch),
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
    observeReadStage(observeReadStageEvidence, 'REVISION_COLLISION_READ');
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
