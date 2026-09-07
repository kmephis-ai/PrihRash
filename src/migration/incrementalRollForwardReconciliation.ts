import { SOURCE_SHEET_NAME } from '../integration/google/sourceSchema.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  type InitialControlledRebuildReconciliationSnapshot,
} from './initialControlledRebuildReconciliation.js';
import type { IncrementalCurrentDeltaPlan } from './incrementalCurrentDelta.js';
import type { IncrementalCurrentReconciliationPlan } from './incrementalCurrentReconciliation.js';
import type {
  IncrementalPreviousSourceCurrentEvidence,
  IncrementalSourceCurrentCandidate,
} from './incrementalSourceCurrentCandidate.js';
import type {
  IncrementalPreviousTransactionCurrentEvidence,
  IncrementalTransactionCurrentCandidate,
} from './incrementalTransactionCurrentCandidate.js';
import type { InitialReconciliationEvidence } from './initialValidationGate.js';

export type IncrementalRollForwardReconciliationErrorCode =
  | 'PROMOTION_BLOCKER_MISMATCH'
  | 'INVALID_BASELINE_SOURCE'
  | 'DUPLICATE_BASELINE_SOURCE_ID'
  | 'INVALID_BASELINE_TRANSACTION'
  | 'DUPLICATE_BASELINE_TRANSACTION_ID'
  | 'INVALID_SOURCE_INTENT'
  | 'DUPLICATE_SOURCE_INTENT_ID'
  | 'SOURCE_CREATE_COLLISION'
  | 'SOURCE_UPDATE_TARGET_MISSING'
  | 'SOURCE_UPDATE_PREDICATE_MISMATCH'
  | 'INVALID_TRANSACTION_INTENT'
  | 'DUPLICATE_TRANSACTION_INTENT_ID'
  | 'TRANSACTION_CREATE_COLLISION'
  | 'TRANSACTION_REPLACE_TARGET_MISSING'
  | 'TRANSACTION_REPLACE_PREDICATE_MISMATCH';

export class IncrementalRollForwardReconciliationError extends Error {
  readonly code: IncrementalRollForwardReconciliationErrorCode;

  constructor(code: IncrementalRollForwardReconciliationErrorCode) {
    super(code);
    this.name = 'IncrementalRollForwardReconciliationError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLASSIFICATIONS = new Set([
  'FINANCIAL_RECORD',
  'LEGACY_PERIOD_CLOSE',
  'NON_FINANCIAL',
  'INVALID',
  'AMBIGUOUS',
]);

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function validUuidOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && UUID_PATTERN.test(value));
}

function validOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validResolutionAudit(record: Readonly<IncrementalPreviousSourceCurrentEvidence>): boolean {
  const values = [record.resolutionCode, record.resolvedAt, record.resolvedBy];
  const nullCount = values.filter((value) => value === null).length;
  if (nullCount === values.length) return true;
  if (nullCount !== 0) return false;
  return typeof record.resolutionCode === 'string'
    && record.resolutionCode.trim().length > 0
    && validTimestamp(record.resolvedAt)
    && typeof record.resolvedBy === 'string'
    && record.resolvedBy.trim().length > 0;
}

function validSourceRecord(record: Readonly<IncrementalPreviousSourceCurrentEvidence>): boolean {
  return typeof record.id === 'string'
    && UUID_PATTERN.test(record.id)
    && record.sourceType === 'GOOGLE_SHEETS'
    && record.sourceSheet === SOURCE_SHEET_NAME
    && validTimestamp(record.firstSeenAt)
    && validTimestamp(record.lastSeenAt)
    && Number.isSafeInteger(record.lastRowHint)
    && record.lastRowHint > 0
    && typeof record.currentDigest === 'string'
    && record.currentDigest.trim().length > 0
    && (record.state === null || record.state === 'MISSING')
    && CLASSIFICATIONS.has(record.classification)
    && validOptionalString(record.normalizationStatus)
    && validUuidOrNull(record.transactionId)
    && Number.isSafeInteger(record.currentRevision)
    && record.currentRevision >= 1
    && validOptionalString(record.resolutionCode)
    && (record.resolvedAt === null || validTimestamp(record.resolvedAt))
    && validOptionalString(record.resolvedBy)
    && validResolutionAudit(record);
}

