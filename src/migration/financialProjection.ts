import {
  validateTransaction,
  type CanonicalTransaction,
  type DatePrecision,
  type RecordGranularity,
} from '../domain/transaction.js';
import { normalizeExpense } from '../normalization/expense.js';
import { normalizeIncome } from '../normalization/income.js';
import type { NormalizationErrorCode, ReferenceResolver } from '../normalization/types.js';
import {
  decodeLegacyFinancialRawPayload,
  type RawPayloadDecodeErrorCode,
  type RawPayloadV2,
} from './rawPayloadDecoder.js';

export interface FinancialProjectionInput {
  readonly rawPayload: RawPayloadV2;
  readonly recordGranularity: RecordGranularity;
  readonly datePrecision: DatePrecision;
  readonly aggregatePeriodMonth: string | null;
}

export interface FinancialProjectionContext {
  readonly refs: ReferenceResolver;
}

export type FinancialProjectionErrorCode =
  | RawPayloadDecodeErrorCode
  | NormalizationErrorCode
  | 'NOT_POSITIVE_FINANCIAL_RECORD'
  | 'AGGREGATE_PERIOD_MONTH_REQUIRED'
  | 'INVALID_AGGREGATE_PERIOD_MONTH'
  | 'AGGREGATE_PERIOD_MONTH_UNEXPECTED'
  | 'CANONICAL_TRANSACTION_INVALID';

export type FinancialProjectionResult =
  | Readonly<{ ok: true; transaction: Readonly<CanonicalTransaction> }>
  | Readonly<{
      ok: false;
      stage: 'DECODE' | 'GRANULARITY' | 'NORMALIZATION' | 'DOMAIN';
      errorCode: FinancialProjectionErrorCode;
      details?: readonly string[];
    }>;

const AGGREGATE_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;

function failure(
  stage: 'DECODE' | 'GRANULARITY' | 'NORMALIZATION' | 'DOMAIN',
  errorCode: FinancialProjectionErrorCode,
  details?: readonly string[],
): FinancialProjectionResult {
  return Object.freeze(details === undefined
    ? { ok: false as const, stage, errorCode }
    : { ok: false as const, stage, errorCode, details: Object.freeze([...details]) });
}

export function projectFinancialTransaction(
  input: FinancialProjectionInput,
  context: FinancialProjectionContext,
): FinancialProjectionResult {
  const decoded = decodeLegacyFinancialRawPayload(input.rawPayload);
  if (!decoded.ok) return failure('DECODE', decoded.errorCode);

  if (!Number.isSafeInteger(decoded.value.amountMinor) || decoded.value.amountMinor <= 0) {
    return failure('NORMALIZATION', 'NOT_POSITIVE_FINANCIAL_RECORD');
  }

  let aggregatePeriodMonth: string | null = null;
  if (input.recordGranularity === 'PERIOD_AGGREGATE') {
    if (input.aggregatePeriodMonth === null) {
      return failure('GRANULARITY', 'AGGREGATE_PERIOD_MONTH_REQUIRED');
    }
    if (!AGGREGATE_MONTH_PATTERN.test(input.aggregatePeriodMonth)) {
      return failure('GRANULARITY', 'INVALID_AGGREGATE_PERIOD_MONTH');
    }
    aggregatePeriodMonth = input.aggregatePeriodMonth;
  } else if (input.aggregatePeriodMonth !== null) {
    return failure('GRANULARITY', 'AGGREGATE_PERIOD_MONTH_UNEXPECTED');
  }

  const candidate = {
    ...decoded.value,
    recordGranularity: input.recordGranularity,
    datePrecision: input.datePrecision,
    aggregatePeriodMonth,
  };

  const normalized = decoded.value.operationType === 'Расход'
    ? normalizeExpense(candidate, context.refs)
    : normalizeIncome(candidate, context.refs);
  if (!normalized.ok) return failure('NORMALIZATION', normalized.errorCode);

  const validationErrors = validateTransaction(normalized.transaction, {
    categoryKind: normalized.transaction.type === 'EXPENSE' ? 'EXPENSE' : 'INCOME',
  });
  if (validationErrors.length > 0) {
    return failure('DOMAIN', 'CANONICAL_TRANSACTION_INVALID', validationErrors);
  }

  return Object.freeze({
    ok: true as const,
    transaction: Object.freeze({ ...normalized.transaction }),
  });
}
