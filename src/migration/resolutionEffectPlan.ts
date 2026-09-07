import {
  validateTransaction,
  type CanonicalTransaction,
  type CategoryKind,
} from '../domain/transaction.js';
import type { ReconciliationItem, ResolutionCode } from './resolution.js';

export type ResolutionEffectRequest =
  | Readonly<{ resolutionCode: 'KEEP_CANONICAL' }>
  | Readonly<{ resolutionCode: 'RESOLVED_NO_CHANGE' }>
  | Readonly<{
      resolutionCode: 'VOID_CANONICAL_CONFIRMED';
      expectedTransactionVersion: number;
    }>
  | Readonly<{
      resolutionCode: 'RELINK_SOURCE';
      targetTransactionId: string;
      expectedSourceRevision: number;
    }>
  | Readonly<{
      resolutionCode: 'ACCEPT_SOURCE_CORRECTION';
      expectedTransactionVersion: number;
      canonicalTransaction: Readonly<CanonicalTransaction>;
      categoryKind: CategoryKind | null;
    }>;

export type TransactionResolutionEffect =
  | Readonly<{ kind: 'NONE' }>
  | Readonly<{
      kind: 'VOID';
      transactionId: string;
      expectedVersion: number;
    }>
  | Readonly<{
      kind: 'REPLACE';
      transactionId: string;
      expectedVersion: number;
      canonicalTransaction: Readonly<CanonicalTransaction>;
      categoryKind: CategoryKind | null;
    }>;

export type SourceLinkResolutionEffect =
  | Readonly<{ kind: 'KEEP' }>
  | Readonly<{
      kind: 'RELINK';
      targetTransactionId: string;
      expectedSourceRevision: number;
    }>;

export interface ResolutionEffectPlan {
  readonly sourceRecordId: string;
  readonly resolutionCode: ResolutionCode;
  readonly transactionEffect: TransactionResolutionEffect;
  readonly sourceLinkEffect: SourceLinkResolutionEffect;
}

export type ResolutionEffectPlanErrorCode =
  | 'REVIEW_ITEM_NOT_PENDING'
  | 'INVALID_SOURCE_RECORD_ID'
  | 'INVALID_LINKED_TRANSACTION_ID'
  | 'LINKED_TRANSACTION_REQUIRED'
  | 'INVALID_TARGET_TRANSACTION_ID'
  | 'RELINK_TARGET_UNCHANGED'
  | 'INVALID_EXPECTED_TRANSACTION_VERSION'
  | 'INVALID_EXPECTED_SOURCE_REVISION'
  | 'CANONICAL_TRANSACTION_INVALID';

export class ResolutionEffectPlanError extends Error {
  readonly code: ResolutionEffectPlanErrorCode;

  constructor(code: ResolutionEffectPlanErrorCode) {
    super(code);
    this.name = 'ResolutionEffectPlanError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function assertUuid(value: string, code: ResolutionEffectPlanErrorCode): void {
  if (!UUID_PATTERN.test(value)) throw new ResolutionEffectPlanError(code);
}

function assertPositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ResolutionEffectPlanError('INVALID_EXPECTED_TRANSACTION_VERSION');
  }
}

function assertPositiveRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ResolutionEffectPlanError('INVALID_EXPECTED_SOURCE_REVISION');
  }
}

function assertPendingReview(item: Readonly<ReconciliationItem>): void {
  if (
    item.reviewState !== 'REVIEW_REQUIRED'
    || item.resolutionCode !== null
    || item.resolvedAt !== null
    || item.resolvedBy !== null
  ) {
    throw new ResolutionEffectPlanError('REVIEW_ITEM_NOT_PENDING');
  }
  assertUuid(item.sourceRecordId, 'INVALID_SOURCE_RECORD_ID');
  if (item.transactionId !== null) {
    assertUuid(item.transactionId, 'INVALID_LINKED_TRANSACTION_ID');
  }
}

