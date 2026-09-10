import {
  executeIdempotentIncomeCreate,
  type IncomeCreateReferenceReader,
  type IdempotentIncomeCreateStore,
} from './idempotentIncomeCreate.js';

export const WRITER_INCOME_CREATE_API_VERSION = 1 as const;

export interface WriterIncomeCreateApiResponse {
  readonly apiVersion: typeof WRITER_INCOME_CREATE_API_VERSION;
  readonly outcome: 'CREATED' | 'REPLAY';
  readonly idempotencyKey: string;
  readonly transactionId: string;
  readonly version: 1;
}

export interface WriterIncomeCreateApiDependencies {
  readonly references: IncomeCreateReferenceReader;
  readonly store: IdempotentIncomeCreateStore;
  readonly randomUuid?: () => string;
}

export async function executeWriterIncomeCreateApiRequest(
  dependencies: Readonly<WriterIncomeCreateApiDependencies>,
  body: unknown,
): Promise<Readonly<WriterIncomeCreateApiResponse>> {
  const response = await executeIdempotentIncomeCreate(dependencies, body);
  return Object.freeze({
    apiVersion: WRITER_INCOME_CREATE_API_VERSION,
    outcome: response.outcome,
    idempotencyKey: response.idempotencyKey,
    transactionId: response.result.id,
    version: response.result.version,
  });
}
