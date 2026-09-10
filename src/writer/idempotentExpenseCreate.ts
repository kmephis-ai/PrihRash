import {
  validateTransaction,
  type CanonicalTransaction,
  type CategoryKind,
} from '../domain/transaction.js';

export const WRITER_CREATE_CONTRACT_VERSION = 1 as const;

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

export interface ExpenseCreateRequest {
  readonly idempotencyKey: string;
  readonly occurredOn: string;
  readonly amountMinor: number;
  readonly currency: 'RUB';
  readonly fromAccountId: string;
  readonly categoryId: string;
  readonly description: string | null;
  readonly note: string | null;
}

export interface ExpenseCreateReferenceEvidence {
  readonly accountId: string;
  readonly categoryId: string;
  readonly categoryKind: CategoryKind;
}

export interface ExpenseCreateReferenceReader {
  readExpenseCreateReferenceEvidence(
    request: Readonly<Pick<ExpenseCreateRequest, 'fromAccountId' | 'categoryId'>>,
  ): Promise<Readonly<ExpenseCreateReferenceEvidence> | null>;
}

export interface CreatedExpenseTransaction {
  readonly id: string;
  readonly version: 1;
  readonly transaction: Readonly<CanonicalTransaction>;
}

export interface CommittedExpenseCreate {
  readonly request: Readonly<ExpenseCreateRequest>;
  readonly result: Readonly<CreatedExpenseTransaction>;
}

export type IdempotentExpenseCreateStoreResult =
  | Readonly<{
    outcome: 'CREATED' | 'REPLAY';
    request: Readonly<ExpenseCreateRequest>;
    result: Readonly<CreatedExpenseTransaction>;
  }>
  | Readonly<{ outcome: 'CONFLICT' }>;

export interface IdempotentExpenseCreateStore {
  /** Returns the original committed request/result for this key, or null. */
  readCommitted(idempotencyKey: string): Promise<Readonly<CommittedExpenseCreate> | null>;

  /**
   * Atomically creates the candidate when idempotencyKey is unseen, replays the
   * original request/result for an exact request match, or returns CONFLICT when
   * the same key was already committed with a different canonical request.
   */
  createOrReplay(input: Readonly<{
    request: Readonly<ExpenseCreateRequest>;
    candidate: Readonly<CreatedExpenseTransaction>;
  }>): Promise<IdempotentExpenseCreateStoreResult>;
}

export type ExpenseCreateErrorCode =
  | 'INVALID_REQUEST'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_MISMATCH'
  | 'CATEGORY_KIND_INVALID'
  | 'REFERENCE_READ_FAILED'
  | 'INVALID_GENERATED_TRANSACTION_ID'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STORE_OPERATION_FAILED'
  | 'STORE_CONTRACT_INVALID';

export class ExpenseCreateError extends Error {
  readonly code: ExpenseCreateErrorCode;

  constructor(code: ExpenseCreateErrorCode) {
    super(code);
    this.name = 'ExpenseCreateError';
    this.code = code;
  }
}

export interface ExpenseCreateResponse {
  readonly contractVersion: typeof WRITER_CREATE_CONTRACT_VERSION;
  readonly outcome: 'CREATED' | 'REPLAY';
  readonly idempotencyKey: string;
  readonly result: Readonly<CreatedExpenseTransaction>;
}

function fail(code: ExpenseCreateErrorCode): never {
  throw new ExpenseCreateError(code);
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalUuid(value: unknown, code: ExpenseCreateErrorCode = 'INVALID_REQUEST'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return fail(code);
  return value;
}

function canonicalDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return fail('INVALID_REQUEST');
  const parts = value.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return fail('INVALID_REQUEST');
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return fail('INVALID_REQUEST');
  return value;
}

function optionalCanonicalText(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim().length === 0
    || value !== value.trim()
  ) return fail('INVALID_REQUEST');
  return value;
}

