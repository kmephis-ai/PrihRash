import {
  EXPECTED_SOURCE_HEADERS,
  verifySourceHeaders,
} from './sourceSchema.js';
import {
  encodeGoogleExtendedValue,
  type GoogleExtendedValueInput,
  type SourceCellPayloadV2,
} from './sourceValueCodec.js';

export interface GoogleFullSourceSnapshotInput {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (GoogleExtendedValueInput | null | undefined)[])[];
}

export interface FullSourceSnapshotObservation {
  readonly snapshotDigest: string;
  readonly rowCount: number;
}

export interface FullSourceSnapshotDigest {
  digestCanonicalSnapshot(canonicalSnapshot: string): string;
}

export type FullSourceSnapshotErrorCode =
  | 'SOURCE_SCHEMA_MISMATCH'
  | 'SOURCE_ROW_WIDTH_MISMATCH'
  | 'INVALID_SNAPSHOT_DIGEST';

export class FullSourceSnapshotError extends Error {
  readonly code: FullSourceSnapshotErrorCode;

  constructor(code: FullSourceSnapshotErrorCode) {
    super(code);
    this.name = 'FullSourceSnapshotError';
    this.code = code;
  }
}

const FORMAT_VERSION = 'PRIHRASH_SOURCE_SNAPSHOT_V1';

function frame(value: string): string {
  return `${value.length}:${value}`;
}

function encodeCell(cell: SourceCellPayloadV2): string {
  if (cell === null) return 'N';
  if (cell.kind === 'STRING') return `S${frame(cell.value)}`;
  return `D${frame(cell.value)}`;
}

function canonicalSnapshot(input: Readonly<GoogleFullSourceSnapshotInput>): string {
  const schema = verifySourceHeaders(input.headers);
  if (!schema.ok) throw new FullSourceSnapshotError('SOURCE_SCHEMA_MISMATCH');

  const parts: string[] = [frame(FORMAT_VERSION), frame(String(EXPECTED_SOURCE_HEADERS.length))];
  for (const header of EXPECTED_SOURCE_HEADERS) parts.push(frame(header));
  parts.push(frame(String(input.rows.length)));

  for (const row of input.rows) {
    if (row.length !== EXPECTED_SOURCE_HEADERS.length) {
      throw new FullSourceSnapshotError('SOURCE_ROW_WIDTH_MISMATCH');
    }
    parts.push(frame(String(row.length)));
    for (const value of row) parts.push(frame(encodeCell(encodeGoogleExtendedValue(value))));
  }
  return parts.join('');
}

export function observeCanonicalFullSourceSnapshot(
  input: Readonly<GoogleFullSourceSnapshotInput>,
  digest: FullSourceSnapshotDigest,
): Readonly<FullSourceSnapshotObservation> {
  const canonical = canonicalSnapshot(input);
  const snapshotDigest = digest.digestCanonicalSnapshot(canonical);
  if (snapshotDigest.length === 0 || snapshotDigest !== snapshotDigest.trim()) {
    throw new FullSourceSnapshotError('INVALID_SNAPSHOT_DIGEST');
  }
  return Object.freeze({ snapshotDigest, rowCount: input.rows.length });
}
