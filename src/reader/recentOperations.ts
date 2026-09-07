import {
  validateTransaction,
  type AnalyticsState,
  type CategoryKind,
  type DatePrecision,
  type FlowKind,
  type PeriodAssignmentQuality,
  type RecordGranularity,
  type TransactionStatus,
  type TransactionType,
} from '../domain/transaction.js';
import { readStatement, YdbAdapter, type YdbStatement } from '../integration/ydb/adapter.js';
import { uint64Parameter, utf8Parameter, uuidParameter } from '../integration/ydb/parameters.js';

export const READER_RECENT_OPERATIONS_DEFAULT_LIMIT = 50 as const;
export const READER_RECENT_OPERATIONS_MAX_LIMIT = 100 as const;

export interface ReaderEntityRef {
  readonly id: string;
  readonly label: string;
}

export interface ReaderOperation {
  readonly id: string;
  readonly type: TransactionType;
  readonly occurredOn: string;
  readonly capturedAt: string;
  readonly recordGranularity: RecordGranularity;
  readonly datePrecision: DatePrecision;
  readonly aggregatePeriodMonth: string | null;
  readonly financialPeriodId: string | null;
  readonly periodAssignmentQuality: PeriodAssignmentQuality;
  readonly amountMinor: number;
  readonly currency: 'RUB';
  readonly fromAccount: Readonly<ReaderEntityRef> | null;
  readonly toAccount: Readonly<ReaderEntityRef> | null;
  readonly category: Readonly<ReaderEntityRef> | null;
  readonly paidByMember: Readonly<ReaderEntityRef> | null;
  readonly description: string | null;
  readonly note: string | null;
  readonly status: TransactionStatus;
  readonly analyticsState: AnalyticsState;
  readonly flowKind: FlowKind | null;
  readonly version: number;
}

export interface ReaderRecentOperationsFilters {
  readonly type?: TransactionType;
  readonly status?: TransactionStatus;
  readonly accountId?: string;
  readonly categoryId?: string;
}

export interface ReaderRecentOperationsResult {
  readonly items: readonly Readonly<ReaderOperation>[];
  readonly limit: number;
}

export type ReaderRecentOperationsErrorCode =
  | 'INVALID_LIMIT'
  | 'INVALID_FILTER'
  | 'MALFORMED_READER_EVIDENCE';

export class ReaderRecentOperationsError extends Error {
  readonly code: ReaderRecentOperationsErrorCode;

  constructor(code: ReaderRecentOperationsErrorCode) {
    super(code);
    this.name = 'ReaderRecentOperationsError';
    this.code = code;
  }
}

interface ReaderOperationRow {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly occurred_on?: unknown;
  readonly captured_at?: unknown;
  readonly record_granularity?: unknown;
  readonly date_precision?: unknown;
  readonly aggregate_period_month?: unknown;
  readonly financial_period_id?: unknown;
  readonly period_assignment_quality?: unknown;
  readonly amount_minor?: unknown;
  readonly currency?: unknown;
  readonly from_account_id?: unknown;
  readonly from_account_name?: unknown;
  readonly to_account_id?: unknown;
  readonly to_account_name?: unknown;
  readonly category_id?: unknown;
  readonly category_name?: unknown;
  readonly category_kind?: unknown;
  readonly paid_by_member_id?: unknown;
  readonly paid_by_member_name?: unknown;
  readonly description?: unknown;
  readonly note?: unknown;
  readonly status?: unknown;
  readonly analytics_state?: unknown;
  readonly flow_kind?: unknown;
  readonly version?: unknown;
}

