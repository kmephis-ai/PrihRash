import {
  validateTransaction,
  type AnalyticsState,
  type CanonicalTransaction,
  type FlowKind,
  type PeriodAssignmentQuality,
  type TransactionStatus,
  type TransactionType,
} from '../domain/transaction.js';

export const WRITER_TRANSACTION_VOID_CONTRACT_VERSION = 1 as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CANONICAL_TRANSACTION_KEYS = [
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
] as const;

export interface TransactionVoidRequest {
  readonly transactionId: string;
  readonly expectedVersion: number;
}

export interface VersionedTransaction {
  readonly id: string;
  readonly version: number;
  readonly transaction: Readonly<CanonicalTransaction>;
}

export type OptimisticTransactionVoidStoreResult =
  | Readonly<{
    outcome: 'VOIDED';
    current: Readonly<VersionedTransaction>;
  }>
  | Readonly<{
    outcome: 'VERSION_CONFLICT';
    currentVersion: number;
  }>;

export interface OptimisticTransactionVoidStore {
  readCurrent(transactionId: string): Promise<Readonly<VersionedTransaction> | null>;
  voidIfVersion(input: Readonly<{
    transactionId: string;
    expectedVersion: number;
    candidate: Readonly<VersionedTransaction>;
  }>): Promise<OptimisticTransactionVoidStoreResult>;
}

export type TransactionVoidErrorCode =
  | 'INVALID_REQUEST'
  | 'TRANSACTION_NOT_FOUND'
  | 'STORE_OPERATION_FAILED'
  | 'STORE_CONTRACT_INVALID';

export class TransactionVoidError extends Error {
  readonly code: TransactionVoidErrorCode;

  constructor(code: TransactionVoidErrorCode) {
    super(code);
    this.name = 'TransactionVoidError';
    this.code = code;
  }
}

export type TransactionVoidResponse =
  | Readonly<{
    contractVersion: typeof WRITER_TRANSACTION_VOID_CONTRACT_VERSION;
    outcome: 'VOIDED';
    transactionId: string;
    version: number;
    transaction: Readonly<CanonicalTransaction>;
  }>
  | Readonly<{
    contractVersion: typeof WRITER_TRANSACTION_VOID_CONTRACT_VERSION;
    outcome: 'ALREADY_VOIDED';
    transactionId: string;
    version: number;
  }>
  | Readonly<{
    contractVersion: typeof WRITER_TRANSACTION_VOID_CONTRACT_VERSION;
    outcome: 'VERSION_CONFLICT';
    transactionId: string;
    currentVersion: number;
  }>;

function fail(code: TransactionVoidErrorCode): never {
  throw new TransactionVoidError(code);
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalUuid(value: unknown, code: TransactionVoidErrorCode = 'INVALID_REQUEST'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return fail(code);
  return value;
}

function optionalCanonicalUuid(value: unknown): string | null {
  if (value === null) return null;
  return canonicalUuid(value, 'STORE_CONTRACT_INVALID');
}

function positiveVersion(
  value: unknown,
  code: TransactionVoidErrorCode = 'INVALID_REQUEST',
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return fail(code);
  return value as number;
}

function canonicalDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return fail('STORE_CONTRACT_INVALID');
  const parts = value.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return fail('STORE_CONTRACT_INVALID');
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return fail('STORE_CONTRACT_INVALID');
  return value;
}

function optionalCanonicalText(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim().length === 0
    || value !== value.trim()
  ) return fail('STORE_CONTRACT_INVALID');
  return value;
}

function canonicalType(value: unknown): TransactionType {
  if (value !== 'EXPENSE' && value !== 'INCOME' && value !== 'TRANSFER') {
    return fail('STORE_CONTRACT_INVALID');
  }
  return value;
}

function canonicalStatus(value: unknown): TransactionStatus {
  if (value !== 'POSTED' && value !== 'VOIDED') return fail('STORE_CONTRACT_INVALID');
  return value;
}

function canonicalAnalyticsState(value: unknown): AnalyticsState {
  if (value !== 'INCLUDED' && value !== 'EXCLUDED') return fail('STORE_CONTRACT_INVALID');
  return value;
}

