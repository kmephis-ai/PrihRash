import { ADAPTER_KEYS } from '../integration/google/sourceSchema.js';
import {
  isCanonicalGoogleNumberText,
  type SourceCellPayloadV2,
} from '../integration/google/sourceValueCodec.js';
import type { RawPayloadV2 } from './rawPayloadDecoder.js';

export type RawPayloadProvenanceErrorCode =
  | 'INVALID_PAYLOAD_SCHEMA'
  | 'INVALID_PAYLOAD_KEYS'
  | 'INVALID_PAYLOAD_VALUE';

export class RawPayloadProvenanceError extends Error {
  readonly code: RawPayloadProvenanceErrorCode;

  constructor(code: RawPayloadProvenanceErrorCode) {
    super(code);
    this.name = 'RawPayloadProvenanceError';
    this.code = code;
  }
}

const PAYLOAD_KEYS = ['adapter_schema_version', ...ADAPTER_KEYS] as const;

function normalizedCell(value: unknown): SourceCellPayloadV2 {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new RawPayloadProvenanceError('INVALID_PAYLOAD_VALUE');
  }

  const cell = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(cell);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('value') || typeof cell.value !== 'string') {
    throw new RawPayloadProvenanceError('INVALID_PAYLOAD_VALUE');
  }

  if (cell.kind === 'STRING') {
    return Object.freeze({ kind: 'STRING' as const, value: cell.value });
  }
  if (cell.kind === 'NUMBER' && isCanonicalGoogleNumberText(cell.value)) {
    return Object.freeze({ kind: 'NUMBER' as const, value: cell.value });
  }
  throw new RawPayloadProvenanceError('INVALID_PAYLOAD_VALUE');
}

export function normalizeRawPayloadV2(
  payload: Readonly<Record<string, unknown>>,
): RawPayloadV2 {
  if (payload.adapter_schema_version !== 2) {
    throw new RawPayloadProvenanceError('INVALID_PAYLOAD_SCHEMA');
  }

  const keys = Object.keys(payload);
  if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((key) => keys.includes(key))) {
    throw new RawPayloadProvenanceError('INVALID_PAYLOAD_KEYS');
  }

  const normalized: Record<string, SourceCellPayloadV2 | 2> = { adapter_schema_version: 2 };
  for (const key of ADAPTER_KEYS) normalized[key] = normalizedCell(payload[key]);
  return Object.freeze(normalized) as RawPayloadV2;
}

export function serializeRawPayloadV2(
  payload: Readonly<Record<string, unknown>>,
): string {
  const normalized = normalizeRawPayloadV2(payload);
  const ordered: Record<string, SourceCellPayloadV2 | 2> = { adapter_schema_version: 2 };
  for (const key of ADAPTER_KEYS) ordered[key] = normalized[key];
  return JSON.stringify(ordered);
}