function validTransactionRecord(record: Readonly<IncrementalPreviousTransactionCurrentEvidence>): boolean {
  return typeof record.id === 'string'
    && UUID_PATTERN.test(record.id)
    && Number.isSafeInteger(record.version)
    && record.version >= 1
    && record.transaction !== null
    && typeof record.transaction === 'object';
}

function freezeSource(
  record: Readonly<IncrementalPreviousSourceCurrentEvidence>,
): Readonly<IncrementalPreviousSourceCurrentEvidence> {
  return Object.freeze({ ...record, id: normalizedId(record.id) });
}

function freezeTransaction(
  record: Readonly<IncrementalPreviousTransactionCurrentEvidence>,
): Readonly<IncrementalPreviousTransactionCurrentEvidence> {
  return Object.freeze({
    id: normalizedId(record.id),
    transaction: Object.freeze({ ...record.transaction }),
    version: record.version,
  });
}

function sourceBaselineMap(
  baseline: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
): Map<string, Readonly<IncrementalPreviousSourceCurrentEvidence>> {
  const map = new Map<string, Readonly<IncrementalPreviousSourceCurrentEvidence>>();
  for (const record of baseline) {
    if (!validSourceRecord(record)) {
      throw new IncrementalRollForwardReconciliationError('INVALID_BASELINE_SOURCE');
    }
    const id = normalizedId(record.id);
    if (map.has(id)) {
      throw new IncrementalRollForwardReconciliationError('DUPLICATE_BASELINE_SOURCE_ID');
    }
    map.set(id, freezeSource(record));
  }
  return map;
}

function transactionBaselineMap(
  baseline: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
): Map<string, Readonly<IncrementalPreviousTransactionCurrentEvidence>> {
  const map = new Map<string, Readonly<IncrementalPreviousTransactionCurrentEvidence>>();
  for (const record of baseline) {
    if (!validTransactionRecord(record)) {
      throw new IncrementalRollForwardReconciliationError('INVALID_BASELINE_TRANSACTION');
    }
    const id = normalizedId(record.id);
    if (map.has(id)) {
      throw new IncrementalRollForwardReconciliationError('DUPLICATE_BASELINE_TRANSACTION_ID');
    }
    map.set(id, freezeTransaction(record));
  }
  return map;
}

function sourceGuardMatches(
  previous: Readonly<IncrementalPreviousSourceCurrentEvidence>,
  candidate: Readonly<IncrementalSourceCurrentCandidate>,
  intent: Extract<IncrementalCurrentDeltaPlan['sourceIntents'][number], { kind: 'UPDATE_SOURCE_RECORD' }>,
): boolean {
  return normalizedId(previous.id) === normalizedId(candidate.id)
    && previous.sourceType === candidate.sourceType
    && previous.sourceSheet === candidate.sourceSheet
    && previous.firstSeenAt === candidate.firstSeenAt
    && previous.currentRevision === intent.expectedCurrentRevision
    && previous.currentDigest === intent.expectedCurrentDigest
    && previous.state === intent.expectedState
    && (previous.transactionId === null ? null : normalizedId(previous.transactionId))
      === (intent.expectedTransactionId === null ? null : normalizedId(intent.expectedTransactionId))
    && previous.resolutionCode === intent.expectedResolutionCode;
}

