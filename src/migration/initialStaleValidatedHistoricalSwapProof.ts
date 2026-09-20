import { YdbAdapter } from '../integration/ydb/adapter.js';
import { YdbSchemeAdapter } from '../integration/ydb/scheme.js';
import type { ReferenceResolver } from '../normalization/types.js';
import type { ControlledInitialRebuildPlan } from './initialControlledRebuild.js';
import { readControlledRebuildStagingEvidence } from './initialControlledRebuildEvidenceReader.js';
import {
  recoverUnknownControlledInitialSwapOutcome,
  type ControlledSchemeMutationRecoveryVerdict,
} from './initialControlledRebuildSchemeRecovery.js';
import { readInitialControlledRebuildSetupEvidence } from './initialControlledRebuildSetupEvidence.js';
import {
  ControlledInitialSwapGateError,
  gateControlledInitialSwap,
} from './initialControlledRebuildSwapGate.js';
import type { InitialBootstrapPrivateHistoricalEvidence } from './initialBootstrapPrivateEvidence.js';
import {
  InitialStaleValidatedHistoricalCandidateError,
  reconstructInitialStaleValidatedHistoricalCandidate,
} from './initialStaleValidatedHistoricalCandidate.js';
import type { InitialVerifiedCurrentPlan } from './initialVerifiedCurrentPlan.js';
import type { MigrationRun } from './migrationRunState.js';
import {
  readScheduledSyncAdmissionEvidence,
  type ScheduledSyncAdmissionEvidence,
} from './scheduledSyncAdmissionEvidence.js';

export type InitialStaleValidatedHistoricalSwapProofReason =
  | 'ADMISSION_EVIDENCE_INVALID'
  | 'COMMITTED_BASELINE_PRESENT'
  | 'VALIDATED_RUN_NOT_UNIQUE'
  | 'HISTORICAL_CONTEXT_NOT_PROVEN'
  | 'CURRENT_STATE_NOT_EMPTY'
  | 'STAGING_PAIR_NOT_EXACT'
  | 'STAGING_CANDIDATE_MISMATCH'
  | 'SWAP_ALREADY_APPLIED'
  | 'SWAP_DISCRIMINATION_AMBIGUOUS';

export interface InitialStaleValidatedHistoricalSwapProofEvidence {
  readonly historicalContextProven: boolean;
  readonly currentStateEmpty: boolean;
  readonly stagingCandidateExact: boolean;
  readonly swapProvenNotApplied: boolean;
}

export type InitialStaleValidatedHistoricalSwapProofResult =
  | Readonly<{
      status: 'PROVEN_NOT_APPLIED';
      run: Readonly<MigrationRun>;
      evidence: Readonly<InitialStaleValidatedHistoricalSwapProofEvidence>;
    }>
  | Readonly<{
      status: 'STOP';
      run: Readonly<MigrationRun> | null;
      reason: InitialStaleValidatedHistoricalSwapProofReason;
      evidence: Readonly<InitialStaleValidatedHistoricalSwapProofEvidence>;
    }>;

interface HistoricalCandidateProof {
  readonly run: Readonly<MigrationRun>;
  readonly verifiedPlan: Readonly<InitialVerifiedCurrentPlan>;
}

