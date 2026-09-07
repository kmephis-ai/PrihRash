import type { GoogleSnapshotMigrationProjection } from './googleSnapshotProjection.js';
import type { IncrementalCurrentObservationInput } from './incrementalCurrentObservationSemantics.js';

export type IncrementalCurrentObservationHandoffErrorCode =
  | 'INVALID_CURRENT_ROW_HINT'
  | 'DUPLICATE_CURRENT_ROW_HINT';

export class IncrementalCurrentObservationHandoffError extends Error {
  readonly code: IncrementalCurrentObservationHandoffErrorCode;

  constructor(code: IncrementalCurrentObservationHandoffErrorCode) {
    super(code);
    this.name = 'IncrementalCurrentObservationHandoffError';
    this.code = code;
  }
}

export function buildIncrementalCurrentObservationInputs(
  projection: Readonly<GoogleSnapshotMigrationProjection>,
): readonly Readonly<IncrementalCurrentObservationInput>[] {
  const rowHints = new Set<number>();
  const observations: Readonly<IncrementalCurrentObservationInput>[] = [];

  for (let sourceOrdinal = 0; sourceOrdinal < projection.rows.length; sourceOrdinal += 1) {
    const row = projection.rows[sourceOrdinal];
    if (row === undefined || !Number.isSafeInteger(row.rowHint) || row.rowHint < 2) {
      throw new IncrementalCurrentObservationHandoffError('INVALID_CURRENT_ROW_HINT');
    }
    if (rowHints.has(row.rowHint)) {
      throw new IncrementalCurrentObservationHandoffError('DUPLICATE_CURRENT_ROW_HINT');
    }
    rowHints.add(row.rowHint);

    observations.push(Object.freeze({
      currentRowHint: row.rowHint,
      sourceOrdinal,
      rawPayload: row.rawPayload,
    }));
  }

  return Object.freeze(observations);
}
