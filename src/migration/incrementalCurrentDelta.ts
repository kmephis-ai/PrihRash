import type { CanonicalTransaction } from '../domain/transaction.js';
import type {
  IncrementalPreviousSourceCurrentEvidence,
  IncrementalSourceCurrentCandidate,
  IncrementalSourceCurrentCandidatePlan,
} from './incrementalSourceCurrentCandidate.js';
import type {
  IncrementalPreviousTransactionCurrentEvidence,
  IncrementalTransactionCurrentCandidate,
  IncrementalTransactionCurrentCandidatePlan,
} from './incrementalTransactionCurrentCandidate.js';

export type IncrementalSourceCurrentDeltaIntent =
  | Readonly<{
      kind: 'CREATE_SOURCE_RECORD';
      candidate: Readonly<IncrementalSourceCurrentCandidate>;
    }>
  | Readonly<{
      kind: 'UPDATE_SOURCE_RECORD';
      candidate: Readonly<IncrementalSourceCurrentCandidate>;
      expectedCurrentRevision: number;
      expectedCurrentDigest: string;
      expectedState: 'MISSING' | null;
      expectedTransactionId: string | null;
      expectedResolutionCode: string | null;
    }>;

export type IncrementalTransactionCurrentDeltaIntent =
  | Readonly<{
      kind: 'CREATE_TRANSACTION';
      candidate: Readonly<IncrementalTransactionCurrentCandidate>;
    }>
  | Readonly<{
      kind: 'REPLACE_TRANSACTION';
      candidate: Readonly<IncrementalTransactionCurrentCandidate>;
      expectedVersion: number;
    }>;

export interface IncrementalCurrentDeltaPlan {
  readonly sourceIntents: readonly Readonly<IncrementalSourceCurrentDeltaIntent>[];
  readonly transactionIntents: readonly Readonly<IncrementalTransactionCurrentDeltaIntent>[];
  readonly promotionBlocker: 'UNRESOLVED_LINEAGE' | null;
}

export type IncrementalCurrentDeltaErrorCode =
  | 'PROMOTION_BLOCKER_MISMATCH'
  | 'INVALID_SOURCE_RECORD_ID'
  | 'DUPLICATE_PREVIOUS_SOURCE_RECORD_ID'
  | 'DUPLICATE_CANDIDATE_SOURCE_RECORD_ID'
  | 'SOURCE_RECORD_HARD_DELETE_FORBIDDEN'
  | 'SOURCE_RECORD_IMMUTABLE_FIELD_CHANGED'
  | 'INVALID_TRANSACTION_ID'
  | 'DUPLICATE_PREVIOUS_TRANSACTION_ID'
  | 'DUPLICATE_CANDIDATE_TRANSACTION_ID'
  | 'TRANSACTION_HARD_DELETE_FORBIDDEN'
  | 'INVALID_TRANSACTION_VERSION'
  | 'CREATE_TRANSACTION_VERSION_INVALID'
  | 'TRANSACTION_VERSION_CHANGED_WITHOUT_PAYLOAD_CHANGE'
  | 'TRANSACTION_PAYLOAD_CHANGED_WITHOUT_VERSION_INCREMENT';

export class IncrementalCurrentDeltaError extends Error {
  readonly code: IncrementalCurrentDeltaErrorCode;

