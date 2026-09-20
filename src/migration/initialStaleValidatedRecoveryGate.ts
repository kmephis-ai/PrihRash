export type InitialStaleValidatedSourceEvidence =
  | 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH'
  | 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED'
  | 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY'
  | 'AUTHORITATIVE_SNAPSHOT_MATCH'
  | 'AUTHORITATIVE_ROW_COUNT_MISMATCH'
  | 'AUTHORITATIVE_BINDING_MISMATCH'
  | 'VALIDATED_METADATA_INVALID'
  | 'VALIDATED_SOURCE_DIAGNOSTIC_FAILED';

export type InitialStaleValidatedRecoveryBlocker =
  | 'COMMITTED_BASELINE_PRESENT'
  | 'VALIDATED_RUN_NOT_UNIQUE'
  | 'VALIDATED_RUN_METADATA_INVALID'
  | 'SOURCE_DRIFT_NOT_PROVEN'
  | 'HISTORICAL_CONTEXT_NOT_PROVEN'
  | 'CURRENT_STATE_NOT_EMPTY'
  | 'STAGING_CANDIDATE_NOT_EXACT'
  | 'SWAP_NOT_PROVEN_NOT_APPLIED'
  | 'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN'
  | 'SINGLE_WRITER_EXCLUSION_NOT_PROVEN';

export interface InitialStaleValidatedRecoveryEvidence {
  readonly committedBaselinePresent: boolean;
  readonly uniqueValidatedRun: boolean;
  readonly validatedRunMetadataValid: boolean;
  readonly sourceEvidence: InitialStaleValidatedSourceEvidence;
  readonly historicalContextProven: boolean;
  readonly currentStateEmpty: boolean;
  readonly stagingCandidateExact: boolean;
  readonly swapProvenNotApplied: boolean;
  readonly inFlightProviderMutationAbsent: boolean;
  readonly singleWriterExclusive: boolean;
}

export type InitialStaleValidatedRecoveryGateResult =
  | Readonly<{ status: 'BLOCKED'; blocker: InitialStaleValidatedRecoveryBlocker }>
  | Readonly<{ status: 'READY_FOR_MARKER_ONLY' }>;

const SOURCE_DRIFT_EVIDENCE = new Set<InitialStaleValidatedSourceEvidence>([
  'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
]);

export function evaluateInitialStaleValidatedRecoveryGate(
  evidence: Readonly<InitialStaleValidatedRecoveryEvidence>,
): InitialStaleValidatedRecoveryGateResult {
  if (evidence.committedBaselinePresent) return Object.freeze({ status: 'BLOCKED', blocker: 'COMMITTED_BASELINE_PRESENT' });
  if (!evidence.uniqueValidatedRun) return Object.freeze({ status: 'BLOCKED', blocker: 'VALIDATED_RUN_NOT_UNIQUE' });
  if (!evidence.validatedRunMetadataValid) return Object.freeze({ status: 'BLOCKED', blocker: 'VALIDATED_RUN_METADATA_INVALID' });
  if (!SOURCE_DRIFT_EVIDENCE.has(evidence.sourceEvidence)) return Object.freeze({ status: 'BLOCKED', blocker: 'SOURCE_DRIFT_NOT_PROVEN' });
  if (!evidence.historicalContextProven) return Object.freeze({ status: 'BLOCKED', blocker: 'HISTORICAL_CONTEXT_NOT_PROVEN' });
  if (!evidence.currentStateEmpty) return Object.freeze({ status: 'BLOCKED', blocker: 'CURRENT_STATE_NOT_EMPTY' });
  if (!evidence.stagingCandidateExact) return Object.freeze({ status: 'BLOCKED', blocker: 'STAGING_CANDIDATE_NOT_EXACT' });
  if (!evidence.swapProvenNotApplied) return Object.freeze({ status: 'BLOCKED', blocker: 'SWAP_NOT_PROVEN_NOT_APPLIED' });
  if (!evidence.inFlightProviderMutationAbsent) return Object.freeze({ status: 'BLOCKED', blocker: 'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN' });
  if (!evidence.singleWriterExclusive) return Object.freeze({ status: 'BLOCKED', blocker: 'SINGLE_WRITER_EXCLUSION_NOT_PROVEN' });
  return Object.freeze({ status: 'READY_FOR_MARKER_ONLY' });
}
