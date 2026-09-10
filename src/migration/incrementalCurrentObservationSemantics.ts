import type {
  CanonicalTransaction,
  DatePrecision,
  RecordGranularity,
} from '../domain/transaction.js';
import type { ReferenceResolver } from '../normalization/types.js';
import {
  projectFinancialTransaction,
  type FinancialProjectionErrorCode,
} from './financialProjection.js';
import type { IncrementalSourceDeltaIntentPlan } from './incrementalSourceDeltaIntent.js';
import type { RawPayloadDecodeErrorCode, RawPayload } from './rawPayloadDecoder.js';
import {
  classifySourceSnapshot,
  type SourceSnapshotClassificationOutcome,
} from './sourceSnapshotClassification.js';

export interface IncrementalCurrentObservationInput {
  readonly currentRowHint: number;
  readonly sourceOrdinal: number;
  readonly rawPayload: RawPayload;
}

export interface IncrementalPreviousFinancialQualityEvidence {
  readonly sourceRecordId: string;
  readonly recordGranularity: RecordGranularity;
  readonly datePrecision: DatePrecision;
  readonly aggregatePeriodMonth: string | null;
}

export type IncrementalObservationFinancialProjection =
  | Readonly<{
      status: 'NOT_EVALUATED';
      reason: 'TOUCH_NO_REVISION' | 'UNRESOLVED_LINEAGE' | 'NOT_FINANCIAL_RECORD';
    }>
  | Readonly<{
      status: 'BLOCKED';
      reason: 'PREVIOUS_FINANCIAL_QUALITY_REQUIRED';
    }>
  | Readonly<{
      status: 'FAILED';
      stage: 'DECODE' | 'GRANULARITY' | 'NORMALIZATION' | 'DOMAIN';
      errorCode: FinancialProjectionErrorCode;
    }>
  | Readonly<{
      status: 'CANDIDATE';
      transaction: Readonly<CanonicalTransaction>;
    }>;

export interface IncrementalCurrentObservationSemanticOutcome {
  readonly currentRowHint: number;
  readonly sourceOrdinal: number;
  readonly sourceRecordId: string | null;
  readonly lineageKind: 'TOUCH' | 'CREATE' | 'REVISE' | 'UNRESOLVED';
  readonly classification: SourceSnapshotClassificationOutcome['classification'];
  readonly legacyPeriodCloseClassification: SourceSnapshotClassificationOutcome['legacyPeriodCloseClassification'];
  readonly decodeErrorCode: RawPayloadDecodeErrorCode | null;
  readonly financialProjection: IncrementalObservationFinancialProjection;
}

export interface IncrementalCurrentObservationSemanticPlan {
  readonly outcomes: readonly Readonly<IncrementalCurrentObservationSemanticOutcome>[];
}

export type IncrementalCurrentObservationSemanticErrorCode =
  | 'INVALID_CURRENT_ROW_HINT'
  | 'DUPLICATE_CURRENT_ROW_HINT'
  | 'DUPLICATE_INTENT_CURRENT_ROW_HINT'
  | 'CURRENT_ROW_COVERAGE_MISMATCH'
  | 'DUPLICATE_FINANCIAL_QUALITY_SOURCE_ID'
  | 'EXTRA_FINANCIAL_QUALITY_EVIDENCE'
  | 'INVALID_FINANCIAL_QUALITY_EVIDENCE';

export class IncrementalCurrentObservationSemanticError extends Error {
  readonly code: IncrementalCurrentObservationSemanticErrorCode;

  constructor(code: IncrementalCurrentObservationSemanticErrorCode) {
    super(code);
    this.name = 'IncrementalCurrentObservationSemanticError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const AGGREGATE_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function validateCurrentRows(rows: readonly IncrementalCurrentObservationInput[]): void {
  const hints = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.currentRowHint) || row.currentRowHint < 1) {
      throw new IncrementalCurrentObservationSemanticError('INVALID_CURRENT_ROW_HINT');
    }
    if (hints.has(row.currentRowHint)) {
      throw new IncrementalCurrentObservationSemanticError('DUPLICATE_CURRENT_ROW_HINT');
    }
    hints.add(row.currentRowHint);
  }
}

