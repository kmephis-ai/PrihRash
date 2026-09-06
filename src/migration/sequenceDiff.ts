export interface PreviousSequenceRow {
  sourceRecordId: string;
  rowHint: number;
  digest: string;
}

export interface CurrentSequenceRow {
  rowHint: number;
  digest: string;
}

export type SequenceDiffOperation =
  | {
      kind: 'UNCHANGED';
      sourceRecordId: string;
      previousRowHint: number;
      currentRowHint: number;
      digest: string;
    }
  | {
      kind: 'INSERTED';
      currentRowHint: number;
      digest: string;
    }
  | {
      kind: 'MISSING';
      sourceRecordId: string;
      previousRowHint: number;
      digest: string;
    }
  | {
      kind: 'REVISED';
      sourceRecordId: string;
      previousRowHint: number;
      currentRowHint: number;
      previousDigest: string;
      currentDigest: string;
    }
  | {
      kind: 'AMBIGUOUS_BLOCK';
      previousSourceRecordIds: string[];
      previousRowHints: number[];
      currentRowHints: number[];
    };

interface Anchor {
  previousIndex: number;
  currentIndex: number;
}

function countDigests(rows: readonly { digest: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.digest, (counts.get(row.digest) ?? 0) + 1);
  return counts;
}

function ambiguousWholeSnapshot(
  previous: readonly PreviousSequenceRow[],
  current: readonly CurrentSequenceRow[],
): SequenceDiffOperation[] {
  return [{
    kind: 'AMBIGUOUS_BLOCK',
    previousSourceRecordIds: previous.map((row) => row.sourceRecordId),
    previousRowHints: previous.map((row) => row.rowHint),
    currentRowHints: current.map((row) => row.rowHint),
  }];
}

export function diffSequences(
  previous: readonly PreviousSequenceRow[],
  current: readonly CurrentSequenceRow[],
): SequenceDiffOperation[] {
  if (previous.length === current.length && previous.every((row, index) => row.digest === current[index]?.digest)) {
    return previous.map((row, index) => ({
      kind: 'UNCHANGED' as const,
      sourceRecordId: row.sourceRecordId,
      previousRowHint: row.rowHint,
      currentRowHint: current[index]?.rowHint ?? row.rowHint,
      digest: row.digest,
    }));
  }

  const previousCounts = countDigests(previous);
  const currentCounts = countDigests(current);
  const currentUniqueIndex = new Map<string, number>();
  current.forEach((row, index) => {
    if (currentCounts.get(row.digest) === 1) currentUniqueIndex.set(row.digest, index);
  });

  const anchors: Anchor[] = [];
  previous.forEach((row, previousIndex) => {
    if (previousCounts.get(row.digest) !== 1 || currentCounts.get(row.digest) !== 1) return;
    const currentIndex = currentUniqueIndex.get(row.digest);
    if (currentIndex !== undefined) anchors.push({ previousIndex, currentIndex });
  });

  for (let index = 1; index < anchors.length; index += 1) {
    if ((anchors[index - 1]?.currentIndex ?? -1) >= (anchors[index]?.currentIndex ?? -1)) {
      return ambiguousWholeSnapshot(previous, current);
    }
  }

  const operations: SequenceDiffOperation[] = [];
  const sentinels: Anchor[] = [
    { previousIndex: -1, currentIndex: -1 },
    ...anchors,
    { previousIndex: previous.length, currentIndex: current.length },
  ];

  for (let anchorIndex = 1; anchorIndex < sentinels.length; anchorIndex += 1) {
    const left = sentinels[anchorIndex - 1];
    const right = sentinels[anchorIndex];
    if (left === undefined || right === undefined) continue;

    const previousSegment = previous.slice(left.previousIndex + 1, right.previousIndex);
    const currentSegment = current.slice(left.currentIndex + 1, right.currentIndex);

    if (previousSegment.length === 0 && currentSegment.length > 0) {
      for (const row of currentSegment) {
        operations.push({ kind: 'INSERTED', currentRowHint: row.rowHint, digest: row.digest });
      }
    } else if (previousSegment.length > 0 && currentSegment.length === 0) {
      for (const row of previousSegment) {
        operations.push({
          kind: 'MISSING',
          sourceRecordId: row.sourceRecordId,
          previousRowHint: row.rowHint,
          digest: row.digest,
        });
      }
    } else if (previousSegment.length === 1 && currentSegment.length === 1) {
      const oldRow = previousSegment[0];
      const newRow = currentSegment[0];
      if (oldRow !== undefined && newRow !== undefined) {
        operations.push({
          kind: 'REVISED',
          sourceRecordId: oldRow.sourceRecordId,
          previousRowHint: oldRow.rowHint,
          currentRowHint: newRow.rowHint,
          previousDigest: oldRow.digest,
          currentDigest: newRow.digest,
        });
      }
    } else if (previousSegment.length > 0 || currentSegment.length > 0) {
      operations.push({
        kind: 'AMBIGUOUS_BLOCK',
        previousSourceRecordIds: previousSegment.map((row) => row.sourceRecordId),
        previousRowHints: previousSegment.map((row) => row.rowHint),
        currentRowHints: currentSegment.map((row) => row.rowHint),
      });
    }

    if (right.previousIndex < previous.length && right.currentIndex < current.length) {
      const oldAnchor = previous[right.previousIndex];
      const newAnchor = current[right.currentIndex];
      if (oldAnchor !== undefined && newAnchor !== undefined) {
        operations.push({
          kind: 'UNCHANGED',
          sourceRecordId: oldAnchor.sourceRecordId,
          previousRowHint: oldAnchor.rowHint,
          currentRowHint: newAnchor.rowHint,
          digest: oldAnchor.digest,
        });
      }
    }
  }

  return operations;
}
