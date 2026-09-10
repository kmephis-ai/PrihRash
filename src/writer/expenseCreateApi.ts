import {
  executeIdempotentExpenseCreate,
  type ExpenseCreateReferenceReader,
  type IdempotentExpenseCreateStore,
} from './idempotentExpenseCreate.js';

export const WRITER_EXPENSE_CREATE_API_VERSION = 1 as const;

export interface WriterExpenseCreateApiResponse {
  readonly apiVersion: typeof WRITER_EXPENSE_CREATE_API_VERSION;
  readonly outcome: 'CREATED' | 'REPLAY';
  readonly idempotencyKey: string;
  readonly transactionId: string;
  readonly version: 1;
}

export interface WriterExpenseCreateApiDependencies {
  readonly references: ExpenseCreateReferenceReader;
  readonly store: IdempotentExpenseCreateStore;
  readonly randomUuid?: () => string;
}

export async function executeWriterExpenseCreateApiRequest(
  dependencies: Readonly<WriterExpenseCreateApiDependencies>,
  body: unknown,
): Promise<Readonly<WriterExpenseCreateApiResponse>> {
  const response = await executeIdempotentExpenseCreate(dependencies, body);
  return Object.freeze({
    apiVersion: WRITER_EXPENSE_CREATE_API_VERSION,
    outcome: response.outcome,
    idempotencyKey: response.idempotencyKey,
    transactionId: response.result.id,
    version: response.result.version,
  });
}
