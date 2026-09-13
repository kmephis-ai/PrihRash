import type { YdbAdapter } from '../integration/ydb/adapter.js';
import {
  diagnoseInitialBootstrapRecoveryEvidence,
  readInitialBootstrapRecoveryEvidence,
  type InitialBootstrapRecoveryEvidence,
  type InitialBootstrapRecoveryReason,
  type InitialBootstrapRecoveryVerdict,
} from './initialBootstrapRecoveryProbe.js';

export type InitialBootstrapRecoverySurfaceReason =
  | InitialBootstrapRecoveryReason
  | 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN'
  | 'RESIDUAL_METADATA_STATE_WITHOUT_RUN'
  | 'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN'
  | 'RESIDUAL_MIXED_STATE_WITHOUT_RUN';

export interface InitialBootstrapRecoverySurfaceClassification {
  readonly verdict: InitialBootstrapRecoveryVerdict;
  readonly reason: InitialBootstrapRecoverySurfaceReason;
}

function classification(
  verdict: InitialBootstrapRecoveryVerdict,
  reason: InitialBootstrapRecoverySurfaceReason,
): Readonly<InitialBootstrapRecoverySurfaceClassification> {
  return Object.freeze({ verdict, reason });
}

export function diagnoseInitialBootstrapResidualSurfaceEvidence(
  evidence: Readonly<InitialBootstrapRecoveryEvidence>,
): Readonly<InitialBootstrapRecoverySurfaceClassification> {
  const base = diagnoseInitialBootstrapRecoveryEvidence(evidence);
  if (base.reason !== 'RESIDUAL_STATE_WITHOUT_RUN') return base;

  const referencePresent = evidence.accounts > 0
    || evidence.categories > 0
    || evidence.familyMembers > 0;
  const metadataPresent = evidence.sourceSnapshots > 0
    || evidence.identityManifests > 0;
  const currentOrLineagePresent = evidence.sourceRecords > 0
    || evidence.sourceRecordRevisions > 0
    || evidence.transactions > 0;
  const presentGroupCount = Number(referencePresent)
    + Number(metadataPresent)
    + Number(currentOrLineagePresent);

  if (presentGroupCount !== 1) {
    return classification('RECOVERY_REQUIRED', 'RESIDUAL_MIXED_STATE_WITHOUT_RUN');
  }
  if (referencePresent) {
    return classification('RECOVERY_REQUIRED', 'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN');
  }
  if (metadataPresent) {
    return classification('RECOVERY_REQUIRED', 'RESIDUAL_METADATA_STATE_WITHOUT_RUN');
  }
  return classification('RECOVERY_REQUIRED', 'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN');
}

export async function diagnoseInitialBootstrapRecoverySurface(
  adapter: YdbAdapter,
): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>> {
  try {
    const evidence = await readInitialBootstrapRecoveryEvidence(adapter);
    return diagnoseInitialBootstrapResidualSurfaceEvidence(evidence);
  } catch {
    return classification('RECOVERY_REQUIRED', 'READ_FAILED');
  }
}