  constructor(code: IncrementalCurrentDeltaErrorCode) {
    super(code);
    this.name = 'IncrementalCurrentDeltaError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function sourceMap<T extends { readonly id: string }>(
  records: readonly Readonly<T>[],
  duplicateCode: 'DUPLICATE_PREVIOUS_SOURCE_RECORD_ID' | 'DUPLICATE_CANDIDATE_SOURCE_RECORD_ID',
): ReadonlyMap<string, Readonly<T>> {
  const byId = new Map<string, Readonly<T>>();
  for (const record of records) {
    if (!UUID_PATTERN.test(record.id)) {
      throw new IncrementalCurrentDeltaError('INVALID_SOURCE_RECORD_ID');
    }
    const id = normalizedId(record.id);
    if (byId.has(id)) throw new IncrementalCurrentDeltaError(duplicateCode);
    byId.set(id, record);
  }
  return byId;
}

function transactionMap<T extends { readonly id: string; readonly version: number }>(
  records: readonly Readonly<T>[],
  duplicateCode: 'DUPLICATE_PREVIOUS_TRANSACTION_ID' | 'DUPLICATE_CANDIDATE_TRANSACTION_ID',
): ReadonlyMap<string, Readonly<T>> {
  const byId = new Map<string, Readonly<T>>();
  for (const record of records) {
    if (!UUID_PATTERN.test(record.id)) {
      throw new IncrementalCurrentDeltaError('INVALID_TRANSACTION_ID');
    }
    if (!Number.isSafeInteger(record.version) || record.version < 1) {
      throw new IncrementalCurrentDeltaError('INVALID_TRANSACTION_VERSION');
    }
    const id = normalizedId(record.id);
    if (byId.has(id)) throw new IncrementalCurrentDeltaError(duplicateCode);
    byId.set(id, record);
  }
  return byId;
}

function nullableEqual(left: string | null, right: string | null): boolean {
  return left === right;
}

function sourcePersistedEqual(
  left: Readonly<IncrementalPreviousSourceCurrentEvidence>,
  right: Readonly<IncrementalSourceCurrentCandidate>,
): boolean {
  return left.id.toLowerCase() === right.id.toLowerCase()
    && left.sourceType === right.sourceType
    && left.sourceSheet === right.sourceSheet
    && left.firstSeenAt === right.firstSeenAt
    && left.lastSeenAt === right.lastSeenAt
    && left.lastRowHint === right.lastRowHint
    && left.currentDigest === right.currentDigest
    && left.state === right.state
    && left.classification === right.classification
    && nullableEqual(left.normalizationStatus, right.normalizationStatus)
    && (left.transactionId?.toLowerCase() ?? null) === (right.transactionId?.toLowerCase() ?? null)
    && left.currentRevision === right.currentRevision
    && nullableEqual(left.resolutionCode, right.resolutionCode)
    && nullableEqual(left.resolvedAt, right.resolvedAt)
    && nullableEqual(left.resolvedBy, right.resolvedBy);
}

function assertSourceImmutableFields(
  previous: Readonly<IncrementalPreviousSourceCurrentEvidence>,
  candidate: Readonly<IncrementalSourceCurrentCandidate>,
): void {
  if (
    previous.id.toLowerCase() !== candidate.id.toLowerCase()
    || previous.sourceType !== candidate.sourceType
    || previous.sourceSheet !== candidate.sourceSheet
    || previous.firstSeenAt !== candidate.firstSeenAt
  ) {
    throw new IncrementalCurrentDeltaError('SOURCE_RECORD_IMMUTABLE_FIELD_CHANGED');
  }
}

const TRANSACTION_FIELDS: readonly (keyof CanonicalTransaction)[] = Object.freeze([
  'type',
  'occurredOn',
  'recordGranularity',
  'datePrecision',
  'aggregatePeriodMonth',
  'financialPeriodId',
  'periodAssignmentQuality',
  'amountMinor',
  'currency',
  'fromAccountId',
  'toAccountId',
  'categoryId',
  'paidByMemberId',
  'description',
  'note',
  'status',
  'analyticsState',
  'flowKind',
]);

function canonicalTransactionEqual(
  left: Readonly<CanonicalTransaction>,
  right: Readonly<CanonicalTransaction>,
): boolean {
  return TRANSACTION_FIELDS.every((field) => left[field] === right[field]);
}

function sourceDelta(
  previousRecords: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  candidatePlan: Readonly<IncrementalSourceCurrentCandidatePlan>,
): readonly Readonly<IncrementalSourceCurrentDeltaIntent>[] {
  const previousById = sourceMap(previousRecords, 'DUPLICATE_PREVIOUS_SOURCE_RECORD_ID');
  const candidateById = sourceMap(candidatePlan.sourceRecords, 'DUPLICATE_CANDIDATE_SOURCE_RECORD_ID');

  for (const id of previousById.keys()) {
    if (!candidateById.has(id)) {
      throw new IncrementalCurrentDeltaError('SOURCE_RECORD_HARD_DELETE_FORBIDDEN');
    }
  }

  const intents: Readonly<IncrementalSourceCurrentDeltaIntent>[] = [];
  for (const [id, candidate] of candidateById) {
    const previous = previousById.get(id);
    if (previous === undefined) {
      intents.push(Object.freeze({
        kind: 'CREATE_SOURCE_RECORD' as const,
        candidate: Object.freeze({ ...candidate }),
      }));
      continue;
    }
    assertSourceImmutableFields(previous, candidate);
    if (sourcePersistedEqual(previous, candidate)) continue;
    intents.push(Object.freeze({
      kind: 'UPDATE_SOURCE_RECORD' as const,
      candidate: Object.freeze({ ...candidate }),
      expectedCurrentRevision: previous.currentRevision,
      expectedCurrentDigest: previous.currentDigest,
      expectedState: previous.state,
      expectedTransactionId: previous.transactionId?.toLowerCase() ?? null,
      expectedResolutionCode: previous.resolutionCode,
    }));
  }

  return Object.freeze(intents.sort((left, right) => left.candidate.id.localeCompare(right.candidate.id)));
}

function transactionDelta(
  previousRecords: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
  candidatePlan: Readonly<IncrementalTransactionCurrentCandidatePlan>,
): readonly Readonly<IncrementalTransactionCurrentDeltaIntent>[] {
  const previousById = transactionMap(previousRecords, 'DUPLICATE_PREVIOUS_TRANSACTION_ID');
  const candidateById = transactionMap(candidatePlan.transactions, 'DUPLICATE_CANDIDATE_TRANSACTION_ID');

  for (const id of previousById.keys()) {
    if (!candidateById.has(id)) {
      throw new IncrementalCurrentDeltaError('TRANSACTION_HARD_DELETE_FORBIDDEN');
    }
  }

  const intents: Readonly<IncrementalTransactionCurrentDeltaIntent>[] = [];
  for (const [id, candidate] of candidateById) {
    const previous = previousById.get(id);
    if (previous === undefined) {
      if (candidate.version !== 1) {
        throw new IncrementalCurrentDeltaError('CREATE_TRANSACTION_VERSION_INVALID');
      }
      intents.push(Object.freeze({
        kind: 'CREATE_TRANSACTION' as const,
        candidate: Object.freeze({
          ...candidate,
          transaction: Object.freeze({ ...candidate.transaction }),
        }),
      }));
      continue;
    }

    const payloadEqual = canonicalTransactionEqual(previous.transaction, candidate.transaction);
    if (payloadEqual) {
      if (candidate.version !== previous.version) {
        throw new IncrementalCurrentDeltaError('TRANSACTION_VERSION_CHANGED_WITHOUT_PAYLOAD_CHANGE');
      }
      continue;
    }
    if (candidate.version !== previous.version + 1) {
      throw new IncrementalCurrentDeltaError('TRANSACTION_PAYLOAD_CHANGED_WITHOUT_VERSION_INCREMENT');
    }
    intents.push(Object.freeze({
      kind: 'REPLACE_TRANSACTION' as const,
      candidate: Object.freeze({
        ...candidate,
        transaction: Object.freeze({ ...candidate.transaction }),
      }),
      expectedVersion: previous.version,
    }));
  }

  return Object.freeze(intents.sort((left, right) => left.candidate.id.localeCompare(right.candidate.id)));
}

export function buildIncrementalCurrentDeltaPlan(
  previousSourceRecords: readonly Readonly<IncrementalPreviousSourceCurrentEvidence>[],
  previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
  sourceCandidatePlan: Readonly<IncrementalSourceCurrentCandidatePlan>,
  transactionCandidatePlan: Readonly<IncrementalTransactionCurrentCandidatePlan>,
): Readonly<IncrementalCurrentDeltaPlan> {
  if (sourceCandidatePlan.promotionBlocker !== transactionCandidatePlan.promotionBlocker) {
    throw new IncrementalCurrentDeltaError('PROMOTION_BLOCKER_MISMATCH');
  }

  return Object.freeze({
    sourceIntents: sourceDelta(previousSourceRecords, sourceCandidatePlan),
    transactionIntents: transactionDelta(previousTransactions, transactionCandidatePlan),
    promotionBlocker: sourceCandidatePlan.promotionBlocker,
  });
}