export function parseExpenseCreateRequest(value: unknown): Readonly<ExpenseCreateRequest> {
  if (!exactKeys(value, [
    'idempotencyKey',
    'occurredOn',
    'amountMinor',
    'currency',
    'fromAccountId',
    'categoryId',
    'description',
    'note',
  ])) return fail('INVALID_REQUEST');

  if (value.currency !== 'RUB') return fail('INVALID_REQUEST');
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) <= 0) {
    return fail('INVALID_REQUEST');
  }

  return Object.freeze({
    idempotencyKey: canonicalUuid(value.idempotencyKey),
    occurredOn: canonicalDate(value.occurredOn),
    amountMinor: value.amountMinor as number,
    currency: 'RUB',
    fromAccountId: canonicalUuid(value.fromAccountId),
    categoryId: canonicalUuid(value.categoryId),
    description: optionalCanonicalText(value.description),
    note: optionalCanonicalText(value.note),
  });
}

function parseReferenceEvidence(
  value: Readonly<ExpenseCreateReferenceEvidence> | null,
  request: Readonly<ExpenseCreateRequest>,
): void {
  if (value === null) return fail('REFERENCE_NOT_FOUND');
  if (!exactKeys(value, ['accountId', 'categoryId', 'categoryKind'])) return fail('REFERENCE_MISMATCH');
  const accountId = canonicalUuid(value.accountId, 'REFERENCE_MISMATCH');
  const categoryId = canonicalUuid(value.categoryId, 'REFERENCE_MISMATCH');
  if (accountId !== request.fromAccountId || categoryId !== request.categoryId) {
    return fail('REFERENCE_MISMATCH');
  }
  if (value.categoryKind !== 'EXPENSE') return fail('CATEGORY_KIND_INVALID');
}

function buildCanonicalExpense(request: Readonly<ExpenseCreateRequest>): Readonly<CanonicalTransaction> {
  const transaction: Readonly<CanonicalTransaction> = Object.freeze({
    type: 'EXPENSE',
    occurredOn: request.occurredOn,
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: request.amountMinor,
    currency: 'RUB',
    fromAccountId: request.fromAccountId,
    toAccountId: null,
    categoryId: request.categoryId,
    paidByMemberId: null,
    description: request.description,
    note: request.note,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
  });
  if (validateTransaction(transaction, { categoryKind: 'EXPENSE' }).length !== 0) {
    return fail('INVALID_REQUEST');
  }
  return transaction;
}

