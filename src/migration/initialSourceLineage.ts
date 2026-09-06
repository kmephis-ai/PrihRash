import { ADAPTER_KEYS, SOURCE_SHEET_NAME, type AdapterKey } from '../integration/google/sourceSchema.js';
import {
  isCanonicalGoogleNumberText,
  type SourceCellPayloadV2,
} from '../integration/google/sourceValueCodec.js';
import type { InitialBootstrapCandidateEnvelope } from './initialBootstrapCandidate.js';
import type { RawPayloadV2 } from './rawPayloadDecoder.js';

export interface InitialSourcePayloadObservation {
  readonly sourceRecordId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface InitialSourceRecordProjection {
  readonly id: string;
  readonly sourceType: 'GOOGLE_SHEETS';
  readonly sourceSheet: typeof SOURCE_SHEET_NAME;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastRowHint: number;
  readonly currentDigest: string;
  readonly state: null;
  readonly classification: null;
  readonly normalizationStatus: null;
  readonly transactionId: null;
  readonly currentRevision: 1;
  readonly resolutionCode: null;
  readonly resolvedAt: null;
  readonly resolvedBy: null;
}

export interface InitialSourceRecordRevisionProjection {
  readonly sourceRecordId: string;
  readonly revision: 1;
  readonly migrationRunId: string;
  readonly observedAt: string;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly changeClass: null;
  readonly rawPayload: string;
}

export interface InitialSourceLineageProjection {
  readonly records: readonly Readonly<InitialSourceRecordProjection>[];
  readonly revisions: readonly Readonly<InitialSourceRecordRevisionProjection>[];
}

export type InitialSourceLineageErrorCode =
  | 'RUN_NOT_STAGING'
  | 'PAYLOAD_COUNT_MISMATCH'
  | 'DUPLICATE_PAYLOAD_SOURCE_ID'
  | 'UNKNOWN_PAYLOAD_SOURCE_ID'
  | 'MISSING_PAYLOAD_SOURCE_ID'
  | 'INVALID_PAYLOAD_SCHEMA'
  | 'INVALID_PAYLOAD_KEYS'
  | 'INVALID_PAYLOAD_VALUE';

export class InitialSourceLineageError extends Error {
  readonly code: InitialSourceLineageErrorCode;

  constructor(code: InitialSourceLineageErrorCode) {
    super(code);
    this.name = 'InitialSourceLineageError';
    this.code = code;
  }
}

const PAYLOAD_KEYS = ['adapter_schema_version', ...ADAPTER_KEYS] as const;

function normalizedCell(value: unknown): SourceCellPayloadV2 {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InitialSourceLineageError('INVALID_PAYLOAD_VALUE');
  }

  const cell = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(cell);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('value') || typeof cell.value !== 'string') {
    throw new InitialSourceLineageError('INVALID_PAYLOAD_VALUE');
  }

  if (cell.kind === 'STRING') {
    return Object.freeze({ kind: 'STRING' as const, value: cell.value });
  }
  if (cell.kind === 'NUMBER' && isCanonicalGoogleNumberText(cell.value)) {
    return Object.freeze({ kind: 'NUMBER' as const, value: cell.value });
  }
  throw new InitialSourceLineageError('INVALID_PAYLOAD_VALUE');
}

function normalizedPayload(payload: Readonly<Record<string, unknown>>): RawPayloadV2 {
  if (payload.adapter_schema_version !== 2) {
    throw new InitialSourceLineageError('INVALID_PAYLOAD_SCHEMA');
  }

  const keys = Object.keys(payload);
  if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((key) => keys.includes(key))) {
    throw new InitialSourceLineageError('INVALID_PAYLOAD_KEYS');
  }

  const normalized: Record<string, SourceCellPayloadV2 | 2> = { adapter_schema_version: 2 };
  for (const key of ADAPTER_KEYS) normalized[key] = normalizedCell(payload[key]);
  return Object.freeze(normalized) as RawPayloadV2;
}

function serializePayload(payload: Readonly<Record<string, unknown>>): string {
  const normalized = normalizedPayload(payload);
  const ordered: Record<string, SourceCellPayloadV2 | 2> = { adapter_schema_version: 2 };
  for (const key of ADAPTER_KEYS) ordered[key] = normalized[key];
  return JSON.stringify(ordered);
}

export function buildInitialSourceLineageProjection(
  envelope: Readonly<InitialBootstrapCandidateEnvelope>,
  observations: readonly InitialSourcePayloadObservation[],
): Readonly<InitialSourceLineageProjection> {
  if (envelope.run.state !== 'STAGING') {
    throw new InitialSourceLineageError('RUN_NOT_STAGING');
  }
  if (observations.length !== envelope.plan.candidates.length) {
    throw new InitialSourceLineageError('PAYLOAD_COUNT_MISMATCH');
  }

  const candidateIds = new Set(envelope.plan.candidates.map((candidate) => candidate.sourceRecordId));
  const payloadBySourceId = new Map<string, string>();

  for (const observation of observations) {
    const sourceRecordId = observation.sourceRecordId.toLowerCase();
    if (payloadBySourceId.has(sourceRecordId)) {
      throw new InitialSourceLineageError('DUPLICATE_PAYLOAD_SOURCE_ID');
    }
    if (!candidateIds.has(sourceRecordId)) {
      throw new InitialSourceLineageError('UNKNOWN_PAYLOAD_SOURCE_ID');
    }
    payloadBySourceId.set(sourceRecordId, serializePayload(observation.payload));
  }

  const records: Readonly<InitialSourceRecordProjection>[] = [];
  const revisions: Readonly<InitialSourceRecordRevisionProjection>[] = [];

  for (const candidate of envelope.plan.candidates) {
    const rawPayload = payloadBySourceId.get(candidate.sourceRecordId);
    if (rawPayload === undefined) {
      throw new InitialSourceLineageError('MISSING_PAYLOAD_SOURCE_ID');
    }

    records.push(Object.freeze({
      id: candidate.sourceRecordId,
      sourceType: 'GOOGLE_SHEETS' as const,
      sourceSheet: SOURCE_SHEET_NAME,
      firstSeenAt: envelope.snapshot.capturedAt,
      lastSeenAt: envelope.snapshot.capturedAt,
      lastRowHint: candidate.rowHint,
      currentDigest: candidate.digest,
      state: null,
      classification: null,
      normalizationStatus: null,
      transactionId: null,
      currentRevision: 1 as const,
      resolutionCode: null,
      resolvedAt: null,
      resolvedBy: null,
    }));

    revisions.push(Object.freeze({
      sourceRecordId: candidate.sourceRecordId,
      revision: 1 as const,
      migrationRunId: envelope.run.id,
      observedAt: envelope.snapshot.capturedAt,
      rowHint: candidate.rowHint,
      rowDigest: candidate.digest,
      changeClass: null,
      rawPayload,
    }));
  }

  return Object.freeze({
    records: Object.freeze(records),
    revisions: Object.freeze(revisions),
  });
}
