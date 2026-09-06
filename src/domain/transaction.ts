export type TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
export type CategoryKind = 'EXPENSE' | 'INCOME';
export type RecordGranularity = 'TRANSACTION' | 'PERIOD_AGGREGATE' | 'UNKNOWN';
export type DatePrecision = 'DAY' | 'MONTH' | 'UNKNOWN';
export type PeriodAssignmentQuality = 'EXPLICIT' | 'DERIVED' | 'LEGACY_AMBIGUOUS' | 'UNASSIGNED';
export type TransactionStatus = 'POSTED' | 'VOIDED';
export type AnalyticsState = 'INCLUDED' | 'EXCLUDED';
export type FlowKind = 'OWN_FUNDS_TRANSFER' | 'CREDIT_DRAW' | 'CREDIT_REPAYMENT';

export interface CanonicalTransaction {
  type: TransactionType;
  occurredOn: string;
  recordGranularity: RecordGranularity;
  datePrecision: DatePrecision;
  aggregatePeriodMonth: string | null;
  financialPeriodId: string | null;
  periodAssignmentQuality: PeriodAssignmentQuality;
  amountMinor: number;
  currency: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  paidByMemberId: string | null;
  description: string | null;
  note: string | null;
  status: TransactionStatus;
  analyticsState: AnalyticsState;
  flowKind: FlowKind | null;
}

export interface TransactionValidationContext {
  categoryKind: CategoryKind | null;
}

export type TransactionValidationCode =
  | 'AMOUNT_NOT_POSITIVE'
  | 'UNSUPPORTED_CURRENCY'
  | 'EXPENSE_FROM_ACCOUNT_REQUIRED'
  | 'EXPENSE_TO_ACCOUNT_FORBIDDEN'
  | 'EXPENSE_CATEGORY_REQUIRED'
  | 'EXPENSE_CATEGORY_KIND_INVALID'
  | 'INCOME_FROM_ACCOUNT_FORBIDDEN'
  | 'INCOME_TO_ACCOUNT_REQUIRED'
  | 'INCOME_CATEGORY_REQUIRED'
  | 'INCOME_CATEGORY_KIND_INVALID'
  | 'TRANSFER_FROM_ACCOUNT_REQUIRED'
  | 'TRANSFER_TO_ACCOUNT_REQUIRED'
  | 'TRANSFER_ACCOUNTS_MUST_DIFFER'
  | 'TRANSFER_CATEGORY_FORBIDDEN'
  | 'TRANSFER_CATEGORY_KIND_FORBIDDEN'
  | 'FLOW_KIND_REQUIRES_TRANSFER'
  | 'PERIOD_AGGREGATE_MONTH_REQUIRED'
  | 'PERIOD_AGGREGATE_DATE_PRECISION_INVALID'
  | 'AGGREGATE_MONTH_REQUIRES_PERIOD_AGGREGATE';

export function validateTransaction(
  tx: CanonicalTransaction,
  context: TransactionValidationContext,
): TransactionValidationCode[] {
  const errors: TransactionValidationCode[] = [];

  if (!Number.isSafeInteger(tx.amountMinor) || tx.amountMinor <= 0) {
    errors.push('AMOUNT_NOT_POSITIVE');
  }
  if (tx.currency !== 'RUB') errors.push('UNSUPPORTED_CURRENCY');

  if (tx.flowKind !== null && tx.type !== 'TRANSFER') {
    errors.push('FLOW_KIND_REQUIRES_TRANSFER');
  }

  if (tx.recordGranularity === 'PERIOD_AGGREGATE') {
    if (tx.aggregatePeriodMonth === null) errors.push('PERIOD_AGGREGATE_MONTH_REQUIRED');
    if (tx.datePrecision !== 'MONTH') errors.push('PERIOD_AGGREGATE_DATE_PRECISION_INVALID');
  } else if (tx.aggregatePeriodMonth !== null) {
    errors.push('AGGREGATE_MONTH_REQUIRES_PERIOD_AGGREGATE');
  }

  switch (tx.type) {
    case 'EXPENSE':
      if (tx.fromAccountId === null) errors.push('EXPENSE_FROM_ACCOUNT_REQUIRED');
      if (tx.toAccountId !== null) errors.push('EXPENSE_TO_ACCOUNT_FORBIDDEN');
      if (tx.categoryId === null) errors.push('EXPENSE_CATEGORY_REQUIRED');
      if (context.categoryKind !== null && context.categoryKind !== 'EXPENSE') {
        errors.push('EXPENSE_CATEGORY_KIND_INVALID');
      }
      break;
    case 'INCOME':
      if (tx.fromAccountId !== null) errors.push('INCOME_FROM_ACCOUNT_FORBIDDEN');
      if (tx.toAccountId === null) errors.push('INCOME_TO_ACCOUNT_REQUIRED');
      if (tx.categoryId === null) errors.push('INCOME_CATEGORY_REQUIRED');
      if (context.categoryKind !== null && context.categoryKind !== 'INCOME') {
        errors.push('INCOME_CATEGORY_KIND_INVALID');
      }
      break;
    case 'TRANSFER':
      if (tx.fromAccountId === null) errors.push('TRANSFER_FROM_ACCOUNT_REQUIRED');
      if (tx.toAccountId === null) errors.push('TRANSFER_TO_ACCOUNT_REQUIRED');
      if (tx.fromAccountId !== null && tx.toAccountId !== null && tx.fromAccountId === tx.toAccountId) {
        errors.push('TRANSFER_ACCOUNTS_MUST_DIFFER');
      }
      if (tx.categoryId !== null) errors.push('TRANSFER_CATEGORY_FORBIDDEN');
      if (context.categoryKind !== null) errors.push('TRANSFER_CATEGORY_KIND_FORBIDDEN');
      break;
  }

  return errors;
}
