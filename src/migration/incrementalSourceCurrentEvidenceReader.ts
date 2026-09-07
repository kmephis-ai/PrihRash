import type { SourceRowClassification } from '../classification/sourceRow.js';
import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { SOURCE_SHEET_NAME } from '../integration/google/sourceSchema.js';
import { utf8Parameter } from '../integration/ydb/parameters.js';
import type { VerifiedSourceRecordLineageEvidence } from './incrementalCommittedBaseline.js';
import type { IncrementalPreviousSourceCurrentEvidence } from './incrementalSourceCurrentCandidate.js';

interface SourceCurrentEvidenceRow {
  readonly id?: unknown;
  readonly source_type?: unknown;
  readonly source_sheet?: unknown;
  readonly first_seen_at?: unknown;
  readonly last_seen_at?: unknown;
  readonly last_row_hint?: unknown;
  readonly current_digest?: unknown;
  readonly state?: unknown;
  readonly classification?: unknown;
  readonly normalization_status?: unknown;
  readonly transaction_id?: unknown;
  readonly current_revision?: unknown;
  readonly resolution_code?: unknown;
  readonly resolved_at?: unknown;
  readonly resolved_by?: unknown;
}

export interface IncrementalSourceCurrentEvidenceSnapshot {
  readonly lineageRecords: readonly Readonly<VerifiedSourceRecordLineageEvidence>[];
  readonly sourceCurrent: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[];
}

export type IncrementalSourceCurrentEvidenceReaderErrorCode =
  | 'MALFORMED_SOURCE_CURRENT_EVIDENCE'
  | 'DUPLICATE_SOURCE_RECORD_ID';

export class IncrementalSourceCurrentEvidenceReaderError extends Error {
  readonly code: IncrementalSourceCurrentEvidenceReaderErrorCode;

  constructor(code: IncrementalSourceCurrentEvidenceReaderErrorCode) {
    super(code);
    this.name = 'IncrementalSourceCurrentEvidenceReaderError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CLASSIFICATIONS = new Set<SourceRowClassification>([
  'FINANCIAL_RECORD',
  'LEGACY_PERIOD_CLOSE',
  'NON_FINANCIAL',
  'INVALID',
  'AMBIGUOUS',
]);

function malformed(): never {
  throw new IncrementalSourceCurrentEvidenceReaderError('MALFORMED_SOURCE_CURRENT_EVIDENCE');
}

function requiredUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) malformed();
  return value.toLowerCase();
}

function optionalUuid(value: unknown): string | null {
  if (value === null) return null;
  return requiredUuid(value);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || !Number.isFinite(Date.parse(value))
  ) malformed();
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requiredTimestamp(value);
}

function positiveInteger(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) malformed();
    return Number(value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) malformed();
  return value;
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) malformed();
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return requiredText(value);
}

function parseClassification(value: unknown): SourceRowClassification {
  if (typeof value !== 'string' || !CLASSIFICATIONS.has(value as SourceRowClassification)) malformed();
  return value as SourceRowClassification;
}

function parseState(value: unknown): 'MISSING' | null {
  if (value === null) return null;
  if (value !== 'MISSING') malformed();
  return 'MISSING';
}

function assertResolutionAudit(
  resolutionCode: string | null,
  resolvedAt: string | null,
  resolvedBy: string | null,
): void {
  const populated = [resolutionCode, resolvedAt, resolvedBy].filter((value) => value !== null).length;
  if (populated !== 0 && populated !== 3) malformed();
}

function parseRow(row: Readonly<SourceCurrentEvidenceRow>): Readonly<IncrementalPreviousSourceCurrentEvidence> {
  const id = requiredUuid(row.id);
  if (row.source_type !== 'GOOGLE_SHEETS' || row.source_sheet !== SOURCE_SHEET_NAME) malformed();

  const firstSeenAt = requiredTimestamp(row.first_seen_at);
  const lastSeenAt = requiredTimestamp(row.last_seen_at);
  if (Date.parse(lastSeenAt) < Date.parse(firstSeenAt)) malformed();

  const resolutionCode = nullableText(row.resolution_code);
  const resolvedAt = optionalTimestamp(row.resolved_at);
  const resolvedBy = nullableText(row.resolved_by);
  assertResolutionAudit(resolutionCode, resolvedAt, resolvedBy);

  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: SOURCE_SHEET_NAME,
    firstSeenAt,
    lastSeenAt,
    lastRowHint: positiveInteger(row.last_row_hint),
    currentDigest: requiredText(row.current_digest),
    state: parseState(row.state),
    classification: parseClassification(row.classification),
    normalizationStatus: nullableText(row.normalization_status),
    transactionId: optionalUuid(row.transaction_id),
    currentRevision: positiveInteger(row.current_revision),
    resolutionCode,
    resolvedAt,
    resolvedBy,
  });
}

function lineageFrom(
  source: Readonly<IncrementalPreviousSourceCurrentEvidence>,
): Readonly<VerifiedSourceRecordLineageEvidence> {
  return Object.freeze({
    id: source.id,
    sourceType: source.sourceType,
    sourceSheet: source.sourceSheet,
    lastRowHint: source.lastRowHint,
    currentDigest: source.currentDigest,
    state: source.state,
    currentRevision: source.currentRevision,
  });
}

export async function readIncrementalSourceCurrentEvidence(
  reader: YdbReadScope,
): Promise<Readonly<IncrementalSourceCurrentEvidenceSnapshot>> {
  const statement = readStatement(
    'SELECT id, source_type, source_sheet, first_seen_at, last_seen_at, last_row_hint, '
      + 'CAST(current_digest AS Utf8) AS current_digest, state, classification, normalization_status, '
      + 'transaction_id, current_revision, resolution_code, resolved_at, resolved_by '
      + 'FROM source_records WHERE source_type = $source_type AND source_sheet = $source_sheet',
    {
      source_type: utf8Parameter('GOOGLE_SHEETS'),
      source_sheet: utf8Parameter(SOURCE_SHEET_NAME),
    },
  );
  const result = await reader.read<SourceCurrentEvidenceRow>(statement);

  const seen = new Set<string>();
  const sourceCurrent: Readonly<IncrementalPreviousSourceCurrentEvidence>[] = [];
  for (const row of result.rows) {
    const parsed = parseRow(row);
    if (seen.has(parsed.id)) {
      throw new IncrementalSourceCurrentEvidenceReaderError('DUPLICATE_SOURCE_RECORD_ID');
    }
    seen.add(parsed.id);
    sourceCurrent.push(parsed);
  }
  sourceCurrent.sort((left, right) => left.id.localeCompare(right.id));

  return Object.freeze({
    lineageRecords: Object.freeze(sourceCurrent.map(lineageFrom)),
    sourceCurrent: Object.freeze(sourceCurrent),
  });
}
