import {
  validateTransaction,
  type AnalyticsState,
  type CanonicalTransaction,
  type CategoryKind,
  type PeriodAssignmentQuality,
} from '../domain/transaction.js';

export const WRITER_EXPENSE_EDIT_CONTRACT_VERSION = 1 as const;

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

export interface ExpenseEditRequest {
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly occurredOn: string;
  readonly amountMinor: number;
  readonly currency: 'RUB';
  readonly fromAccountId: string;
  readonly categoryId: string;
  readonly paidByMemberId: string | null;
  readonly description: string | null;
  readonly note: string | null;
}

export interface ExpenseEditReferenceEvidence {
  readonly accountId: string;
  readonly categoryId: string;
  readonly categoryKind: CategoryKind;
  readonly memberId: string | null;
}

export interface ExpenseEditReferenceReader {
  readExpenseEditReferenceEvidence(
    request: Readonly<Pick<ExpenseEditRequest, 'fromAccountId' | 'categoryId' | 'paidByMemberId'>>,
  ): Promise<Readonly<ExpenseEditReferenceEvidence> | null>;
}

export interface VersionedExpenseTransaction {
  readonly id: string;
  readonly version: number;
  readonly transaction: Readonly<CanonicalTransaction>;
}

export type OptimisticExpenseReplaceResult =
  | Readonly<{
    outcome: 'UPDATED';
    current: Readonly<VersionedExpenseTransaction>;
  }>
  | Readonly<{
    outcome: 'VERSION_CONFLICT';
    currentVersion: number;
  }>;

export interface OptimisticExpenseEditStore {
  readCurrent(transactionId: string): Promise<Readonly<VersionedExpenseTransaction> | null>;
  replaceIfVersion(input: Readonly<{
    transactionId: string;
    expectedVersion: number;
    candidate: Readonly<VersionedExpenseTransaction>;
  }>): Promise<OptimisticExpenseReplaceResult>;
}

export type ExpenseEditErrorCode =
  | 'INVALID_REQUEST'
  | 'TRANSACTION_NOT_FOUND'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_MISMATCH'
  | 'CATEGORY_KIND_INVALID'
  | 'REFERENCE_READ_FAILED'
  | 'STORE_OPERATION_FAILED'
  | 'STORE_CONTRACT_INVALID';

export class ExpenseEditError extends Error {
  readonly code: ExpenseEditErrorCode;

  constructor(code: ExpenseEditErrorCode) {
    super(code);
    this.name = 'ExpenseEditError';
    this.code = code;
  }
}

export type ExpenseEditResponse =
  | Readonly<{
    contractVersion: typeof WRITER_EXPENSE_EDIT_CONTRACT_VERSION;
    outcome: 'UPDATED';
    transactionId: string;
    version: number;
    transaction: Readonly<CanonicalTransaction>;
  }>
  | Readonly<{
    contractVersion: typeof WRITER_EXPENSE_EDIT_CONTRACT_VERSION;
    outcome: 'VERSION_CONFLICT';
    transactionId: string;
    currentVersion: number;
  }>;

function fail(code: ExpenseEditErrorCode): never {
  throw new ExpenseEditError(code);
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalUuid(value: unknown, code: ExpenseEditErrorCode = 'INVALID_REQUEST'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return fail(code);
  return value;
}

function canonicalDate(value: unknown, code: ExpenseEditErrorCode = 'INVALID_REQUEST'): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return fail(code);
  const parts = value.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return fail(code);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return fail(code);
  return value;
}

function positiveVersion(value: unknown, code: ExpenseEditErrorCode = 'INVALID_REQUEST'): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return fail(code);
  return value as number;
}

function optionalCanonicalText(
  value: unknown,
  code: ExpenseEditErrorCode = 'INVALID_REQUEST',
): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim().length === 0
    || value !== value.trim()
  ) return fail(code);
  return value;
}

