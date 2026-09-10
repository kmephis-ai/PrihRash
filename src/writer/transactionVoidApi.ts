import {
  executeOptimisticTransactionVoid,
  type OptimisticTransactionVoidStore,
} from './optimisticTransactionVoid.js';

export const WRITER_TRANSACTION_VOID_API_VERSION = 1 as const;

export type WriterTransactionVoidApiResponse =
  | Readonly<{
    apiVersion: typeof WRITER_TRANSACTION_VOID_API_VERSION;
    outcome: 'VOIDED';
    transactionId: string;
    version: number;
  }>
  | Readonly<{
    apiVersion: typeof WRITER_TRANSACTION_VOID_API_VERSION;
    outcome: 'ALREADY_VOIDED';
    transactionId: string;
    version: number;
  }>
  | Readonly<{
    apiVersion: typeof WRITER_TRANSACTION_VOID_API_VERSION;
    outcome: 'VERSION_CONFLICT';
    transactionId: string;
    currentVersion: number;
  }>;

export interface WriterTransactionVoidApiDependencies {
  readonly store: OptimisticTransactionVoidStore;
}

export async function executeWriterTransactionVoidApiRequest(
  dependencies: Readonly<WriterTransactionVoidApiDependencies>,
  body: unknown,
): Promise<Readonly<WriterTransactionVoidApiResponse>> {
  const response = await executeOptimisticTransactionVoid(dependencies, body);
  if (response.outcome === 'VOIDED') {
    return Object.freeze({
      apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
      outcome: 'VOIDED',
      transactionId: response.transactionId,
      version: response.version,
    });
  }
  if (response.outcome === 'ALREADY_VOIDED') {
    return Object.freeze({
      apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
      outcome: 'ALREADY_VOIDED',
      transactionId: response.transactionId,
      version: response.version,
    });
  }
  return Object.freeze({
    apiVersion: WRITER_TRANSACTION_VOID_API_VERSION,
    outcome: 'VERSION_CONFLICT',
    transactionId: response.transactionId,
    currentVersion: response.currentVersion,
  });
}
