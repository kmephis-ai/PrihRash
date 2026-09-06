export interface InitialSourceRow {
  readonly sourceRecordId: string;
  readonly rowHint: number;
  readonly digest: string;
}

export interface InitialSourceRecordCandidate {
  readonly sourceRecordId: string;
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly digest: string;
}

export interface InitialBootstrapCounters {
  readonly rowsSeen: number;
  readonly rowsNew: number;
  readonly rowsChanged: 0;
  readonly rowsMissing: 0;
  readonly rowsAmbiguous: 0;
}

export interface InitialBootstrapPlan {
  readonly candidates: readonly InitialSourceRecordCandidate[];
  readonly counters: Readonly<InitialBootstrapCounters>;
}

export type InitialBootstrapErrorCode =
  | 'INVALID_SOURCE_RECORD_ID'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'INVALID_ROW_HINT'
  | 'DUPLICATE_ROW_HINT'
  | 'EMPTY_DIGEST';

export class InitialBootstrapError extends Error {
  readonly code: InitialBootstrapErrorCode;

  constructor(code: InitialBootstrapErrorCode) {
    super(code);
    this.name = 'InitialBootstrapError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function validateInitialRows(rows: readonly InitialSourceRow[]): void {
  const sourceRecordIds = new Set<string>();
  const rowHints = new Set<number>();

  for (const row of rows) {
    if (!UUID_PATTERN.test(row.sourceRecordId)) {
      throw new InitialBootstrapError('INVALID_SOURCE_RECORD_ID');
    }

    const normalizedId = row.sourceRecordId.toLowerCase();
    if (sourceRecordIds.has(normalizedId)) {
      throw new InitialBootstrapError('DUPLICATE_SOURCE_RECORD_ID');
    }
    sourceRecordIds.add(normalizedId);

    if (!Number.isSafeInteger(row.rowHint) || row.rowHint <= 0) {
      throw new InitialBootstrapError('INVALID_ROW_HINT');
    }
    if (rowHints.has(row.rowHint)) {
      throw new InitialBootstrapError('DUPLICATE_ROW_HINT');
    }
    rowHints.add(row.rowHint);

    if (row.digest.trim().length === 0) {
      throw new InitialBootstrapError('EMPTY_DIGEST');
    }
  }
}

export function buildInitialSourceRecordCandidates(
  rows: readonly InitialSourceRow[],
): InitialSourceRecordCandidate[] {
  validateInitialRows(rows);

  return rows.map((row, index) => ({
    sourceRecordId: row.sourceRecordId.toLowerCase(),
    sourceOrdinal: index,
    rowHint: row.rowHint,
    digest: row.digest,
  }));
}

export function buildInitialBootstrapPlan(rows: readonly InitialSourceRow[]): Readonly<InitialBootstrapPlan> {
  const candidates = buildInitialSourceRecordCandidates(rows).map((candidate) => Object.freeze(candidate));
  const rowCount = candidates.length;

  return Object.freeze({
    candidates: Object.freeze(candidates),
    counters: Object.freeze({
      rowsSeen: rowCount,
      rowsNew: rowCount,
      rowsChanged: 0 as const,
      rowsMissing: 0 as const,
      rowsAmbiguous: 0 as const,
    }),
  });
}
