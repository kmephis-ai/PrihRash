import type { GoogleSheetsImmutableSnapshot } from '../integration/google/googleSheetsFullSnapshotReader.js';
import {
  ADAPTER_KEYS,
  CURRENT_SOURCE_ADAPTER_SCHEMA_VERSION,
} from '../integration/google/sourceSchema.js';
import { encodeGoogleExtendedValue } from '../integration/google/sourceValueCodec.js';
import type { RawPayload } from './rawPayloadDecoder.js';
import { normalizeRawPayload, serializeRawPayloadForLineageDigest } from './rawPayloadProvenance.js';
import type { CurrentSequenceRow } from './sequenceDiff.js';

export interface CanonicalSourceRowDigest {
  digestCanonicalRow(canonicalRow: string): string;
}

export interface IncrementalSourceObservationRow extends CurrentSequenceRow {
  readonly rawPayload: RawPayload;
}

export interface GoogleSnapshotMigrationProjection {
  readonly rows: readonly Readonly<IncrementalSourceObservationRow>[];
}

export type GoogleSnapshotProjectionErrorCode =
  | 'INVALID_ROW_HINT'
  | 'DUPLICATE_ROW_HINT'
  | 'SOURCE_ROW_WIDTH_MISMATCH'
  | 'INVALID_ROW_DIGEST';

export class GoogleSnapshotProjectionError extends Error {
  readonly code: GoogleSnapshotProjectionErrorCode;

  constructor(code: GoogleSnapshotProjectionErrorCode) {
    super(code);
    this.name = 'GoogleSnapshotProjectionError';
    this.code = code;
  }
}

function projectRawPayload(
  values: Readonly<GoogleSheetsImmutableSnapshot['rows'][number]['values']>,
): RawPayload {
  if (values.length !== ADAPTER_KEYS.length) {
    throw new GoogleSnapshotProjectionError('SOURCE_ROW_WIDTH_MISMATCH');
  }

  const payload: Record<string, unknown> = {
    adapter_schema_version: CURRENT_SOURCE_ADAPTER_SCHEMA_VERSION,
  };
  for (let index = 0; index < ADAPTER_KEYS.length; index += 1) {
    const key = ADAPTER_KEYS[index];
    if (key === undefined) {
      throw new GoogleSnapshotProjectionError('SOURCE_ROW_WIDTH_MISMATCH');
    }
    payload[key] = encodeGoogleExtendedValue(values[index]);
  }
  return normalizeRawPayload(payload);
}

export function projectGoogleSnapshotForIncrementalMigration(
  snapshot: Readonly<GoogleSheetsImmutableSnapshot>,
  digest: CanonicalSourceRowDigest,
): Readonly<GoogleSnapshotMigrationProjection> {
  const rowHints = new Set<number>();
  const rows: Readonly<IncrementalSourceObservationRow>[] = [];

  for (const row of snapshot.rows) {
    if (!Number.isSafeInteger(row.rowHint) || row.rowHint < 2) {
      throw new GoogleSnapshotProjectionError('INVALID_ROW_HINT');
    }
    if (rowHints.has(row.rowHint)) {
      throw new GoogleSnapshotProjectionError('DUPLICATE_ROW_HINT');
    }
    rowHints.add(row.rowHint);

    const rawPayload = projectRawPayload(row.values);
    const canonicalRow = serializeRawPayloadForLineageDigest(rawPayload);
    const rowDigest = digest.digestCanonicalRow(canonicalRow);
    if (typeof rowDigest !== 'string' || rowDigest.trim().length === 0) {
      throw new GoogleSnapshotProjectionError('INVALID_ROW_DIGEST');
    }

    rows.push(Object.freeze({
      rowHint: row.rowHint,
      digest: rowDigest,
      rawPayload,
    }));
  }

  return Object.freeze({ rows: Object.freeze(rows) });
}
