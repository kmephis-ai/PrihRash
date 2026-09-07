export type ReviewableSourceState = 'MISSING' | 'AMBIGUOUS';

export type ResolutionCode =
  | 'KEEP_CANONICAL'
  | 'VOID_CANONICAL_CONFIRMED'
  | 'RELINK_SOURCE'
  | 'ACCEPT_SOURCE_CORRECTION'
  | 'RESOLVED_NO_CHANGE';

export type ReconciliationReviewState = 'REVIEW_REQUIRED' | 'RESOLVED';

export interface ReconciliationItem {
  sourceRecordId: string;
  state: ReviewableSourceState;
  transactionId: string | null;
  reviewState: ReconciliationReviewState;
  resolutionCode: ResolutionCode | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ResolutionAudit {
  resolvedAt: string;
  resolvedBy: string;
}

export type ResolutionContractErrorCode =
  | 'ALREADY_RESOLVED'
  | 'INCONSISTENT_REVIEW_STATE'
  | 'INVALID_RESOLVED_AT'
  | 'INVALID_RESOLVED_BY';

export class ResolutionContractError extends Error {
  readonly code: ResolutionContractErrorCode;

  constructor(code: ResolutionContractErrorCode, message: string) {
    super(message);
    this.name = 'ResolutionContractError';
    this.code = code;
  }
}

function assertResolutionAudit(audit: ResolutionAudit): void {
  if (audit.resolvedBy.trim().length === 0) {
    throw new ResolutionContractError(
      'INVALID_RESOLVED_BY',
      'resolvedBy must identify the actor that made the explicit resolution',
    );
  }

  const parsed = Date.parse(audit.resolvedAt);
  if (!Number.isFinite(parsed)) {
    throw new ResolutionContractError(
      'INVALID_RESOLVED_AT',
      'resolvedAt must be a valid timestamp',
    );
  }
}

function assertUnresolvedItem(item: ReconciliationItem): void {
  if (item.reviewState === 'RESOLVED') {
    throw new ResolutionContractError('ALREADY_RESOLVED', 'review item is already resolved');
  }

  if (item.resolutionCode !== null || item.resolvedAt !== null || item.resolvedBy !== null) {
    throw new ResolutionContractError(
      'INCONSISTENT_REVIEW_STATE',
      'REVIEW_REQUIRED item must not carry partial resolution metadata',
    );
  }
}

export function markReviewRequired(
  sourceRecordId: string,
  state: ReviewableSourceState,
  transactionId: string | null,
): ReconciliationItem {
  return {
    sourceRecordId,
    state,
    transactionId,
    reviewState: 'REVIEW_REQUIRED',
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  };
}

export function resolveReviewItem(
  item: ReconciliationItem,
  resolutionCode: ResolutionCode,
  audit: ResolutionAudit,
): ReconciliationItem {
  assertUnresolvedItem(item);
  assertResolutionAudit(audit);

  return {
    ...item,
    reviewState: 'RESOLVED',
    resolutionCode,
    resolvedAt: audit.resolvedAt,
    resolvedBy: audit.resolvedBy,
  };
}

export function hasCompleteResolutionAudit(item: ReconciliationItem): boolean {
  return (
    item.reviewState === 'RESOLVED' &&
    item.resolutionCode !== null &&
    item.resolvedAt !== null &&
    item.resolvedBy !== null &&
    item.resolvedBy.trim().length > 0 &&
    Number.isFinite(Date.parse(item.resolvedAt))
  );
}