function optionalCanonicalUuid(
  value: unknown,
  code: ExpenseEditErrorCode = 'INVALID_REQUEST',
): string | null {
  if (value === null) return null;
  return canonicalUuid(value, code);
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

function canonicalAnalyticsState(value: unknown): AnalyticsState {
  if (value !== 'INCLUDED' && value !== 'EXCLUDED') return fail('STORE_CONTRACT_INVALID');
  return value;
}

export function parseExpenseEditRequest(value: unknown): Readonly<ExpenseEditRequest> {
  if (!exactKeys(value, [
    'transactionId',
    'expectedVersion',
    'occurredOn',
    'amountMinor',
    'currency',
    'fromAccountId',
    'categoryId',
    'paidByMemberId',
    'description',
    'note',
  ])) return fail('INVALID_REQUEST');

  if (value.currency !== 'RUB') return fail('INVALID_REQUEST');
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) <= 0) {
    return fail('INVALID_REQUEST');
  }

  return Object.freeze({
    transactionId: canonicalUuid(value.transactionId),
    expectedVersion: positiveVersion(value.expectedVersion),
    occurredOn: canonicalDate(value.occurredOn),
    amountMinor: value.amountMinor as number,
    currency: 'RUB',
    fromAccountId: canonicalUuid(value.fromAccountId),
    categoryId: canonicalUuid(value.categoryId),
    paidByMemberId: optionalCanonicalUuid(value.paidByMemberId),
    description: optionalCanonicalText(value.description),
    note: optionalCanonicalText(value.note),
  });
}

