import type { CanonicalTransaction } from '../domain/transaction.js';
import {
  classifyHistoricalGranularity,
  type InitialSnapshotGranularityEvidence,
} from '../normalization/historicalGranularity.js';
import type { ReferenceResolver } from '../normalization/types.js';
import {
  projectFinancialTransaction,
  type FinancialProjectionErrorCode,
} from './financialProjection.js';
import type { RawPayload } from './rawPayloadDecoder.js';

export interface InitialFinancialProjectionInput {
  readonly rawPayload: RawPayload;
  readonly initialSourceOrdinal: number | null;
  readonly aggregatePeriodMonth: string | null;
}

export interface InitialFinancialProjectionContext {
  readonly granularityEvidence: InitialSnapshotGranularityEvidence;
  readonly refs: ReferenceResolver;
}

export type InitialFinancialProjectionErrorCode = FinancialProjectionErrorCode;

export type InitialFinancialProjectionResult =
  | Readonly<{ ok: true; transaction: Readonly<CanonicalTransaction> }>
  | Readonly<{
      ok: false;
      stage: 'DECODE' | 'GRANULARITY' | 'NORMALIZATION' | 'DOMAIN';
      errorCode: InitialFinancialProjectionErrorCode;
      details?: readonly string[];
    }>;

export function projectInitialFinancialTransaction(
  input: InitialFinancialProjectionInput,
  context: InitialFinancialProjectionContext,
): InitialFinancialProjectionResult {
  const operationType = typeof input.rawPayload.operation_type === 'object'
    && input.rawPayload.operation_type?.kind === 'STRING'
    ? input.rawPayload.operation_type.value
    : null;
  const granularity = classifyHistoricalGranularity({
    operationType,
    initialSourceOrdinal: input.initialSourceOrdinal,
    isPositiveFinancialCandidate: true,
  }, context.granularityEvidence);

  return projectFinancialTransaction({
    rawPayload: input.rawPayload,
    recordGranularity: granularity.recordGranularity,
    datePrecision: granularity.datePrecision,
    aggregatePeriodMonth: operationType === 'Расход' ? input.aggregatePeriodMonth : null,
  }, { refs: context.refs });
}
