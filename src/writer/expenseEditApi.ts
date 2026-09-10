import {
  executeOptimisticExpenseEdit,
  type ExpenseEditReferenceReader,
  type OptimisticExpenseEditStore,
} from './optimisticExpenseEdit.js';

export const WRITER_EXPENSE_EDIT_API_VERSION = 1 as const;

export type WriterExpenseEditApiResponse =
  | Readonly<{
    apiVersion: typeof WRITER_EXPENSE_EDIT_API_VERSION;
    outcome: 'UPDATED';
    transactionId: string;
    version: number;
  }>
  | Readonly<{
    apiVersion: typeof WRITER_EXPENSE_EDIT_API_VERSION;
    outcome: 'VERSION_CONFLICT';
    transactionId: string;
    currentVersion: number;
  }>;

export interface WriterExpenseEditApiDependencies {
  readonly references: ExpenseEditReferenceReader;
  readonly store: OptimisticExpenseEditStore;
}

export async function executeWriterExpenseEditApiRequest(
  dependencies: Readonly<WriterExpenseEditApiDependencies>,
  body: unknown,
): Promise<Readonly<WriterExpenseEditApiResponse>> {
  const response = await executeOptimisticExpenseEdit(dependencies, body);
  if (response.outcome === 'UPDATED') {
    return Object.freeze({
      apiVersion: WRITER_EXPENSE_EDIT_API_VERSION,
      outcome: 'UPDATED',
      transactionId: response.transactionId,
      version: response.version,
    });
  }
  return Object.freeze({
    apiVersion: WRITER_EXPENSE_EDIT_API_VERSION,
    outcome: 'VERSION_CONFLICT',
    transactionId: response.transactionId,
    currentVersion: response.currentVersion,
  });
}
