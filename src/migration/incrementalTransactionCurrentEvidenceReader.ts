import {
  type AnalyticsState,
  type CanonicalTransaction,
  type DatePrecision,
  type FlowKind,
  type PeriodAssignmentQuality,
  type RecordGranularity,
  type TransactionStatus,
  type TransactionType,
  validateTransaction,
} from '../domain/transaction.js';
import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import type { IncrementalPreviousTransactionCurrentEvidence } from './incrementalTransactionCurrentCandidate.js';

interface TransactionCurrentEvidenceRow {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly occurred_on?: unknown;
  readonly record_granularity?: unknown;
  readonly date_precision?: unknown;
  readonly aggregate_period_month?: unknown;
  readonly financial_period_id?: unknown;
  readonly period_assignment_quality?: unknown;
  readonly amount_minor?: unknown;
  readonly currency?: unknown;
  readonly from_account_id?: unknown;
  readonly to_account_id?: unknown;
  readonly category_id?: unknown;
  readonly paid_by_member_id?: unknown;
  readonly description?: unknown;
  readonly note?: unknown;
  readonly status?: unknown;
  readonly analytics_state?: unknown;
  readonly flow_kind?: unknown;
  readonly version?: unknown;
}

export type IncrementalTransactionCurrentEvidenceReaderErrorCode =
  | 'MALFORMED_TRANSACTION_CURRENT_EVIDENCE'
  | 'DUPLICATE_TRANSACTION_ID';

export class IncrementalTransactionCurrentEvidenceReaderError extends Error {
  readonly code: IncrementalTransactionCurrentEvidenceReaderErrorCode;

  constructor(code: IncrementalTransactionCurrentEvidenceReaderErrorCode) {
    super(code);
    this.name = 'IncrementalTransactionCurrentEvidenceReaderError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function malformed(): never {
  throw new IncrementalTransactionCurrentEvidenceReaderError('MALFORMED_TRANSACTION_CURRENT_EVIDENCE');
}

function requiredUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) malformed();
  return value.toLowerCase();
}

function optionalUuid(value: unknown): string | null {
  if (value === null) return null;
  return requiredUuid(value);
}

function date(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) malformed();
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) malformed();
  return value as T;
}

function positiveInteger(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) malformed();
    return Number(value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) malformed();
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') malformed();
  return value;
}

function parseRow(row: Readonly<TransactionCurrentEvidenceRow>): Readonly<IncrementalPreviousTransactionCurrentEvidence> {
  const id = requiredUuid(row.id);
  const transaction: CanonicalTransaction = {
    type: enumValue<TransactionType>(row.type, ['EXPENSE', 'INCOME', 'TRANSFER']),
    occurredOn: date(row.occurred_on) as string,
    recordGranularity: enumValue<RecordGranularity>(row.record_granularity, ['TRANSACTION', 'PERIOD_AGGREGATE', 'UNKNOWN']),
    datePrecision: enumValue<DatePrecision>(row.date_precision, ['DAY', 'MONTH', 'UNKNOWN']),
    aggregatePeriodMonth: date(row.aggregate_period_month, true),
    financialPeriodId: optionalUuid(row.financial_period_id),
    periodAssignmentQuality: enumValue<PeriodAssignmentQuality>(row.period_assignment_quality, ['EXPLICIT', 'DERIVED', 'LEGACY_AMBIGUOUS', 'UNASSIGNED']),
    amountMinor: positiveInteger(row.amount_minor),
    currency: enumValue(row.currency, ['RUB'] as const),
    fromAccountId: optionalUuid(row.from_account_id),
    toAccountId: optionalUuid(row.to_account_id),
    categoryId: optionalUuid(row.category_id),
    paidByMemberId: optionalUuid(row.paid_by_member_id),
    description: nullableText(row.description),
    note: nullableText(row.note),
    status: enumValue<TransactionStatus>(row.status, ['POSTED', 'VOIDED']),
    analyticsState: enumValue<AnalyticsState>(row.analytics_state, ['INCLUDED', 'EXCLUDED']),
    flowKind: row.flow_kind === null ? null : enumValue<FlowKind>(row.flow_kind, ['OWN_FUNDS_TRANSFER', 'CREDIT_DRAW', 'CREDIT_REPAYMENT']),
  };

  if (validateTransaction(transaction, { categoryKind: null }).length !== 0) malformed();

  return Object.freeze({
    id,
    transaction: Object.freeze(transaction),
    version: positiveInteger(row.version),
  });
}

export async function readIncrementalTransactionCurrentEvidence(
  adapter: YdbAdapter,
): Promise<readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[]> {
  const statement = readStatement(
    'SELECT id, type, occurred_on, record_granularity, date_precision, aggregate_period_month, financial_period_id, '
      + 'period_assignment_quality, amount_minor, currency, from_account_id, to_account_id, category_id, '
      + 'paid_by_member_id, description, note, status, analytics_state, flow_kind, version FROM transactions',
  );
  const result = await adapter.read<TransactionCurrentEvidenceRow>(statement);

  const seen = new Set<string>();
  const evidence: Readonly<IncrementalPreviousTransactionCurrentEvidence>[] = [];
  for (const row of result.rows) {
    const parsed = parseRow(row);
    if (seen.has(parsed.id)) {
      throw new IncrementalTransactionCurrentEvidenceReaderError('DUPLICATE_TRANSACTION_ID');
    }
    seen.add(parsed.id);
    evidence.push(parsed);
  }
  evidence.sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze(evidence);
}
