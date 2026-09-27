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
// A single indexed cursor pass returns exact revision metadata and raw payload
// together; bounded pages avoid charging a second full pass for metadata.
// Each page stays within the 10-RU/s budget with a small CPU-RU margin.
const REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT = 64 * 1024;
const REVISION_EVIDENCE_READ_BATCH_ROWS_LIMIT = 9;
const REVISION_EVIDENCE_READ_FIXED_ROW_BYTES = 256;
// Target the verified 10-RU/s baseline and reserve one RU per query for CPU.
const REVISION_EVIDENCE_READ_RU_PER_SECOND = 10;
const REVISION_EVIDENCE_READ_RU_SAFETY_MARGIN = 1;
const YDB_READ_BLOCK_BYTES = 4 * 1024;

export type InitialSourceRevisionEvidenceReadBudgetWaiter = (
  estimatedRequestUnits: number,
) => Promise<void>;

export function initialSourceRevisionEvidenceReadBudgetDelayMs(
  estimatedRequestUnits: number,
): number {
  if (!Number.isSafeInteger(estimatedRequestUnits) || estimatedRequestUnits < 1) {
    throw new InitialSourceRevisionEvidenceRecoveryError('INVALID_EXPECTED_REVISION');
  }
  return Math.ceil(
    ((estimatedRequestUnits + REVISION_EVIDENCE_READ_RU_SAFETY_MARGIN)
      / REVISION_EVIDENCE_READ_RU_PER_SECOND) * 1_000,
  );
}

export function createInitialSourceRevisionEvidenceReadBudgetWaiter(
  now: () => number = () => performance.now(),
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) => (
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  ),
): InitialSourceRevisionEvidenceReadBudgetWaiter {
  let nextReadStartAt: number | null = null;
  return async (estimatedRequestUnits) => {
    const delayMs = initialSourceRevisionEvidenceReadBudgetDelayMs(estimatedRequestUnits);
    const currentTime = now();
    const waitMs = nextReadStartAt === null
      ? delayMs
      : Math.max(0, nextReadStartAt - currentTime);
    if (waitMs > 0) await sleep(waitMs);
    nextReadStartAt = now() + delayMs;
  };
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

function revisionPayloadPageStatement(runId: string, afterSourceRecordId: string | null, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REVISION_EVIDENCE_READ_BATCH_ROWS_LIMIT) {
    throw new InitialSourceRevisionEvidenceRecoveryError('INVALID_EXPECTED_REVISION');
  }
  const cursorPredicate = afterSourceRecordId === null
    ? ''
    : 'AND source_record_id > $source_record_id_after ';
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class, raw_payload '
      + 'FROM source_record_revisions VIEW idx_source_record_revisions_run_revision '
      + 'WHERE migration_run_id = $migration_run_id AND revision = $revision '
      + cursorPredicate
      + `ORDER BY source_record_id LIMIT ${limit}`,
    {
      ...(afterSourceRecordId === null ? {} : { source_record_id_after: uuidParameter(afterSourceRecordId) }),
      revision: uint64Parameter(1),
      migration_run_id: uuidParameter(runId),
    },
  );
}

function boundedRevisionReadPage(
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
): Readonly<{ limit: number; estimatedRequestUnits: number }> {
  const rowBytes = revisions.map(estimatedRevisionReadBytes).sort((left, right) => right - left);
  const targetLimit = Math.min(REVISION_EVIDENCE_READ_BATCH_ROWS_LIMIT, revisions.length + 1);
  let limit = 1;
  let pageBytes = rowBytes[0] ?? REVISION_EVIDENCE_READ_FIXED_ROW_BYTES;
  for (let candidate = 2; candidate <= targetLimit; candidate += 1) {
    const candidateBytes = rowBytes.slice(0, candidate).reduce((total, bytes) => total + bytes, 0);
    if (candidateBytes > REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT) break;
    limit = candidate;
    pageBytes = candidateBytes;
  }
  return Object.freeze({
    limit,
    estimatedRequestUnits: Math.max(limit, Math.ceil(pageBytes / YDB_READ_BLOCK_BYTES)),
  });
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
  const pageBudget = boundedRevisionReadPage(expectedRevisions);
  let afterSourceRecordId: string | null = null;
  let readCount = 0;
  while (true) {
    if (waitForReadBudget !== undefined) {
      await waitForReadBudget(pageBudget.estimatedRequestUnits);
    }
    observeReadStage(observeReadStageEvidence, 'REVISION_PAYLOAD_BATCH');
    const pageResult = await reader.read<ExistingInitialRevisionRow>(
      revisionPayloadPageStatement(expected.runId, afterSourceRecordId, pageBudget.limit),
    );
    if (pageResult.rows.length > pageBudget.limit) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXTRA_EXISTING_REVISION');
    }
    if (pageResult.rows.length === 0) break;
    validateRevisionRows(pageResult.rows, expected, existingSourceIds, true);
    const pageBytes = pageResult.rows.reduce((total, row) => {
      const sourceRecordId = uuid(row.source_record_id);
      const revision = expected.bySourceId.get(sourceRecordId);
      if (revision === undefined) {
        throw new InitialSourceRevisionEvidenceRecoveryError('EXTRA_EXISTING_REVISION');
      }
      return total + estimatedRevisionReadBytes(revision);
    }, 0);
    const lastSourceRecordId = uuid(pageResult.rows.at(-1)?.source_record_id);
    if (lastSourceRecordId === null) {
      throw new InitialSourceRevisionEvidenceRecoveryError('MALFORMED_EXISTING_REVISION');
    }
    afterSourceRecordId = lastSourceRecordId;
    readCount += pageResult.rows.length;
    observeBatchEvidence(
      observeReadBatchEvidence,
      pageResult.rows.length === 1 && pageBytes > REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT
        ? 'SINGLE_REVISION_EXCEEDS_64_KIB'
        : 'ALL_BATCHES_WITHIN_64_KIB',
    );
    if (pageResult.rows.length < pageBudget.limit) break;
  }
  if (readCount === 0) observeBatchEvidence(observeReadBatchEvidence, 'NO_PAYLOAD_BATCH');

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