function expectedCurrentLinkage(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
): ReadonlyMap<number, Readonly<{ sourceRecordId: string | null; lineageKind: 'TOUCH' | 'CREATE' | 'REVISE' | 'UNRESOLVED' }>> {
  const byHint = new Map<number, Readonly<{ sourceRecordId: string | null; lineageKind: 'TOUCH' | 'CREATE' | 'REVISE' | 'UNRESOLVED' }>>();
  const add = (
    currentRowHint: number,
    sourceRecordId: string | null,
    lineageKind: 'TOUCH' | 'CREATE' | 'REVISE' | 'UNRESOLVED',
  ) => {
    if (byHint.has(currentRowHint)) {
      throw new IncrementalCurrentObservationSemanticError('DUPLICATE_INTENT_CURRENT_ROW_HINT');
    }
    byHint.set(currentRowHint, Object.freeze({ sourceRecordId, lineageKind }));
  };

  for (const intent of deltaPlan.intents) {
    if (intent.kind === 'MARK_MISSING') continue;
    add(intent.currentRowHint, normalizedId(intent.sourceRecordId), intent.kind);
  }
  for (const block of deltaPlan.unresolvedBlocks) {
    for (const currentRowHint of block.currentRowHints) add(currentRowHint, null, 'UNRESOLVED');
  }
  return byHint;
}

function validateCoverage(
  rows: readonly IncrementalCurrentObservationInput[],
  linkageByHint: ReadonlyMap<number, unknown>,
): void {
  if (rows.length !== linkageByHint.size) {
    throw new IncrementalCurrentObservationSemanticError('CURRENT_ROW_COVERAGE_MISMATCH');
  }
  for (const row of rows) {
    if (!linkageByHint.has(row.currentRowHint)) {
      throw new IncrementalCurrentObservationSemanticError('CURRENT_ROW_COVERAGE_MISMATCH');
    }
  }
}

function validateQuality(item: IncrementalPreviousFinancialQualityEvidence): void {
  if (!UUID_PATTERN.test(item.sourceRecordId)) {
    throw new IncrementalCurrentObservationSemanticError('INVALID_FINANCIAL_QUALITY_EVIDENCE');
  }
  if (!['TRANSACTION', 'PERIOD_AGGREGATE', 'UNKNOWN'].includes(item.recordGranularity)) {
    throw new IncrementalCurrentObservationSemanticError('INVALID_FINANCIAL_QUALITY_EVIDENCE');
  }
  if (!['DAY', 'MONTH', 'UNKNOWN'].includes(item.datePrecision)) {
    throw new IncrementalCurrentObservationSemanticError('INVALID_FINANCIAL_QUALITY_EVIDENCE');
  }
  if (item.recordGranularity === 'PERIOD_AGGREGATE') {
    if (item.datePrecision !== 'MONTH' || item.aggregatePeriodMonth === null
      || !AGGREGATE_MONTH_PATTERN.test(item.aggregatePeriodMonth)) {
      throw new IncrementalCurrentObservationSemanticError('INVALID_FINANCIAL_QUALITY_EVIDENCE');
    }
  } else if (item.aggregatePeriodMonth !== null) {
    throw new IncrementalCurrentObservationSemanticError('INVALID_FINANCIAL_QUALITY_EVIDENCE');
  }
}