function parseStoredExpense(
  value: unknown,
  expectedId: string,
): Readonly<VersionedExpenseTransaction> {
  if (!exactKeys(value, ['id', 'version', 'transaction'])) return fail('STORE_CONTRACT_INVALID');
  const id = canonicalUuid(value.id, 'STORE_CONTRACT_INVALID');
  if (id !== expectedId) return fail('STORE_CONTRACT_INVALID');
  const version = positiveVersion(value.version, 'STORE_CONTRACT_INVALID');
  if (!exactKeys(value.transaction, CANONICAL_TRANSACTION_KEYS)) return fail('STORE_CONTRACT_INVALID');

  const tx = value.transaction;
  if (tx.type !== 'EXPENSE') return fail('STORE_CONTRACT_INVALID');
  if (tx.recordGranularity !== 'TRANSACTION' || tx.datePrecision !== 'DAY') {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (tx.aggregatePeriodMonth !== null) return fail('STORE_CONTRACT_INVALID');
  const occurredOn = canonicalDate(tx.occurredOn, 'STORE_CONTRACT_INVALID');
  if (!Number.isSafeInteger(tx.amountMinor) || (tx.amountMinor as number) <= 0) {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (tx.currency !== 'RUB') return fail('STORE_CONTRACT_INVALID');
  const fromAccountId = canonicalUuid(tx.fromAccountId, 'STORE_CONTRACT_INVALID');
  if (tx.toAccountId !== null) return fail('STORE_CONTRACT_INVALID');
  const categoryId = canonicalUuid(tx.categoryId, 'STORE_CONTRACT_INVALID');
  const paidByMemberId = optionalCanonicalUuid(tx.paidByMemberId, 'STORE_CONTRACT_INVALID');
  const description = optionalCanonicalText(tx.description, 'STORE_CONTRACT_INVALID');
  const note = optionalCanonicalText(tx.note, 'STORE_CONTRACT_INVALID');
  if (tx.status !== 'POSTED' || tx.flowKind !== null) return fail('STORE_CONTRACT_INVALID');
  const analyticsState = canonicalAnalyticsState(tx.analyticsState);
  const financialPeriodId = optionalCanonicalUuid(tx.financialPeriodId, 'STORE_CONTRACT_INVALID');
  const periodAssignmentQuality = canonicalPeriodQuality(tx.periodAssignmentQuality);

  const transaction: Readonly<CanonicalTransaction> = Object.freeze({
    type: 'EXPENSE',
    occurredOn,
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId,
    periodAssignmentQuality,
    amountMinor: tx.amountMinor as number,
    currency: 'RUB',
    fromAccountId,
    toAccountId: null,
    categoryId,
    paidByMemberId,
    description,
    note,
    status: 'POSTED',
    analyticsState,
    flowKind: null,
  });
  if (validateTransaction(transaction, { categoryKind: 'EXPENSE' }).length !== 0) {
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

function parseReferenceEvidence(
  value: Readonly<ExpenseEditReferenceEvidence> | null,
  request: Readonly<ExpenseEditRequest>,
): void {
  if (value === null) return fail('REFERENCE_NOT_FOUND');
  if (!exactKeys(value, ['accountId', 'categoryId', 'categoryKind', 'memberId'])) {
    return fail('REFERENCE_MISMATCH');
  }
  const accountId = canonicalUuid(value.accountId, 'REFERENCE_MISMATCH');
  const categoryId = canonicalUuid(value.categoryId, 'REFERENCE_MISMATCH');
  const memberId = optionalCanonicalUuid(value.memberId, 'REFERENCE_MISMATCH');
  if (
    accountId !== request.fromAccountId
    || categoryId !== request.categoryId
    || memberId !== request.paidByMemberId
  ) return fail('REFERENCE_MISMATCH');
  if (value.categoryKind !== 'EXPENSE') return fail('CATEGORY_KIND_INVALID');
}

function buildEditedExpense(
  current: Readonly<VersionedExpenseTransaction>,
  request: Readonly<ExpenseEditRequest>,
): Readonly<VersionedExpenseTransaction> {
  const nextVersion = current.version + 1;
  if (!Number.isSafeInteger(nextVersion)) return fail('INVALID_REQUEST');
  const transaction: Readonly<CanonicalTransaction> = Object.freeze({
    ...current.transaction,
    occurredOn: request.occurredOn,
    amountMinor: request.amountMinor,
    currency: 'RUB',
    fromAccountId: request.fromAccountId,
    categoryId: request.categoryId,
    paidByMemberId: request.paidByMemberId,
    description: request.description,
    note: request.note,
  });
  if (validateTransaction(transaction, { categoryKind: 'EXPENSE' }).length !== 0) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    id: current.id,
    version: nextVersion,
    transaction,
  });
}

function conflictResponse(
  request: Readonly<ExpenseEditRequest>,
  currentVersion: number,
): Readonly<ExpenseEditResponse> {
  return Object.freeze({
    contractVersion: WRITER_EXPENSE_EDIT_CONTRACT_VERSION,
    outcome: 'VERSION_CONFLICT',
    transactionId: request.transactionId,
    currentVersion,
  });
}

function validateReplaceResult(
  value: unknown,
  request: Readonly<ExpenseEditRequest>,
  candidate: Readonly<VersionedExpenseTransaction>,
): Readonly<ExpenseEditResponse> {
  if (exactKeys(value, ['outcome', 'currentVersion']) && value.outcome === 'VERSION_CONFLICT') {
    const currentVersion = positiveVersion(value.currentVersion, 'STORE_CONTRACT_INVALID');
    if (currentVersion <= request.expectedVersion) return fail('STORE_CONTRACT_INVALID');
    return conflictResponse(request, currentVersion);
  }
  if (!exactKeys(value, ['outcome', 'current']) || value.outcome !== 'UPDATED') {
    return fail('STORE_CONTRACT_INVALID');
  }
  const current = parseStoredExpense(value.current, request.transactionId);
  if (current.version !== candidate.version || !sameTransaction(current.transaction, candidate.transaction)) {
    return fail('STORE_CONTRACT_INVALID');
  }
  return Object.freeze({
    contractVersion: WRITER_EXPENSE_EDIT_CONTRACT_VERSION,
    outcome: 'UPDATED',
    transactionId: current.id,
    version: current.version,
    transaction: current.transaction,
  });
}

export async function executeOptimisticExpenseEdit(
  dependencies: Readonly<{
    references: ExpenseEditReferenceReader;
    store: OptimisticExpenseEditStore;
  }>,
  input: unknown,
): Promise<Readonly<ExpenseEditResponse>> {
  const request = parseExpenseEditRequest(input);

  let currentRaw: Readonly<VersionedExpenseTransaction> | null;
  try {
    currentRaw = await dependencies.store.readCurrent(request.transactionId);
  } catch {
    return fail('STORE_OPERATION_FAILED');
  }
  if (currentRaw === null) return fail('TRANSACTION_NOT_FOUND');
  const current = parseStoredExpense(currentRaw, request.transactionId);

  if (current.version !== request.expectedVersion) {
    return conflictResponse(request, current.version);
  }

  let referenceEvidence: Readonly<ExpenseEditReferenceEvidence> | null;
  try {
    referenceEvidence = await dependencies.references.readExpenseEditReferenceEvidence({
      fromAccountId: request.fromAccountId,
      categoryId: request.categoryId,
      paidByMemberId: request.paidByMemberId,
    });
  } catch {
    return fail('REFERENCE_READ_FAILED');
  }
  parseReferenceEvidence(referenceEvidence, request);

  const candidate = buildEditedExpense(current, request);
  let replaceResult: OptimisticExpenseReplaceResult;
  try {
    replaceResult = await dependencies.store.replaceIfVersion({
      transactionId: request.transactionId,
      expectedVersion: request.expectedVersion,
      candidate,
    });
  } catch {
    return fail('STORE_OPERATION_FAILED');
  }
  return validateReplaceResult(replaceResult, request, candidate);
}
