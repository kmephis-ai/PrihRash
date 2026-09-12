import {
  YdbAdapter,
  type YdbTransport,
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
    executeRead(statement) {
      return base.read(statement);
    },
    serializableReadWrite(work) {
      return base.serializableReadWrite(async (transaction) => {
        if (!claimed) {
          claimed = true;
          await applyInitialReferenceBootstrapPlan(transaction, plan);
        }
        return work(Object.freeze({
          execute: (statement) => transaction.execute(statement),
        }));
      });
    },
  });
  return new YdbAdapter(transport);
}