function rollForwardSources(
  baseline: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  delta: Readonly<IncrementalCurrentDeltaPlan>,
): readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[] {
  const map = sourceBaselineMap(baseline);
  const intentIds = new Set<string>();

  for (const intent of delta.sourceIntents) {
    if (!validSourceRecord(intent.candidate)) {
      throw new IncrementalRollForwardReconciliationError('INVALID_SOURCE_INTENT');
    }
    const id = normalizedId(intent.candidate.id);
    if (intentIds.has(id)) {
      throw new IncrementalRollForwardReconciliationError('DUPLICATE_SOURCE_INTENT_ID');
    }
    intentIds.add(id);

    if (intent.kind === 'CREATE_SOURCE_RECORD') {
      if (map.has(id)) {
        throw new IncrementalRollForwardReconciliationError('SOURCE_CREATE_COLLISION');
      }
      map.set(id, freezeSource(intent.candidate));
      continue;
    }

    if (intent.kind !== 'UPDATE_SOURCE_RECORD') {
      throw new IncrementalRollForwardReconciliationError('INVALID_SOURCE_INTENT');
    }
    const previous = map.get(id);
    if (previous === undefined) {
      throw new IncrementalRollForwardReconciliationError('SOURCE_UPDATE_TARGET_MISSING');
    }
    if (!sourceGuardMatches(previous, intent.candidate, intent)) {
      throw new IncrementalRollForwardReconciliationError('SOURCE_UPDATE_PREDICATE_MISMATCH');
    }
    map.set(id, freezeSource(intent.candidate));
  }

  return Object.freeze([...map.values()].sort((left, right) => left.id.localeCompare(right.id)));
}

function rollForwardTransactions(
  baseline: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
  delta: Readonly<IncrementalCurrentDeltaPlan>,
): readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[] {
  const map = transactionBaselineMap(baseline);
  const intentIds = new Set<string>();

  for (const intent of delta.transactionIntents) {
    if (!validTransactionRecord(intent.candidate)) {
      throw new IncrementalRollForwardReconciliationError('INVALID_TRANSACTION_INTENT');
    }
    const id = normalizedId(intent.candidate.id);
    if (intentIds.has(id)) {
      throw new IncrementalRollForwardReconciliationError('DUPLICATE_TRANSACTION_INTENT_ID');
    }
    intentIds.add(id);

    if (intent.kind === 'CREATE_TRANSACTION') {
      if (intent.candidate.version !== 1) {
        throw new IncrementalRollForwardReconciliationError('INVALID_TRANSACTION_INTENT');
      }
      if (map.has(id)) {
        throw new IncrementalRollForwardReconciliationError('TRANSACTION_CREATE_COLLISION');
      }
      map.set(id, freezeTransaction(intent.candidate));
      continue;
    }

    if (intent.kind !== 'REPLACE_TRANSACTION') {
      throw new IncrementalRollForwardReconciliationError('INVALID_TRANSACTION_INTENT');
    }
    const previous = map.get(id);
    if (previous === undefined) {
      throw new IncrementalRollForwardReconciliationError('TRANSACTION_REPLACE_TARGET_MISSING');
    }
    if (
      previous.version !== intent.expectedVersion
      || intent.candidate.version !== intent.expectedVersion + 1
    ) {
      throw new IncrementalRollForwardReconciliationError('TRANSACTION_REPLACE_PREDICATE_MISMATCH');
    }
    map.set(id, freezeTransaction(intent.candidate));
  }

  return Object.freeze([...map.values()].sort((left, right) => left.id.localeCompare(right.id)));
}

export function buildIncrementalRollForwardReconciliationSnapshot(
  baselineSources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  baselineTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
  delta: Readonly<IncrementalCurrentDeltaPlan>,
): Readonly<InitialControlledRebuildReconciliationSnapshot> {
  const sourceRecords = rollForwardSources(baselineSources, delta);
  const transactions = rollForwardTransactions(baselineTransactions, delta);

  return buildExpectedControlledRebuildReconciliation({
    sourceRecords: sourceRecords.map((record) => Object.freeze({
      classification: record.classification,
      state: record.state,
    })),
    transactions: transactions.map((record) => Object.freeze({ transaction: record.transaction })),
  });
}

export function compareIncrementalRollForwardReconciliation(
  expectedPlan: Readonly<IncrementalCurrentReconciliationPlan>,
  baselineSources: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  baselineTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
  delta: Readonly<IncrementalCurrentDeltaPlan>,
): Readonly<InitialReconciliationEvidence> {
  if (expectedPlan.promotionBlocker !== delta.promotionBlocker) {
    throw new IncrementalRollForwardReconciliationError('PROMOTION_BLOCKER_MISMATCH');
  }
  const observed = buildIncrementalRollForwardReconciliationSnapshot(
    baselineSources,
    baselineTransactions,
    delta,
  );
  return compareControlledRebuildStagingReconciliation(expectedPlan.expected, observed);
}