export interface InitialStaleValidatedHistoricalSwapProofRuntime {
  readAdmission(adapter: YdbAdapter): Promise<Readonly<ScheduledSyncAdmissionEvidence>>;
  reconstructHistoricalCandidate(
    adapter: YdbAdapter,
    run: Readonly<MigrationRun>,
    refs: ReferenceResolver,
    historicalEvidence: Readonly<InitialBootstrapPrivateHistoricalEvidence>,
  ): Promise<Readonly<HistoricalCandidateProof>>;
  readSetupEvidence(
    scheme: YdbSchemeAdapter,
    adapter: YdbAdapter,
    plan: Readonly<ControlledInitialRebuildPlan>,
  ): ReturnType<typeof readInitialControlledRebuildSetupEvidence>;
  readStagingEvidence(
    adapter: YdbAdapter,
    plan: Readonly<ControlledInitialRebuildPlan>,
  ): ReturnType<typeof readControlledRebuildStagingEvidence>;
  gateSwap(
    run: Readonly<MigrationRun>,
    controlled: Readonly<ControlledInitialRebuildPlan>,
    verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
    staging: Awaited<ReturnType<typeof readControlledRebuildStagingEvidence>>,
  ): ReturnType<typeof gateControlledInitialSwap>;
  recoverSwap(
    scheme: YdbSchemeAdapter,
    adapter: YdbAdapter,
    swapPlan: ReturnType<typeof gateControlledInitialSwap>,
    verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
  ): Promise<Readonly<{ verdict: ControlledSchemeMutationRecoveryVerdict }>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function falseEvidence(): Readonly<InitialStaleValidatedHistoricalSwapProofEvidence> {
  return Object.freeze({
    historicalContextProven: false,
    currentStateEmpty: false,
    stagingCandidateExact: false,
    swapProvenNotApplied: false,
  });
}

function stop(
  reason: InitialStaleValidatedHistoricalSwapProofReason,
  run: Readonly<MigrationRun> | null,
  evidence: Readonly<InitialStaleValidatedHistoricalSwapProofEvidence>,
): Readonly<InitialStaleValidatedHistoricalSwapProofResult> {
  return Object.freeze({ status: 'STOP' as const, run, reason, evidence });
}

function diagnosticControlledPlan(
  run: Readonly<MigrationRun>,
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>,
): Readonly<ControlledInitialRebuildPlan> {
  if (!UUID_PATTERN.test(run.id)) {
    throw new InitialStaleValidatedHistoricalCandidateError('VERIFIED_PLAN_RECONSTRUCTION_FAILED');
  }
  const compact = run.id.toLowerCase().replaceAll('-', '');
  const stagingDirectory = `rebuild/r_${compact}`;
  const stagingTables = Object.freeze({
    transactions: `${stagingDirectory}/transactions`,
    sourceRecords: `${stagingDirectory}/source_records`,
  });
  return Object.freeze({
    runId: run.id.toLowerCase(),
    stagingTables,
    batches: Object.freeze([]),
    replacements: Object.freeze([
      Object.freeze({
        source: stagingTables.transactions,
        destination: 'transactions' as const,
        replace: true as const,
      }),
      Object.freeze({
        source: stagingTables.sourceRecords,
        destination: 'source_records' as const,
        replace: true as const,
      }),
    ]),
    expectedSourceRecordCount: verifiedPlan.sourceRecords.length,
    expectedTransactionCount: verifiedPlan.transactions.length,
  });
}

const productionRuntime: Readonly<InitialStaleValidatedHistoricalSwapProofRuntime> = Object.freeze({
  readAdmission: readScheduledSyncAdmissionEvidence,
  reconstructHistoricalCandidate: reconstructInitialStaleValidatedHistoricalCandidate,
  readSetupEvidence: readInitialControlledRebuildSetupEvidence,
  readStagingEvidence(adapter, plan) {
    return readControlledRebuildStagingEvidence(adapter, plan.stagingTables);
  },
  gateSwap(run, controlled, verifiedPlan, staging) {
    return gateControlledInitialSwap(run, controlled, verifiedPlan, staging, null);
  },
  recoverSwap: recoverUnknownControlledInitialSwapOutcome,
});

export async function diagnoseInitialStaleValidatedHistoricalSwapProof(
  adapter: YdbAdapter,
  scheme: YdbSchemeAdapter,
  refs: ReferenceResolver,
  historicalEvidence: Readonly<InitialBootstrapPrivateHistoricalEvidence>,
  runtime: Readonly<InitialStaleValidatedHistoricalSwapProofRuntime> = productionRuntime,
): Promise<Readonly<InitialStaleValidatedHistoricalSwapProofResult>> {
  let admission: Readonly<ScheduledSyncAdmissionEvidence>;
  try {
    admission = await runtime.readAdmission(adapter);
  } catch {
    return stop('ADMISSION_EVIDENCE_INVALID', null, falseEvidence());
  }

  if (admission.committedBaselineRun !== null) {
    return stop('COMMITTED_BASELINE_PRESENT', admission.committedBaselineRun, falseEvidence());
  }
  if (
    admission.incompleteRuns.length !== 1
    || admission.incompleteRuns[0]?.state !== 'VALIDATED'
  ) {
    return stop('VALIDATED_RUN_NOT_UNIQUE', admission.incompleteRuns[0] ?? null, falseEvidence());
  }
  const run = admission.incompleteRuns[0];

  let historical: Readonly<HistoricalCandidateProof>;
  try {
    historical = await runtime.reconstructHistoricalCandidate(adapter, run, refs, historicalEvidence);
  } catch {
    return stop('HISTORICAL_CONTEXT_NOT_PROVEN', run, falseEvidence());
  }
  if (historical.run.id.toLowerCase() !== run.id.toLowerCase()) {
    return stop('HISTORICAL_CONTEXT_NOT_PROVEN', run, falseEvidence());
  }

  const historicalProven = Object.freeze({
    historicalContextProven: true,
    currentStateEmpty: false,
    stagingCandidateExact: false,
    swapProvenNotApplied: false,
  });
  const controlled = diagnosticControlledPlan(run, historical.verifiedPlan);

  let setup;
  try {
    setup = await runtime.readSetupEvidence(scheme, adapter, controlled);
  } catch {
    return stop('STAGING_PAIR_NOT_EXACT', run, historicalProven);
  }
  if (setup.currentTransactionCount !== 0 || setup.currentSourceRecordCount !== 0) {
    return stop('CURRENT_STATE_NOT_EMPTY', run, historicalProven);
  }

  const currentEmpty = Object.freeze({
    ...historicalProven,
    currentStateEmpty: true,
  });
  if (!setup.stagingTransactionsExists || !setup.stagingSourceRecordsExists) {
    return stop('STAGING_PAIR_NOT_EXACT', run, currentEmpty);
  }

  let staging;
  try {
    staging = await runtime.readStagingEvidence(adapter, controlled);
  } catch {
    return stop('STAGING_CANDIDATE_MISMATCH', run, currentEmpty);
  }

  let swapPlan;
  try {
    swapPlan = runtime.gateSwap(run, controlled, historical.verifiedPlan, staging);
  } catch (error) {
    if (error instanceof ControlledInitialSwapGateError) {
      return stop('STAGING_CANDIDATE_MISMATCH', run, currentEmpty);
    }
    return stop('STAGING_CANDIDATE_MISMATCH', run, currentEmpty);
  }

  const stagingExact = Object.freeze({
    ...currentEmpty,
    stagingCandidateExact: true,
  });

  let recovered: Readonly<{ verdict: ControlledSchemeMutationRecoveryVerdict }>;
  try {
    recovered = await runtime.recoverSwap(
      scheme,
      adapter,
      swapPlan,
      historical.verifiedPlan,
    );
  } catch {
    return stop('SWAP_DISCRIMINATION_AMBIGUOUS', run, stagingExact);
  }

  if (recovered.verdict === 'APPLIED') {
    return stop('SWAP_ALREADY_APPLIED', run, stagingExact);
  }
  if (recovered.verdict !== 'NOT_APPLIED') {
    return stop('SWAP_DISCRIMINATION_AMBIGUOUS', run, stagingExact);
  }

  return Object.freeze({
    status: 'PROVEN_NOT_APPLIED' as const,
    run,
    evidence: Object.freeze({
      ...stagingExact,
      swapProvenNotApplied: true,
    }),
  });
}
