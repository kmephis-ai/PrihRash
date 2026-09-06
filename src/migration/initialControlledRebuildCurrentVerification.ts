import { YdbAdapter } from '../integration/ydb/adapter.js';
import { readControlledRebuildCurrentEvidence } from './initialControlledRebuildEvidenceReader.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  type InitialControlledRebuildReconciliation,
} from './initialControlledRebuildReconciliation.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';

export async function verifyControlledInitialCurrentState(
  adapter: YdbAdapter,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
): Promise<Readonly<InitialControlledRebuildReconciliation>> {
  const expected = buildExpectedControlledRebuildReconciliation(verifiedPlan);
  const observed = await readControlledRebuildCurrentEvidence(adapter);
  return compareControlledRebuildStagingReconciliation(expected, observed);
}