function canonicalPeriodQuality(value: unknown): PeriodAssignmentQuality {
  if (
    value !== 'EXPLICIT'
    && value !== 'DERIVED'
    && value !== 'LEGACY_AMBIGUOUS'
    && value !== 'UNASSIGNED'
  ) return fail('STORE_CONTRACT_INVALID');
  return value;
}

function optionalCanonicalFlowKind(value: unknown): FlowKind | null {
  if (value === null) return null;
  if (
    value !== 'OWN_FUNDS_TRANSFER'
    && value !== 'CREDIT_DRAW'
    && value !== 'CREDIT_REPAYMENT'
  ) return fail('STORE_CONTRACT_INVALID');
  return value;
}

export function parseTransactionVoidRequest(value: unknown): Readonly<TransactionVoidRequest> {
  if (!exactKeys(value, ['transactionId', 'expectedVersion'])) return fail('INVALID_REQUEST');
  return Object.freeze({
    transactionId: canonicalUuid(value.transactionId),
    expectedVersion: positiveVersion(value.expectedVersion),
  });
}

function parseStoredTransaction(
  value: unknown,
  expectedId: string,
): Readonly<VersionedTransaction> {
  if (!exactKeys(value, ['id', 'version', 'transaction'])) return fail('STORE_CONTRACT_INVALID');
  const id = canonicalUuid(value.id, 'STORE_CONTRACT_INVALID');
  if (id !== expectedId) return fail('STORE_CONTRACT_INVALID');
  const version = positiveVersion(value.version, 'STORE_CONTRACT_INVALID');
  if (!exactKeys(value.transaction, CANONICAL_TRANSACTION_KEYS)) return fail('STORE_CONTRACT_INVALID');

  const tx = value.transaction;
  const type = canonicalType(tx.type);
  if (tx.recordGranularity !== 'TRANSACTION' || tx.datePrecision !== 'DAY') {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (tx.aggregatePeriodMonth !== null) return fail('STORE_CONTRACT_INVALID');
  const occurredOn = canonicalDate(tx.occurredOn);
  if (!Number.isSafeInteger(tx.amountMinor) || (tx.amountMinor as number) <= 0) {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (tx.currency !== 'RUB') return fail('STORE_CONTRACT_INVALID');

  const transaction: Readonly<CanonicalTransaction> = Object.freeze({
    type,
    occurredOn,
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: optionalCanonicalUuid(tx.financialPeriodId),
    periodAssignmentQuality: canonicalPeriodQuality(tx.periodAssignmentQuality),
    amountMinor: tx.amountMinor as number,
    currency: 'RUB',
    fromAccountId: optionalCanonicalUuid(tx.fromAccountId),
    toAccountId: optionalCanonicalUuid(tx.toAccountId),
    categoryId: optionalCanonicalUuid(tx.categoryId),
    paidByMemberId: optionalCanonicalUuid(tx.paidByMemberId),
    description: optionalCanonicalText(tx.description),
    note: optionalCanonicalText(tx.note),
    status: canonicalStatus(tx.status),
    analyticsState: canonicalAnalyticsState(tx.analyticsState),
    flowKind: optionalCanonicalFlowKind(tx.flowKind),
  });

  if (validateTransaction(transaction, { categoryKind: null }).length !== 0) {
    return fail('STORE_CONTRACT_INVALID');
  }

  return Object.freeze({ id, version, transaction });
}

function sameTransaction(
  left: Readonly<CanonicalTransaction>,
  right: Readonly<CanonicalTransaction>,
): boolean {
  return left.type === right.type
    && left.occurredOn === right.occurredOn
    && left.recordGranularity === right.recordGranularity
    && left.datePrecision === right.datePrecision
    && left.aggregatePeriodMonth === right.aggregatePeriodMonth
    && left.financialPeriodId === right.financialPeriodId
    && left.periodAssignmentQuality === right.periodAssignmentQuality
    && left.amountMinor === right.amountMinor
    && left.currency === right.currency
    && left.fromAccountId === right.fromAccountId
    && left.toAccountId === right.toAccountId
    && left.categoryId === right.categoryId
    && left.paidByMemberId === right.paidByMemberId
    && left.description === right.description
    && left.note === right.note
    && left.status === right.status
    && left.analyticsState === right.analyticsState
    && left.flowKind === right.flowKind;
}

function conflictResponse(
  request: Readonly<TransactionVoidRequest>,
  currentVersion: number,
): Readonly<TransactionVoidResponse> {
  return Object.freeze({
    contractVersion: WRITER_TRANSACTION_VOID_CONTRACT_VERSION,
    outcome: 'VERSION_CONFLICT',
    transactionId: request.transactionId,
    currentVersion,
  });
}

function alreadyVoidedResponse(
  current: Readonly<VersionedTransaction>,
): Readonly<TransactionVoidResponse> {
  return Object.freeze({
    contractVersion: WRITER_TRANSACTION_VOID_CONTRACT_VERSION,
    outcome: 'ALREADY_VOIDED',
    transactionId: current.id,
    version: current.version,
  });
}

function buildVoidedCandidate(
  current: Readonly<VersionedTransaction>,
): Readonly<VersionedTransaction> {
  const nextVersion = current.version + 1;
  if (!Number.isSafeInteger(nextVersion)) return fail('STORE_CONTRACT_INVALID');
  const transaction: Readonly<CanonicalTransaction> = Object.freeze({
    ...current.transaction,
    status: 'VOIDED',
  });
  if (validateTransaction(transaction, { categoryKind: null }).length !== 0) {
    return fail('STORE_CONTRACT_INVALID');
  }
  return Object.freeze({
    id: current.id,
    version: nextVersion,
    transaction,
  });
}

function validateVoidResult(
  value: unknown,
  request: Readonly<TransactionVoidRequest>,
  candidate: Readonly<VersionedTransaction>,
): Readonly<TransactionVoidResponse> {
  if (exactKeys(value, ['outcome', 'currentVersion']) && value.outcome === 'VERSION_CONFLICT') {
    const currentVersion = positiveVersion(value.currentVersion, 'STORE_CONTRACT_INVALID');
    if (currentVersion <= request.expectedVersion) return fail('STORE_CONTRACT_INVALID');
    return conflictResponse(request, currentVersion);
  }
  if (!exactKeys(value, ['outcome', 'current']) || value.outcome !== 'VOIDED') {
    return fail('STORE_CONTRACT_INVALID');
  }
  const current = parseStoredTransaction(value.current, request.transactionId);
  if (
    current.version !== candidate.version
    || current.transaction.status !== 'VOIDED'
    || !sameTransaction(current.transaction, candidate.transaction)
  ) return fail('STORE_CONTRACT_INVALID');

  return Object.freeze({
    contractVersion: WRITER_TRANSACTION_VOID_CONTRACT_VERSION,
    outcome: 'VOIDED',
    transactionId: current.id,
    version: current.version,
    transaction: current.transaction,
  });
}

export async function executeOptimisticTransactionVoid(
  dependencies: Readonly<{ store: OptimisticTransactionVoidStore }>,
  input: unknown,
): Promise<Readonly<TransactionVoidResponse>> {
  const request = parseTransactionVoidRequest(input);

  let currentRaw: Readonly<VersionedTransaction> | null;
  try {
    currentRaw = await dependencies.store.readCurrent(request.transactionId);
  } catch {
    return fail('STORE_OPERATION_FAILED');
  }
  if (currentRaw === null) return fail('TRANSACTION_NOT_FOUND');
  const current = parseStoredTransaction(currentRaw, request.transactionId);

  if (current.version !== request.expectedVersion) {
    return conflictResponse(request, current.version);
  }
  if (current.transaction.status === 'VOIDED') {
    return alreadyVoidedResponse(current);
  }

  const candidate = buildVoidedCandidate(current);
  let result: OptimisticTransactionVoidStoreResult;
  try {
    result = await dependencies.store.voidIfVersion({
      transactionId: request.transactionId,
      expectedVersion: request.expectedVersion,
      candidate,
    });
  } catch {
    return fail('STORE_OPERATION_FAILED');
  }
  return validateVoidResult(result, request, candidate);
}
