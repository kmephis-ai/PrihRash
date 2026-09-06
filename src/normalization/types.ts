import type { CanonicalTransaction, DatePrecision, RecordGranularity } from '../domain/transaction.js';

export interface LegacyFinancialCandidate {
  operationType: string | null;
  occurredOn: string;
  amountMinor: number;
  accountLabel: string | null;
  categoryLabel: string | null;
  description: string | null;
  note: string | null;
  vikaFlag: string | null;
  recordGranularity: RecordGranularity;
  datePrecision: DatePrecision;
  aggregatePeriodMonth: string | null;
}

export interface ReferenceResolver {
  resolveAccountId(sourceLabel: string): string | null;
  resolveCategoryId(kind: 'EXPENSE' | 'INCOME', sourceLabel: string): string | null;
  vikaMemberId: string;
}

export type NormalizationErrorCode =
  | 'SOURCE_OPERATION_TYPE_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'MISSING_ACCOUNT'
  | 'UNKNOWN_ACCOUNT'
  | 'MISSING_CATEGORY'
  | 'UNKNOWN_CATEGORY'
  | 'UNKNOWN_VIKA_FLAG';

export type NormalizationResult =
  | { ok: true; transaction: CanonicalTransaction }
  | { ok: false; errorCode: NormalizationErrorCode };
