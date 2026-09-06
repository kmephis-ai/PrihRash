export interface InitialSourceRow {
  rowHint: number;
  digest: string;
}

export interface InitialSourceRecordCandidate {
  sourceOrdinal: number;
  rowHint: number;
  digest: string;
}

export function buildInitialSourceRecordCandidates(
  rows: readonly InitialSourceRow[],
): InitialSourceRecordCandidate[] {
  return rows.map((row, index) => ({
    sourceOrdinal: index,
    rowHint: row.rowHint,
    digest: row.digest,
  }));
}
