import { YdbAdapter } from '../integration/ydb/adapter.js';
import { readControlledRebuildCurrentEvidence } from './initialControlledRebuildEvidenceReader.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
} from './initialControlledRebuildReconciliation.js';
import type { InitialReconciliationEvidence } from './initialValidationGate.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';

export async function verifyControlledInitialCurrentState(
  adapter: YdbAdapter,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
): Promise<Readonly<InitialReconciliationEvidence>> {
  const expected = buildExpectedControlledRebuildReconciliation(verifiedPlan);
  const observed = await readControlledRebuildCurrentEvidence(adapter);
  return compareControlledRebuildStagingReconciliation(expected, observed);
}
