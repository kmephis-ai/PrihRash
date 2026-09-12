import {
  YdbAdapter,
  type YdbQueryResult,
  type YdbStatement,
  type YdbTransport,
  type YdbTransportTransaction,
} from '../integration/ydb/adapter.js';
import {
  applyInitialReferenceBootstrapPlan,
} from '../reference/initialBootstrapReferencePersistence.js';
import type { InitialReferenceBootstrapPlan } from '../reference/initialBootstrapReferencePlan.js';

export function createInitialBootstrapReferenceClaimAdapter(
  base: YdbAdapter,
  plan: Readonly<InitialReferenceBootstrapPlan>,
): YdbAdapter {
  let claimed = false;
  const transport: YdbTransport = Object.freeze({
    executeRead<Row = Readonly<Record<string, unknown>>>(
      statement: YdbStatement,
    ): Promise<YdbQueryResult<Row>> {
      return base.read<Row>(statement);
    },
    serializableReadWrite<T>(
      work: (transaction: YdbTransportTransaction) => Promise<T>,
    ): Promise<T> {
      return base.serializableReadWrite(async (transaction) => {
        if (!claimed) {
          claimed = true;
          await applyInitialReferenceBootstrapPlan(transaction, plan);
        }
        const delegated: YdbTransportTransaction = Object.freeze({
          execute<Row = Readonly<Record<string, unknown>>>(
            statement: YdbStatement,
          ): Promise<YdbQueryResult<Row>> {
            return transaction.execute<Row>(statement);
          },
        });
        return work(delegated);
      });
    },
  });
  return new YdbAdapter(transport);
}
