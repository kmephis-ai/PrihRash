import {
  executeIdempotentTransferCreate,
  type IdempotentTransferCreateStore,
  type TransferCreateReferenceReader,
} from './idempotentTransferCreate.js';

export const WRITER_TRANSFER_CREATE_API_VERSION = 1 as const;

export interface WriterTransferCreateApiResponse {
  readonly apiVersion: typeof WRITER_TRANSFER_CREATE_API_VERSION;
  readonly outcome: 'CREATED' | 'REPLAY';
  readonly idempotencyKey: string;
  readonly transactionId: string;
  readonly version: 1;
}

export interface WriterTransferCreateApiDependencies {
  readonly references: TransferCreateReferenceReader;
  readonly store: IdempotentTransferCreateStore;
  readonly randomUuid?: () => string;
}

export async function executeWriterTransferCreateApiRequest(
  dependencies: Readonly<WriterTransferCreateApiDependencies>,
  body: unknown,
): Promise<Readonly<WriterTransferCreateApiResponse>> {
  const response = await executeIdempotentTransferCreate(dependencies, body);
  return Object.freeze({
    apiVersion: WRITER_TRANSFER_CREATE_API_VERSION,
    outcome: response.outcome,
    idempotencyKey: response.idempotencyKey,
    transactionId: response.result.id,
    version: response.result.version,
  });
}
