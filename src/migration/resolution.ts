export type ReviewableSourceState = 'MISSING' | 'AMBIGUOUS';

export type ResolutionCode =
  | 'KEEP_CANONICAL'
  | 'VOID_CANONICAL_CONFIRMED'
  | 'RELINK_SOURCE'
  | 'ACCEPT_SOURCE_CORRECTION'
  | 'RESOLVED_NO_CHANGE';

export interface ReconciliationItem {
  sourceRecordId: string;
  state: ReviewableSourceState;
  transactionId: string | null;
  reviewState: 'REVIEW_REQUIRED' | 'RESOLVED';
  resolutionCode: ResolutionCode | null;
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
  };
}

export function resolveReviewItem(
  item: ReconciliationItem,
  resolutionCode: ResolutionCode,
): ReconciliationItem {
  return {
    ...item,
    reviewState: 'RESOLVED',
    resolutionCode,
  };
}