interface MutableReaderRecentOperationsFilters {
  type?: TransactionType;
  status?: TransactionStatus;
  accountId?: string;
  categoryId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TYPES = new Set<TransactionType>(['EXPENSE', 'INCOME', 'TRANSFER']);
const GRANULARITIES = new Set<RecordGranularity>(['TRANSACTION', 'PERIOD_AGGREGATE', 'UNKNOWN']);
const DATE_PRECISIONS = new Set<DatePrecision>(['DAY', 'MONTH', 'UNKNOWN']);
const PERIOD_QUALITIES = new Set<PeriodAssignmentQuality>(['EXPLICIT', 'DERIVED', 'LEGACY_AMBIGUOUS', 'UNASSIGNED']);
const STATUSES = new Set<TransactionStatus>(['POSTED', 'VOIDED']);
const ANALYTICS_STATES = new Set<AnalyticsState>(['INCLUDED', 'EXCLUDED']);
const FLOW_KINDS = new Set<FlowKind>(['OWN_FUNDS_TRANSFER', 'CREDIT_DRAW', 'CREDIT_REPAYMENT']);
const CATEGORY_KINDS = new Set<CategoryKind>(['EXPENSE', 'INCOME']);

function fail(): never {
  throw new ReaderRecentOperationsError('MALFORMED_READER_EVIDENCE');
}

function invalidFilter(): never {
  throw new ReaderRecentOperationsError('INVALID_FILTER');
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return READER_RECENT_OPERATIONS_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > READER_RECENT_OPERATIONS_MAX_LIMIT) {
    throw new ReaderRecentOperationsError('INVALID_LIMIT');
  }
  return limit;
}

function normalizeFilters(
  filters: Readonly<ReaderRecentOperationsFilters> | undefined,
): Readonly<ReaderRecentOperationsFilters> {
  if (filters === undefined) return Object.freeze({});
  const normalized: MutableReaderRecentOperationsFilters = {};

  if (filters.type !== undefined) {
    if (!TYPES.has(filters.type)) return invalidFilter();
    normalized.type = filters.type;
  }
  if (filters.status !== undefined) {
    if (!STATUSES.has(filters.status)) return invalidFilter();
    normalized.status = filters.status;
  }
  if (filters.accountId !== undefined) {
    if (!UUID_PATTERN.test(filters.accountId)) return invalidFilter();
    normalized.accountId = filters.accountId.toLowerCase();
  }
  if (filters.categoryId !== undefined) {
    if (!UUID_PATTERN.test(filters.categoryId)) return invalidFilter();
    normalized.categoryId = filters.categoryId.toLowerCase();
  }

  return Object.freeze(normalized);
}

function stringValue(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return fail();
  return value;
}

function uuid(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  const parsed = stringValue(value, false);
  if (parsed === null || !UUID_PATTERN.test(parsed)) return fail();
  return parsed.toLowerCase();
}

function date(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  const parsed = stringValue(value, false);
  if (parsed === null || !DATE_PATTERN.test(parsed) || !Number.isFinite(Date.parse(`${parsed}T00:00:00.000Z`))) return fail();
  return parsed;
}

function timestamp(value: unknown): string {
  const parsed = stringValue(value, false);
  if (parsed === null || !Number.isFinite(Date.parse(parsed))) return fail();
  return parsed;
}

function integer(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return fail();
}

function positiveInteger(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 1) return fail();
  return parsed;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) return fail();
  return value as T;
}

function optionalEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | null {
  if (value === null) return null;
  return enumValue(value, allowed);
}

function entityRef(idValue: unknown, labelValue: unknown): Readonly<ReaderEntityRef> | null {
  const id = uuid(idValue, true);
  if (id === null) {
    if (labelValue !== null) return fail();
    return null;
  }
  const label = stringValue(labelValue, false);
  if (label === null) return fail();
  return Object.freeze({ id, label });
}

