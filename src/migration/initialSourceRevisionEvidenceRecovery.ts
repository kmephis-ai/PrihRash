import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { ydbTimestampReadbackMatches } from '../integration/ydb/readbackTimestamp.js';
import { uint64Parameter, uuidParameter } from '../integration/ydb/parameters.js';
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
// 300 UUID placeholders keep the generated read below the existing 8 KiB pre-live
// query safety margin while cutting recovery/resume provider round-trips sixfold.
const INITIAL_REVISION_EVIDENCE_READ_KEYS_PER_QUERY_LIMIT = 300;

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

function existingMatches(
  row: Readonly<ExistingInitialRevisionRow>,
  expected: Readonly<InitialSourceRecordRevisionProjection>,
): boolean {
  return positiveInteger(row.revision) === 1
    && uuid(row.migration_run_id) === expected.migrationRunId.toLowerCase()
    && ydbTimestampReadbackMatches(row.observed_at, expected.observedAt)
    && positiveInteger(row.row_hint) === expected.rowHint
    && digestString(row.row_digest) === expected.rowDigest
    && row.change_class === null
    && canonicalRawPayload(row.raw_payload) === expected.rawPayload;
}

function validateExistingRevisionRows(
  rows: readonly Readonly<ExistingInitialRevisionRow>[],
  expected: Readonly<{
    runId: string | null;
    bySourceId: ReadonlyMap<string, Readonly<InitialSourceRecordRevisionProjection>>;
  }>,
  existingSourceIds: Set<string>,
): void {
  for (const row of rows) {
    const sourceRecordId = uuid(row.source_record_id);
    if (existingSourceIds.has(sourceRecordId)) {
      throw new InitialSourceRevisionEvidenceRecoveryError('DUPLICATE_EXISTING_REVISION');
    }
    existingSourceIds.add(sourceRecordId);
    const expectedRevision = expected.bySourceId.get(sourceRecordId);
    if (expectedRevision === undefined) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXTRA_EXISTING_REVISION');
    }
    if (!existingMatches(row, expectedRevision)) {
      throw new InitialSourceRevisionEvidenceRecoveryError('EXISTING_REVISION_MISMATCH');
    }
  }
}

function primaryKeyReadStatement(
  revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[],
  runId: string | null,
) {
  const sourceIdParameters = Object.fromEntries(
    revisions.map((revision, index) => [
      `source_record_id_${index}`,
      uuidParameter(revision.sourceRecordId),
    ]),
  );
  const sourceIdPlaceholders = revisions
    .map((_, index) => `$source_record_id_${index}`)
    .join(', ');
  const runPredicate = runId === null ? '' : 'migration_run_id = $migration_run_id OR ';
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class, raw_payload '
      + 'FROM source_record_revisions '
      + `WHERE revision = $revision AND (${runPredicate}source_record_id IN (${sourceIdPlaceholders}))`,
    {
      revision: uint64Parameter(1),
      ...(runId === null ? {} : { migration_run_id: uuidParameter(runId) }),
      ...sourceIdParameters,
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
  const firstBatch = expectedRevisions.slice(0, INITIAL_REVISION_EVIDENCE_READ_KEYS_PER_QUERY_LIMIT);
  const firstResult = await reader.read<ExistingInitialRevisionRow>(
    primaryKeyReadStatement(firstBatch, expected.runId),
  );
  validateExistingRevisionRows(firstResult.rows, expected, existingSourceIds);

  const uncheckedMissing = expectedRevisions
    .slice(INITIAL_REVISION_EVIDENCE_READ_KEYS_PER_QUERY_LIMIT)
    .filter((revision) => !existingSourceIds.has(revision.sourceRecordId.toLowerCase()));
  for (
    let start = 0;
    start < uncheckedMissing.length;
    start += INITIAL_REVISION_EVIDENCE_READ_KEYS_PER_QUERY_LIMIT
  ) {
    const batch = uncheckedMissing.slice(
      start,
      start + INITIAL_REVISION_EVIDENCE_READ_KEYS_PER_QUERY_LIMIT,
    );
    const result = await reader.read<ExistingInitialRevisionRow>(
      primaryKeyReadStatement(batch, null),
    );
    validateExistingRevisionRows(result.rows, expected, existingSourceIds);
  }

  const missingRevisions = expectedRevisions.filter(
    (revision) => !existingSourceIds.has(revision.sourceRecordId.toLowerCase()),
  );
  return Object.freeze({
    existingSourceRecordIds: Object.freeze([...existingSourceIds].sort()),
    missingRevisions: Object.freeze([...missingRevisions]),
  });
}