function qualityEvidenceMap(
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  evidence: readonly Readonly<IncrementalPreviousFinancialQualityEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalPreviousFinancialQualityEvidence>> {
  const revisedIds = new Set(
    deltaPlan.intents.filter((intent) => intent.kind === 'REVISE').map((intent) => normalizedId(intent.sourceRecordId)),
  );
  const byId = new Map<string, Readonly<IncrementalPreviousFinancialQualityEvidence>>();
  for (const item of evidence) {
    validateQuality(item);
    const sourceRecordId = normalizedId(item.sourceRecordId);
    if (byId.has(sourceRecordId)) {
      throw new IncrementalCurrentObservationSemanticError('DUPLICATE_FINANCIAL_QUALITY_SOURCE_ID');
    }
    if (!revisedIds.has(sourceRecordId)) {
      throw new IncrementalCurrentObservationSemanticError('EXTRA_FINANCIAL_QUALITY_EVIDENCE');
    }
    byId.set(sourceRecordId, Object.freeze({ ...item, sourceRecordId }));
  }
  return byId;
}

function projectFinancialObservation(
  row: Readonly<IncrementalCurrentObservationInput>,
  classified: Readonly<SourceSnapshotClassificationOutcome>,
  linkage: Readonly<{ sourceRecordId: string | null; lineageKind: 'TOUCH' | 'CREATE' | 'REVISE' | 'UNRESOLVED' }>,
  qualityById: ReadonlyMap<string, Readonly<IncrementalPreviousFinancialQualityEvidence>>,
  refs: ReferenceResolver,
): IncrementalObservationFinancialProjection {
  if (linkage.lineageKind === 'TOUCH') {
    return Object.freeze({ status: 'NOT_EVALUATED' as const, reason: 'TOUCH_NO_REVISION' as const });
  }
  if (linkage.lineageKind === 'UNRESOLVED') {
    return Object.freeze({ status: 'NOT_EVALUATED' as const, reason: 'UNRESOLVED_LINEAGE' as const });
  }
  if (classified.classification !== 'FINANCIAL_RECORD') {
    return Object.freeze({ status: 'NOT_EVALUATED' as const, reason: 'NOT_FINANCIAL_RECORD' as const });
  }

  let recordGranularity: RecordGranularity = 'UNKNOWN';
  let datePrecision: DatePrecision = 'UNKNOWN';
  let aggregatePeriodMonth: string | null = null;
  if (linkage.lineageKind === 'REVISE') {
    const quality = linkage.sourceRecordId === null ? undefined : qualityById.get(linkage.sourceRecordId);
    if (quality === undefined) {
      return Object.freeze({ status: 'BLOCKED' as const, reason: 'PREVIOUS_FINANCIAL_QUALITY_REQUIRED' as const });
    }
    recordGranularity = quality.recordGranularity;
    datePrecision = quality.datePrecision;
    aggregatePeriodMonth = quality.aggregatePeriodMonth;
  }

  const projected = projectFinancialTransaction({
    rawPayload: row.rawPayload,
    recordGranularity,
    datePrecision,
    aggregatePeriodMonth,
  }, { refs });
  if (!projected.ok) {
    return Object.freeze({
      status: 'FAILED' as const,
      stage: projected.stage,
      errorCode: projected.errorCode,
    });
  }
  return Object.freeze({ status: 'CANDIDATE' as const, transaction: projected.transaction });
}

export function buildIncrementalCurrentObservationSemanticPlan(
  rows: readonly Readonly<IncrementalCurrentObservationInput>[],
  deltaPlan: Readonly<IncrementalSourceDeltaIntentPlan>,
  previousFinancialQualityEvidence: readonly Readonly<IncrementalPreviousFinancialQualityEvidence>[],
  refs: ReferenceResolver,
): Readonly<IncrementalCurrentObservationSemanticPlan> {
  validateCurrentRows(rows);
  const linkageByHint = expectedCurrentLinkage(deltaPlan);
  validateCoverage(rows, linkageByHint);
  const qualityById = qualityEvidenceMap(deltaPlan, previousFinancialQualityEvidence);
  const classification = classifySourceSnapshot(rows.map((row) => ({
    sourceOrdinal: row.sourceOrdinal,
    rawPayload: row.rawPayload,
  })));
  const classifiedByOrdinal = new Map(classification.outcomes.map((outcome) => [outcome.sourceOrdinal, outcome] as const));

  const outcomes = rows.map((row): Readonly<IncrementalCurrentObservationSemanticOutcome> => {
    const linkage = linkageByHint.get(row.currentRowHint);
    const classified = classifiedByOrdinal.get(row.sourceOrdinal);
    if (linkage === undefined || classified === undefined) {
      throw new IncrementalCurrentObservationSemanticError('CURRENT_ROW_COVERAGE_MISMATCH');
    }
    return Object.freeze({
      currentRowHint: row.currentRowHint,
      sourceOrdinal: row.sourceOrdinal,
      sourceRecordId: linkage.sourceRecordId,
      lineageKind: linkage.lineageKind,
      classification: classified.classification,
      legacyPeriodCloseClassification: classified.legacyPeriodCloseClassification,
      decodeErrorCode: classified.decodeErrorCode,
      financialProjection: projectFinancialObservation(row, classified, linkage, qualityById, refs),
    });
  });

  return Object.freeze({ outcomes: Object.freeze(outcomes) });
}
