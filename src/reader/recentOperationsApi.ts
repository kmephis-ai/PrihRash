import type { TransactionStatus, TransactionType } from '../domain/transaction.js';
import { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  READER_RECENT_OPERATIONS_DEFAULT_LIMIT,
  READER_RECENT_OPERATIONS_MAX_LIMIT,
  decodeRecentOperationsCursor,
  readRecentOperationsPage,
  type ReaderOperation,
  type ReaderRecentOperationsFilters,
} from './recentOperations.js';

export const READER_API_VERSION = 1 as const;

export type ReaderApiQuery = Readonly<Record<string, unknown>>;

export interface ReaderRecentOperationsApiRequest {
  readonly limit: number;
  readonly filters: Readonly<ReaderRecentOperationsFilters>;
  readonly cursor?: string;
}

export interface ReaderRecentOperationsApiResponse {
  readonly apiVersion: typeof READER_API_VERSION;
  readonly items: readonly Readonly<ReaderOperation>[];
  readonly pageSize: number;
  readonly nextCursor: string | null;
}

export type ReaderApiRequestErrorCode =
  | 'UNKNOWN_QUERY_PARAMETER'
  | 'INVALID_QUERY_PARAMETER';

export class ReaderApiRequestError extends Error {
  readonly code: ReaderApiRequestErrorCode;

  constructor(code: ReaderApiRequestErrorCode) {
    super(code);
    this.name = 'ReaderApiRequestError';
    this.code = code;
  }
}

const ALLOWED_QUERY_KEYS = new Set(['limit', 'type', 'status', 'accountId', 'categoryId', 'cursor']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TYPES = new Set<TransactionType>(['EXPENSE', 'INCOME', 'TRANSFER']);
const STATUSES = new Set<TransactionStatus>(['POSTED', 'VOIDED']);

function invalidQuery(): never {
  throw new ReaderApiRequestError('INVALID_QUERY_PARAMETER');
}

function optionalSingleString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return invalidQuery();
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return READER_RECENT_OPERATIONS_DEFAULT_LIMIT;
  const text = optionalSingleString(value);
  if (text === undefined || !/^[1-9]\d*$/u.test(text)) return invalidQuery();
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > READER_RECENT_OPERATIONS_MAX_LIMIT) return invalidQuery();
  return parsed;
}

export function parseReaderRecentOperationsApiRequest(
  query: ReaderApiQuery,
): Readonly<ReaderRecentOperationsApiRequest> {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new ReaderApiRequestError('UNKNOWN_QUERY_PARAMETER');
    }
  }

  const typeText = optionalSingleString(query.type);
  const statusText = optionalSingleString(query.status);
  const accountId = optionalSingleString(query.accountId);
  const categoryId = optionalSingleString(query.categoryId);
  const cursor = optionalSingleString(query.cursor);

  if (typeText !== undefined && !TYPES.has(typeText as TransactionType)) return invalidQuery();
  if (statusText !== undefined && !STATUSES.has(statusText as TransactionStatus)) return invalidQuery();
  if (accountId !== undefined && !UUID_PATTERN.test(accountId)) return invalidQuery();
  if (categoryId !== undefined && !UUID_PATTERN.test(categoryId)) return invalidQuery();
  if (cursor !== undefined) decodeRecentOperationsCursor(cursor);

  const filters: {
    type?: TransactionType;
    status?: TransactionStatus;
    accountId?: string;
    categoryId?: string;
  } = {};
  if (typeText !== undefined) filters.type = typeText as TransactionType;
  if (statusText !== undefined) filters.status = statusText as TransactionStatus;
  if (accountId !== undefined) filters.accountId = accountId.toLowerCase();
  if (categoryId !== undefined) filters.categoryId = categoryId.toLowerCase();

  const request: {
    limit: number;
    filters: Readonly<ReaderRecentOperationsFilters>;
    cursor?: string;
  } = {
    limit: parseLimit(query.limit),
    filters: Object.freeze(filters),
  };
  if (cursor !== undefined) request.cursor = cursor;
  return Object.freeze(request);
}

export async function executeReaderRecentOperationsApiRequest(
  adapter: YdbAdapter,
  query: ReaderApiQuery,
): Promise<Readonly<ReaderRecentOperationsApiResponse>> {
  const request = parseReaderRecentOperationsApiRequest(query);
  const page = await readRecentOperationsPage(
    adapter,
    request.limit,
    request.filters,
    request.cursor,
  );
  return Object.freeze({
    apiVersion: READER_API_VERSION,
    items: page.items,
    pageSize: page.limit,
    nextCursor: page.nextCursor,
  });
}
