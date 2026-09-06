export type LegacyPeriodCloseMarkerKind =
  | 'POSITIVE'
  | 'CREDIT'
  | 'NEGATIVE'
  | 'VIKA'
  | 'LOAN'
  | 'BALANCE';

export type LegacyPeriodCloseClassification =
  | 'LEGACY_PERIOD_CLOSE'
  | 'AMBIGUOUS'
  | 'NOT_APPLICABLE';

export interface LegacyPeriodCloseSourceRow {
  snapshotOrdinal: number;
  sourceDay: string | null;
  operationType: string | null;
  expenseAccount: string | null;
  expenseAmountMinor: number | null;
  description: string | null;
}

export interface LegacyPeriodCloseRowResult {
  snapshotOrdinal: number;
  markerKind: LegacyPeriodCloseMarkerKind | null;
  classification: LegacyPeriodCloseClassification;
}

const MARKER_BY_DESCRIPTION = new Map<string, LegacyPeriodCloseMarkerKind>([
  ['Плюсовые позиции', 'POSITIVE'],
  ['Кредитки', 'CREDIT'],
  ['Кредитка', 'CREDIT'],
  ['Кредитки 2', 'CREDIT'],
  ['Минусовые позиции', 'NEGATIVE'],
  ['Вика Красное', 'VIKA'],
  ['Вика красное', 'VIKA'],
  ['Возврат займа', 'LOAN'],
  ['Текущий баланс', 'BALANCE'],
  ['Текущий баланс счета', 'BALANCE'],
]);

const REQUIRED_MARKERS = new Set<LegacyPeriodCloseMarkerKind>([
  'BALANCE',
  'NEGATIVE',
  'VIKA',
]);

const QUALIFYING_OPTIONAL_MARKERS = new Set<LegacyPeriodCloseMarkerKind>([
  'POSITIVE',
  'CREDIT',
]);

const MAX_MARKER_ORDINAL_GAP = 2;

interface Candidate {
  snapshotOrdinal: number;
  sourceDay: string;
  markerKind: LegacyPeriodCloseMarkerKind;
}

export function recognizeLegacyPeriodCloseMarker(
  description: string | null,
): LegacyPeriodCloseMarkerKind | null {
  return description === null ? null : (MARKER_BY_DESCRIPTION.get(description) ?? null);
}

function isQualifyingCluster(cluster: readonly Candidate[]): boolean {
  const kinds = new Set(cluster.map((item) => item.markerKind));
  for (const required of REQUIRED_MARKERS) {
    if (!kinds.has(required)) return false;
  }
  return [...QUALIFYING_OPTIONAL_MARKERS].some((kind) => kinds.has(kind));
}

function splitByTightSequence(candidates: readonly Candidate[]): Candidate[][] {
  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((left, right) => left.snapshotOrdinal - right.snapshotOrdinal);
  const clusters: Candidate[][] = [];
  let current: Candidate[] = [];
  let previousOrdinal: number | null = null;

  for (const candidate of sorted) {
    if (
      previousOrdinal !== null
      && candidate.snapshotOrdinal - previousOrdinal > MAX_MARKER_ORDINAL_GAP
    ) {
      clusters.push(current);
      current = [];
    }
    current.push(candidate);
    previousOrdinal = candidate.snapshotOrdinal;
  }

  if (current.length > 0) clusters.push(current);
  return clusters;
}

export function classifyLegacyPeriodCloseRows(
  rows: readonly LegacyPeriodCloseSourceRow[],
): LegacyPeriodCloseRowResult[] {
  const resultByOrdinal = new Map<number, LegacyPeriodCloseRowResult>();
  const candidatesByDay = new Map<string, Candidate[]>();

  for (const row of rows) {
    const markerKind = recognizeLegacyPeriodCloseMarker(row.description);
    const defaultResult: LegacyPeriodCloseRowResult = {
      snapshotOrdinal: row.snapshotOrdinal,
      markerKind,
      classification: 'NOT_APPLICABLE',
    };
    resultByOrdinal.set(row.snapshotOrdinal, defaultResult);

    if (markerKind === null || row.expenseAmountMinor !== 0) continue;

    if (
      row.operationType !== 'Расход'
      || row.expenseAccount !== 'Карта Visa'
      || row.sourceDay === null
    ) {
      resultByOrdinal.set(row.snapshotOrdinal, {
        snapshotOrdinal: row.snapshotOrdinal,
        markerKind,
        classification: 'AMBIGUOUS',
      });
      continue;
    }

    const candidates = candidatesByDay.get(row.sourceDay) ?? [];
    candidates.push({
      snapshotOrdinal: row.snapshotOrdinal,
      sourceDay: row.sourceDay,
      markerKind,
    });
    candidatesByDay.set(row.sourceDay, candidates);
  }

  for (const candidates of candidatesByDay.values()) {
    for (const cluster of splitByTightSequence(candidates)) {
      const classification: LegacyPeriodCloseClassification = isQualifyingCluster(cluster)
        ? 'LEGACY_PERIOD_CLOSE'
        : 'AMBIGUOUS';

      for (const candidate of cluster) {
        resultByOrdinal.set(candidate.snapshotOrdinal, {
          snapshotOrdinal: candidate.snapshotOrdinal,
          markerKind: candidate.markerKind,
          classification,
        });
      }
    }
  }

  return rows.map((row) => resultByOrdinal.get(row.snapshotOrdinal) ?? {
    snapshotOrdinal: row.snapshotOrdinal,
    markerKind: null,
    classification: 'NOT_APPLICABLE',
  });
}