function sameRequest(left: Readonly<ExpenseCreateRequest>, right: Readonly<ExpenseCreateRequest>): boolean {
  return left.idempotencyKey === right.idempotencyKey
    && left.occurredOn === right.occurredOn
    && left.amountMinor === right.amountMinor
    && left.currency === right.currency
    && left.fromAccountId === right.fromAccountId
    && left.categoryId === right.categoryId
    && left.description === right.description
    && left.note === right.note;
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

function validateCommittedRecord(
  value: unknown,
  request: Readonly<ExpenseCreateRequest>,
  expectedTransaction: Readonly<CanonicalTransaction>,
  requestMismatchCode: ExpenseCreateErrorCode,
): Readonly<CreatedExpenseTransaction> {
  if (!exactKeys(value, ['request', 'result'])) return fail('STORE_CONTRACT_INVALID');

  let storedRequest: Readonly<ExpenseCreateRequest>;
  try {
    storedRequest = parseExpenseCreateRequest(value.request);
  } catch {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (!sameRequest(storedRequest, request)) return fail(requestMismatchCode);

  const result = value.result;
  if (!exactKeys(result, ['id', 'version', 'transaction'])) return fail('STORE_CONTRACT_INVALID');
  const id = canonicalUuid(result.id, 'STORE_CONTRACT_INVALID');
  if (!exactKeys(result.transaction, CANONICAL_TRANSACTION_KEYS)) return fail('STORE_CONTRACT_INVALID');
  const storedTransaction = result.transaction as unknown as CanonicalTransaction;
  if (result.version !== 1 || !sameTransaction(storedTransaction, expectedTransaction)) {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (validateTransaction(storedTransaction, { categoryKind: 'EXPENSE' }).length !== 0) {
    return fail('STORE_CONTRACT_INVALID');
  }

  return Object.freeze({
    id,
    version: 1,
    transaction: storedTransaction,
  });
}

function validateStoreResult(
  storeResult: unknown,
  request: Readonly<ExpenseCreateRequest>,
  expectedTransaction: Readonly<CanonicalTransaction>,
): Readonly<{ outcome: 'CREATED' | 'REPLAY'; result: Readonly<CreatedExpenseTransaction> }> {
  if (!exactKeys(storeResult, ['outcome']) && !exactKeys(storeResult, ['outcome', 'request', 'result'])) {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (storeResult.outcome === 'CONFLICT') {
    if (!exactKeys(storeResult, ['outcome'])) return fail('STORE_CONTRACT_INVALID');
    return fail('IDEMPOTENCY_CONFLICT');
  }
  if (storeResult.outcome !== 'CREATED' && storeResult.outcome !== 'REPLAY') {
    return fail('STORE_CONTRACT_INVALID');
  }
  if (!exactKeys(storeResult, ['outcome', 'request', 'result'])) return fail('STORE_CONTRACT_INVALID');

  const result = validateCommittedRecord(
    { request: storeResult.request, result: storeResult.result },
    request,
    expectedTransaction,
    'STORE_CONTRACT_INVALID',
  );
  return Object.freeze({ outcome: storeResult.outcome, result });
}

export async function executeIdempotentExpenseCreate(
  dependencies: Readonly<{
    references: ExpenseCreateReferenceReader;
    store: IdempotentExpenseCreateStore;
    randomUuid?: () => string;
  }>,
  input: unknown,
): Promise<Readonly<ExpenseCreateResponse>> {
  const request = parseExpenseCreateRequest(input);
  const transaction = buildCanonicalExpense(request);

  let committed: Readonly<CommittedExpenseCreate> | null;
  try {
    committed = await dependencies.store.readCommitted(request.idempotencyKey);
  } catch {
    return fail('STORE_OPERATION_FAILED');
  }
  if (committed !== null) {
    const result = validateCommittedRecord(
      committed,
      request,
      transaction,
      'IDEMPOTENCY_CONFLICT',
    );
    return Object.freeze({
      contractVersion: WRITER_CREATE_CONTRACT_VERSION,
      outcome: 'REPLAY',
      idempotencyKey: request.idempotencyKey,
      result,
    });
  }

  let referenceEvidence: Readonly<ExpenseCreateReferenceEvidence> | null;
  try {
    referenceEvidence = await dependencies.references.readExpenseCreateReferenceEvidence({
      fromAccountId: request.fromAccountId,
      categoryId: request.categoryId,
    });
  } catch {
    return fail('REFERENCE_READ_FAILED');
  }
  parseReferenceEvidence(referenceEvidence, request);

  let generatedTransactionId: unknown;
  try {
    generatedTransactionId = dependencies.randomUuid?.() ?? globalThis.crypto?.randomUUID?.();
  } catch {
    return fail('INVALID_GENERATED_TRANSACTION_ID');
  }
  const transactionId = canonicalUuid(
    generatedTransactionId,
    'INVALID_GENERATED_TRANSACTION_ID',
  );
  if (transactionId === request.idempotencyKey) {
    return fail('INVALID_GENERATED_TRANSACTION_ID');
  }

  const candidate: Readonly<CreatedExpenseTransaction> = Object.freeze({
    id: transactionId,
    version: 1,
    transaction,
  });
  let storeResult: IdempotentExpenseCreateStoreResult;
  try {
    storeResult = await dependencies.store.createOrReplay({ request, candidate });
  } catch {
    return fail('STORE_OPERATION_FAILED');
  }
  const validated = validateStoreResult(storeResult, request, transaction);

  return Object.freeze({
    contractVersion: WRITER_CREATE_CONTRACT_VERSION,
    outcome: validated.outcome,
    idempotencyKey: request.idempotencyKey,
    result: validated.result,
  });
}
