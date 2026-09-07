import { SOURCE_SHEET_NAME } from '../integration/google/sourceSchema.js';
import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { utf8Parameter } from '../integration/ydb/parameters.js';
import type { RawPayloadV2 } from './rawPayloadDecoder.js';
import { normalizeRawPayloadV2 } from './rawPayloadProvenance.js';
import type { IncrementalPreviousRevisionEvidence } from './incrementalRevisionEvidence.js';
import type { IncrementalPreviousSourceCurrentEvidence } from './incrementalSourceCurrentCandidate.js';

interface CurrentRevisionEvidenceRow {
  readonly source_record_id?: unknown;
  readonly revision?: unknown;
  readonly migration_run_id?: unknown;
  readonly observed_at?: unknown;
  readonly row_hint?: unknown;
  readonly row_digest?: unknown;
  readonly change_class?: unknown;
  readonly raw_payload?: unknown;
}

export interface IncrementalCurrentRevisionPayloadEvidence {
  readonly sourceRecordId: string;
  readonly revision: number;
  readonly migrationRunId: string;
  readonly observedAt: string;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly changeClass: 'WORKFLOW_TRANSFORM' | 'OWNER_CORRECTION' | 'AMBIGUOUS_CHANGE' | null;
  readonly rawPayload: RawPayloadV2;
}

export interface IncrementalCurrentRevisionEvidenceSnapshot {
  readonly previousRevisionEvidence: readonly Readonly<IncrementalPreviousRevisionEvidence>[];
  readonly currentRevisionPayloads: readonly Readonly<IncrementalCurrentRevisionPayloadEvidence>[];
}

export type IncrementalCurrentRevisionEvidenceReaderErrorCode =
  | 'INVALID_SOURCE_EVIDENCE'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'MALFORMED_CURRENT_REVISION_EVIDENCE'
  | 'DUPLICATE_CURRENT_REVISION_EVIDENCE'
  | 'MISSING_CURRENT_REVISION_EVIDENCE'
  | 'EXTRA_CURRENT_REVISION_EVIDENCE'
  | 'CURRENT_REVISION_EVIDENCE_MISMATCH';

export class IncrementalCurrentRevisionEvidenceReaderError extends Error {
  readonly code: IncrementalCurrentRevisionEvidenceReaderErrorCode;

  constructor(code: IncrementalCurrentRevisionEvidenceReaderErrorCode) {
    super(code);
    this.name = 'IncrementalCurrentRevisionEvidenceReaderError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CHANGE_CLASSES = new Set(['WORKFLOW_TRANSFORM', 'OWNER_CORRECTION', 'AMBIGUOUS_CHANGE']);

function malformed(): never {
  throw new IncrementalCurrentRevisionEvidenceReaderError('MALFORMED_CURRENT_REVISION_EVIDENCE');
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

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || !Number.isFinite(Date.parse(value))) malformed();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) malformed();
  return value;
}

function changeClass(value: unknown): IncrementalCurrentRevisionPayloadEvidence['changeClass'] {
  if (value === null) return null;
  if (typeof value !== 'string' || !CHANGE_CLASSES.has(value)) malformed();
  return value as Exclude<IncrementalCurrentRevisionPayloadEvidence['changeClass'], null>;
}

function rawPayload(value: unknown): RawPayloadV2 {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      malformed();
    }
  }
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) malformed();
  try {
    return normalizeRawPayloadV2(candidate as Readonly<Record<string, unknown>>);
  } catch {
    malformed();
  }
}

function sourceMap(
  sources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousSourceCurrentEvidence>> {
  const byId = new Map<string, Readonly<IncrementalPreviousSourceCurrentEvidence>>();
  for (const source of sources) {
    if (!UUID_PATTERN.test(source.id) || !Number.isSafeInteger(source.currentRevision) || source.currentRevision < 1
      || !Number.isSafeInteger(source.lastRowHint) || source.lastRowHint < 1 || source.currentDigest.trim().length === 0) {
      throw new IncrementalCurrentRevisionEvidenceReaderError('INVALID_SOURCE_EVIDENCE');
    }
    const id = source.id.toLowerCase();
    if (byId.has(id)) throw new IncrementalCurrentRevisionEvidenceReaderError('DUPLICATE_SOURCE_RECORD_ID');
    byId.set(id, source);
  }
  return byId;
}

function parseRow(row: Readonly<CurrentRevisionEvidenceRow>): Readonly<IncrementalCurrentRevisionPayloadEvidence> {
  return Object.freeze({
    sourceRecordId: uuid(row.source_record_id),
    revision: positiveInteger(row.revision),
    migrationRunId: uuid(row.migration_run_id),
    observedAt: timestamp(row.observed_at),
    rowHint: positiveInteger(row.row_hint),
    rowDigest: digest(row.row_digest),
    changeClass: changeClass(row.change_class),
    rawPayload: rawPayload(row.raw_payload),
  });
}

export async function readIncrementalCurrentRevisionEvidence(
  adapter: YdbAdapter,
  sources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
): Promise<Readonly<IncrementalCurrentRevisionEvidenceSnapshot>> {
  const expectedById = sourceMap(sources);
  const statement = readStatement(
    'SELECT r.source_record_id, r.revision, r.migration_run_id, r.observed_at, r.row_hint, '
      + 'CAST(r.row_digest AS Utf8) AS row_digest, r.change_class, r.raw_payload '
      + 'FROM source_record_revisions AS r JOIN source_records AS s '
      + 'ON s.id = r.source_record_id AND s.current_revision = r.revision '
      + 'WHERE s.source_type = $source_type AND s.source_sheet = $source_sheet',
    {
      source_type: utf8Parameter('GOOGLE_SHEETS'),
      source_sheet: utf8Parameter(SOURCE_SHEET_NAME),
    },
  );
  const result = await adapter.read<CurrentRevisionEvidenceRow>(statement);

  const byId = new Map<string, Readonly<IncrementalCurrentRevisionPayloadEvidence>>();
  for (const row of result.rows) {
    const parsed = parseRow(row);
    if (byId.has(parsed.sourceRecordId)) {
      throw new IncrementalCurrentRevisionEvidenceReaderError('DUPLICATE_CURRENT_REVISION_EVIDENCE');
    }
    const source = expectedById.get(parsed.sourceRecordId);
    if (source === undefined) {
      throw new IncrementalCurrentRevisionEvidenceReaderError('EXTRA_CURRENT_REVISION_EVIDENCE');
    }
    if (
      parsed.revision !== source.currentRevision
      || parsed.rowHint !== source.lastRowHint
      || parsed.rowDigest !== source.currentDigest
    ) {
      throw new IncrementalCurrentRevisionEvidenceReaderError('CURRENT_REVISION_EVIDENCE_MISMATCH');
    }
    byId.set(parsed.sourceRecordId, parsed);
  }

  for (const sourceRecordId of expectedById.keys()) {
    if (!byId.has(sourceRecordId)) {
      throw new IncrementalCurrentRevisionEvidenceReaderError('MISSING_CURRENT_REVISION_EVIDENCE');
    }
  }

  const currentRevisionPayloads = [...byId.values()].sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
  const previousRevisionEvidence = currentRevisionPayloads.map((item) => Object.freeze({
    sourceRecordId: item.sourceRecordId,
    currentRevision: item.revision,
  }));

  return Object.freeze({
    previousRevisionEvidence: Object.freeze(previousRevisionEvidence),
    currentRevisionPayloads: Object.freeze(currentRevisionPayloads),
  });
}