function requireLinkedTransaction(item: Readonly<ReconciliationItem>): string {
  if (item.transactionId === null) {
    throw new ResolutionEffectPlanError('LINKED_TRANSACTION_REQUIRED');
  }
  return item.transactionId;
}

function noneTransactionEffect(): TransactionResolutionEffect {
  return Object.freeze({ kind: 'NONE' as const });
}

function keepSourceLinkEffect(): SourceLinkResolutionEffect {
  return Object.freeze({ kind: 'KEEP' as const });
}

function freezeCanonicalTransaction(
  transaction: Readonly<CanonicalTransaction>,
): Readonly<CanonicalTransaction> {
  return Object.freeze({ ...transaction });
}

export function planResolutionEffect(
  item: Readonly<ReconciliationItem>,
  request: ResolutionEffectRequest,
): Readonly<ResolutionEffectPlan> {
  assertPendingReview(item);

  switch (request.resolutionCode) {
    case 'KEEP_CANONICAL':
      requireLinkedTransaction(item);
      return Object.freeze({
        sourceRecordId: item.sourceRecordId,
        resolutionCode: request.resolutionCode,
        transactionEffect: noneTransactionEffect(),
        sourceLinkEffect: keepSourceLinkEffect(),
      });

    case 'RESOLVED_NO_CHANGE':
      return Object.freeze({
        sourceRecordId: item.sourceRecordId,
        resolutionCode: request.resolutionCode,
        transactionEffect: noneTransactionEffect(),
        sourceLinkEffect: keepSourceLinkEffect(),
      });

    case 'VOID_CANONICAL_CONFIRMED': {
      const transactionId = requireLinkedTransaction(item);
      assertPositiveVersion(request.expectedTransactionVersion);
      return Object.freeze({
        sourceRecordId: item.sourceRecordId,
        resolutionCode: request.resolutionCode,
        transactionEffect: Object.freeze({
          kind: 'VOID' as const,
          transactionId,
          expectedVersion: request.expectedTransactionVersion,
        }),
        sourceLinkEffect: keepSourceLinkEffect(),
      });
    }

    case 'RELINK_SOURCE':
      assertUuid(request.targetTransactionId, 'INVALID_TARGET_TRANSACTION_ID');
      assertPositiveRevision(request.expectedSourceRevision);
      if (
        item.transactionId !== null
        && item.transactionId.toLowerCase() === request.targetTransactionId.toLowerCase()
      ) {
        throw new ResolutionEffectPlanError('RELINK_TARGET_UNCHANGED');
      }
      return Object.freeze({
        sourceRecordId: item.sourceRecordId,
        resolutionCode: request.resolutionCode,
        transactionEffect: noneTransactionEffect(),
        sourceLinkEffect: Object.freeze({
          kind: 'RELINK' as const,
          targetTransactionId: request.targetTransactionId,
          expectedSourceRevision: request.expectedSourceRevision,
        }),
      });

    case 'ACCEPT_SOURCE_CORRECTION': {
      const transactionId = requireLinkedTransaction(item);
      assertPositiveVersion(request.expectedTransactionVersion);
      const validationErrors = validateTransaction(request.canonicalTransaction, {
        categoryKind: request.categoryKind,
      });
      if (validationErrors.length > 0) {
        throw new ResolutionEffectPlanError('CANONICAL_TRANSACTION_INVALID');
      }
      return Object.freeze({
        sourceRecordId: item.sourceRecordId,
        resolutionCode: request.resolutionCode,
        transactionEffect: Object.freeze({
          kind: 'REPLACE' as const,
          transactionId,
          expectedVersion: request.expectedTransactionVersion,
          canonicalTransaction: freezeCanonicalTransaction(request.canonicalTransaction),
          categoryKind: request.categoryKind,
        }),
        sourceLinkEffect: keepSourceLinkEffect(),
      });
    }
  }
}