function parseOperation(row: Readonly<ReaderOperationRow>): Readonly<ReaderOperation> {
  const id = uuid(row.id, false);
  const type = enumValue(row.type, TYPES);
  const occurredOn = date(row.occurred_on, false);
  const capturedAt = timestamp(row.captured_at);
  const recordGranularity = enumValue(row.record_granularity, GRANULARITIES);
  const datePrecision = enumValue(row.date_precision, DATE_PRECISIONS);
  const aggregatePeriodMonth = date(row.aggregate_period_month, true);
  const financialPeriodId = uuid(row.financial_period_id, true);
  const periodAssignmentQuality = enumValue(row.period_assignment_quality, PERIOD_QUALITIES);
  const amountMinor = positiveInteger(row.amount_minor);
  if (row.currency !== 'RUB') return fail();

  const fromAccount = entityRef(row.from_account_id, row.from_account_name);
  const toAccount = entityRef(row.to_account_id, row.to_account_name);
  const category = entityRef(row.category_id, row.category_name);
  const paidByMember = entityRef(row.paid_by_member_id, row.paid_by_member_name);
  const categoryKind = optionalEnum(row.category_kind, CATEGORY_KINDS);
  if ((category === null) !== (categoryKind === null)) return fail();

  const description = row.description === null ? null : stringValue(row.description, false);
  const note = row.note === null ? null : stringValue(row.note, false);
  const status = enumValue(row.status, STATUSES);
  const analyticsState = enumValue(row.analytics_state, ANALYTICS_STATES);
  const flowKind = optionalEnum(row.flow_kind, FLOW_KINDS);
  const version = positiveInteger(row.version);

  if (id === null || occurredOn === null) return fail();

  const validation = validateTransaction({
    type,
    occurredOn,
    recordGranularity,
    datePrecision,
    aggregatePeriodMonth,
    financialPeriodId,
    periodAssignmentQuality,
    amountMinor,
    currency: 'RUB',
    fromAccountId: fromAccount?.id ?? null,
    toAccountId: toAccount?.id ?? null,
    categoryId: category?.id ?? null,
    paidByMemberId: paidByMember?.id ?? null,
    description,
    note,
    status,
    analyticsState,
    flowKind,
  }, { categoryKind });
  if (validation.length > 0) return fail();

  return Object.freeze({
    id,
    type,
    occurredOn,
    capturedAt,
    recordGranularity,
    datePrecision,
    aggregatePeriodMonth,
    financialPeriodId,
    periodAssignmentQuality,
    amountMinor,
    currency: 'RUB' as const,
    fromAccount,
    toAccount,
    category,
    paidByMember,
    description,
    note,
    status,
    analyticsState,
    flowKind,
    version,
  });
}

export function recentOperationsStatement(
  limit: number,
  filters?: Readonly<ReaderRecentOperationsFilters>,
): Readonly<YdbStatement> {
  const normalizedLimit = normalizeLimit(limit);
  const normalizedFilters = normalizeFilters(filters);
  const clauses: string[] = [];
  const parameters: Record<string, ReturnType<typeof uint64Parameter>> = {
    limit: uint64Parameter(normalizedLimit),
  };

  if (normalizedFilters.type !== undefined) {
    clauses.push('t.type = $type');
    parameters.type = utf8Parameter(normalizedFilters.type);
  }
  if (normalizedFilters.status !== undefined) {
    clauses.push('t.status = $status');
    parameters.status = utf8Parameter(normalizedFilters.status);
  }
  if (normalizedFilters.accountId !== undefined) {
    clauses.push('(t.from_account_id = $account_id OR t.to_account_id = $account_id)');
    parameters.account_id = uuidParameter(normalizedFilters.accountId);
  }
  if (normalizedFilters.categoryId !== undefined) {
    clauses.push('t.category_id = $category_id');
    parameters.category_id = uuidParameter(normalizedFilters.categoryId);
  }

  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')} `;
  return readStatement(
    'SELECT t.id, t.type, t.occurred_on, t.captured_at, t.record_granularity, t.date_precision, '
      + 't.aggregate_period_month, t.financial_period_id, t.period_assignment_quality, t.amount_minor, '
      + 't.currency, t.from_account_id, fa.name AS from_account_name, t.to_account_id, ta.name AS to_account_name, '
      + 't.category_id, c.name AS category_name, c.kind AS category_kind, t.paid_by_member_id, '
      + 'fm.name AS paid_by_member_name, t.description, t.note, t.status, t.analytics_state, t.flow_kind, t.version '
      + 'FROM transactions AS t '
      + 'LEFT JOIN accounts AS fa ON fa.id = t.from_account_id '
      + 'LEFT JOIN accounts AS ta ON ta.id = t.to_account_id '
      + 'LEFT JOIN categories AS c ON c.id = t.category_id '
      + 'LEFT JOIN family_members AS fm ON fm.id = t.paid_by_member_id '
      + where
      + 'ORDER BY t.occurred_on DESC, t.captured_at DESC, t.id DESC LIMIT $limit',
    parameters,
  );
}

export async function readRecentOperations(
  adapter: YdbAdapter,
  limit?: number,
  filters?: Readonly<ReaderRecentOperationsFilters>,
): Promise<Readonly<ReaderRecentOperationsResult>> {
  const normalizedLimit = normalizeLimit(limit);
  const normalizedFilters = normalizeFilters(filters);
  const result = await adapter.read<ReaderOperationRow>(recentOperationsStatement(normalizedLimit, normalizedFilters));
  const items = result.rows.map(parseOperation);
  return Object.freeze({
    items: Object.freeze(items),
    limit: normalizedLimit,
  });
}
