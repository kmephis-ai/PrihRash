import { YdbAdapter, YdbCommitOutcomeUnknownError } from '../integration/ydb/adapter.js';
import { YdbSchemeAdapter, YdbSchemeError } from '../integration/ydb/scheme.js';
import {
  prepareInitialControlledRebuildContinuation,
  type InitialBootstrapApplicationDependencies,
  type InitialBootstrapObservation,
} from './initialBootstrapApplication.js';
import { planControlledInitialRebuild } from './initialControlledRebuild.js';
import {
  commitControlledInitialRun,
  recoverControlledInitialCommitMarker,
} from './initialControlledRebuildCommitMarker.js';
import {
  readControlledRebuildStagingEvidence,
} from './initialControlledRebuildEvidenceReader.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
  type InitialControlledRebuildReconciliationSnapshot,
} from './initialControlledRebuildReconciliation.js';
import {
  recoverUnknownControlledInitialSwapOutcome,
  recoverUnknownControlledRebuildCopyOutcome,
} from './initialControlledRebuildSchemeRecovery.js';
import { planInitialControlledRebuildSetup } from './initialControlledRebuildSetup.js';
import { executeInitialControlledRebuildSetup } from './initialControlledRebuildSetupExecutor.js';
import { readInitialControlledRebuildSetupEvidence } from './initialControlledRebuildSetupEvidence.js';
import {
  executeControlledRebuildStagingBatches,
  prepareControlledRebuildStagingBatches,
} from './initialControlledRebuildStagingExecutor.js';
import { gateControlledInitialSwap, type ControlledInitialSwapPlan } from './initialControlledRebuildSwapGate.js';
import { executeControlledInitialSwap } from './initialControlledRebuildSwapExecutor.js';
import { verifyControlledInitialCurrentState } from './initialControlledRebuildCurrentVerification.js';
import { prepareMigrationRunValidatedWrite } from './migrationRunPersistence.js';
import { executeMigrationRunLifecycleWrite } from './migrationRunLifecycleExecutor.js';
import type { MigrationRun } from './migrationRunState.js';
import type { InitialValidationBlocker } from './initialValidationGate.js';

export type InitialControlledRebuildRecoveryReason =
  | 'VALIDATION_TRANSITION_OUTCOME_UNKNOWN'
  | 'SETUP_STATE_AMBIGUOUS'
  | 'SETUP_OUTCOME_NOT_APPLIED'
  | 'SETUP_OUTCOME_AMBIGUOUS'
  | 'STAGING_MATERIALIZATION_INCOMPLETE'
  | 'SWAP_OUTCOME_NOT_APPLIED'
  | 'SWAP_OUTCOME_AMBIGUOUS'
  | 'COMMIT_MARKER_PENDING'
  | 'COMMIT_MARKER_OUTCOME_AMBIGUOUS'
  | 'POST_SWAP_VERIFICATION_MISMATCH'
  | 'POST_COMMIT_VERIFICATION_MISMATCH';

export type InitialControlledRebuildApplicationPhase =
  | 'PREPARATION'
  | 'VALIDATION_TRANSITION'
  | 'SETUP_EVIDENCE'
  | 'SETUP_MUTATION'
  | 'STAGING_MATERIALIZATION'
  | 'STAGING_RECONCILIATION'
  | 'SWAP_DISCRIMINATION'
  | 'SWAP_MUTATION'
  | 'POST_SWAP_VERIFICATION'
  | 'COMMIT_MARKER'
  | 'POST_COMMIT_VERIFICATION';

export interface InitialControlledRebuildApplicationDependencies extends InitialBootstrapApplicationDependencies {
  readonly scheme: YdbSchemeAdapter;
  readonly observeControlledPhase?: (phase: InitialControlledRebuildApplicationPhase) => void;
}

export type InitialControlledRebuildApplicationResult =
  | Readonly<{ status: 'BASELINE_EXISTS'; run: Readonly<MigrationRun> }>
  | Readonly<{
      status: 'VALIDATION_BLOCKED';
      run: Readonly<MigrationRun>;
      blockers: readonly Readonly<InitialValidationBlocker>[];
    }>
  | Readonly<{ status: 'COMMITTED'; run: Readonly<MigrationRun> }>
  | Readonly<{
      status: 'RECOVERY_REQUIRED';
      run: Readonly<MigrationRun>;
      reason: InitialControlledRebuildRecoveryReason;
    }>;

function phase(
  dependencies: Readonly<InitialControlledRebuildApplicationDependencies>,
  value: InitialControlledRebuildApplicationPhase,
): void {
  dependencies.observeControlledPhase?.(value);
}

function recovery(
  run: Readonly<MigrationRun>,
  reason: InitialControlledRebuildRecoveryReason,
): InitialControlledRebuildApplicationResult {
  return Object.freeze({ status: 'RECOVERY_REQUIRED' as const, run, reason });
}

function exactMatch(
  expectedPlan: Parameters<typeof buildExpectedControlledRebuildReconciliation>[0],
  observed: Readonly<InitialControlledRebuildReconciliationSnapshot>,
): boolean {
  const result = compareControlledRebuildStagingReconciliation(
    buildExpectedControlledRebuildReconciliation(expectedPlan),
    observed,
  );
  return result.unexplainedHighImpactMismatchCount === 0
    && Object.values(result.checks).every((value) => value === 'MATCHED');
}

function emptySnapshot(snapshot: Readonly<InitialControlledRebuildReconciliationSnapshot>): boolean {
  return snapshot.sourceRecordCount === 0
    && snapshot.transactionCount === 0
    && snapshot.missingSourceRecordCount === 0
    && snapshot.typeAggregates.length === 0
    && snapshot.categoryAggregates.length === 0
    && snapshot.accountAggregates.length === 0
    && Object.values(snapshot.classificationCounts).every((value) => value === 0);
}

function recoverySwapPlan(
  run: Readonly<MigrationRun>,
  replacements: Readonly<ControlledInitialSwapPlan>['replacements'],
): Readonly<ControlledInitialSwapPlan> {
  return Object.freeze({
    runId: run.id.toLowerCase(),
    replacements: Object.freeze(replacements.map((replacement) => Object.freeze({ ...replacement }))),
  });
}

function isUnknownSchemeOutcome(error: unknown): boolean {
  return error instanceof YdbSchemeError && error.code === 'SCHEME_OPERATION_OUTCOME_UNKNOWN';
}

function reconciliationMatched(evidence: Awaited<ReturnType<typeof verifyControlledInitialCurrentState>>): boolean {
  return evidence.unexplainedHighImpactMismatchCount === 0
    && Object.values(evidence.checks).every((value) => value === 'MATCHED');
}

export async function runInitialControlledRebuildApplication(
  observation: Readonly<InitialBootstrapObservation>,
  dependencies: Readonly<InitialControlledRebuildApplicationDependencies>,
): Promise<InitialControlledRebuildApplicationResult> {
  phase(dependencies, 'PREPARATION');
  const prepared = await prepareInitialControlledRebuildContinuation(observation, dependencies);
  if (prepared.status === 'BASELINE_EXISTS') {
    return Object.freeze({ status: 'BASELINE_EXISTS' as const, run: prepared.run });
  }
  if (prepared.status === 'VALIDATION_BLOCKED') {
    return Object.freeze({
      status: 'VALIDATION_BLOCKED' as const,
      run: prepared.run,
      blockers: prepared.blockers,
    });
  }

  let validatedRun = prepared.validatedRun;
  if (prepared.durableRun.state === 'STAGING') {
    phase(dependencies, 'VALIDATION_TRANSITION');
    const write = prepareMigrationRunValidatedWrite(prepared.durableRun, prepared.validatedRun);
    try {
      validatedRun = await executeMigrationRunLifecycleWrite(
        dependencies.adapter,
        write,
        prepared.validatedRun,
      );
    } catch (error) {
      if (error instanceof YdbCommitOutcomeUnknownError) {
        return recovery(prepared.durableRun, 'VALIDATION_TRANSITION_OUTCOME_UNKNOWN');
      }
      throw error;
    }
  }

  const controlled = planControlledInitialRebuild(validatedRun, prepared.currentWrites, null);
  const recoveryPlan = recoverySwapPlan(validatedRun, controlled.replacements);

  phase(dependencies, 'SETUP_EVIDENCE');
  const setupEvidence = await readInitialControlledRebuildSetupEvidence(
    dependencies.scheme,
    dependencies.adapter,
    controlled,
  );

  let swapAlreadyApplied = false;
  if (setupEvidence.currentTransactionCount !== 0 || setupEvidence.currentSourceRecordCount !== 0) {
    phase(dependencies, 'SWAP_DISCRIMINATION');
    const existing = await recoverUnknownControlledInitialSwapOutcome(
      dependencies.scheme,
      dependencies.adapter,
      recoveryPlan,
      prepared.verifiedPlan,
    );
    if (existing.verdict !== 'APPLIED') {
      return recovery(validatedRun, 'SWAP_OUTCOME_AMBIGUOUS');
    }
    swapAlreadyApplied = true;
  } else {
    const bothStagingTables = setupEvidence.stagingTransactionsExists && setupEvidence.stagingSourceRecordsExists;
    const noStagingTables = !setupEvidence.stagingTransactionsExists && !setupEvidence.stagingSourceRecordsExists;
    if (!bothStagingTables && !noStagingTables) {
      return recovery(validatedRun, 'SETUP_STATE_AMBIGUOUS');
    }

    if (noStagingTables) {
      const setup = planInitialControlledRebuildSetup(controlled, setupEvidence);
      phase(dependencies, 'SETUP_MUTATION');
      try {
        await executeInitialControlledRebuildSetup(dependencies.scheme, setup);
      } catch (error) {
        if (!isUnknownSchemeOutcome(error)) throw error;
        const recovered = await recoverUnknownControlledRebuildCopyOutcome(
          dependencies.scheme,
          dependencies.adapter,
          setup,
        );
        if (recovered.verdict === 'NOT_APPLIED') {
          return recovery(validatedRun, 'SETUP_OUTCOME_NOT_APPLIED');
        }
        if (recovered.verdict !== 'APPLIED') {
          return recovery(validatedRun, 'SETUP_OUTCOME_AMBIGUOUS');
        }
      }
    }

    phase(dependencies, 'STAGING_RECONCILIATION');
    let staging = await readControlledRebuildStagingEvidence(dependencies.adapter, controlled.stagingTables);
    if (!exactMatch(prepared.verifiedPlan, staging)) {
      if (!emptySnapshot(staging)) {
        return recovery(validatedRun, 'STAGING_MATERIALIZATION_INCOMPLETE');
      }
      phase(dependencies, 'STAGING_MATERIALIZATION');
      const batches = prepareControlledRebuildStagingBatches(controlled);
      try {
        await executeControlledRebuildStagingBatches(dependencies.adapter, batches);
      } catch {
        phase(dependencies, 'STAGING_RECONCILIATION');
        staging = await readControlledRebuildStagingEvidence(dependencies.adapter, controlled.stagingTables);
        if (!exactMatch(prepared.verifiedPlan, staging)) {
          return recovery(validatedRun, 'STAGING_MATERIALIZATION_INCOMPLETE');
        }
      }
      phase(dependencies, 'STAGING_RECONCILIATION');
      staging = await readControlledRebuildStagingEvidence(dependencies.adapter, controlled.stagingTables);
      if (!exactMatch(prepared.verifiedPlan, staging)) {
        return recovery(validatedRun, 'STAGING_MATERIALIZATION_INCOMPLETE');
      }
    }

    const swapPlan = gateControlledInitialSwap(
      validatedRun,
      controlled,
      prepared.verifiedPlan,
      staging,
      null,
    );

    phase(dependencies, 'SWAP_DISCRIMINATION');
    const beforeSwap = await recoverUnknownControlledInitialSwapOutcome(
      dependencies.scheme,
      dependencies.adapter,
      swapPlan,
      prepared.verifiedPlan,
    );
    if (beforeSwap.verdict === 'APPLIED') {
      swapAlreadyApplied = true;
    } else if (beforeSwap.verdict === 'RECOVERY_REQUIRED') {
      return recovery(validatedRun, 'SWAP_OUTCOME_AMBIGUOUS');
    } else {
      phase(dependencies, 'SWAP_MUTATION');
      try {
        await executeControlledInitialSwap(dependencies.scheme, swapPlan);
        swapAlreadyApplied = true;
      } catch (error) {
        if (!isUnknownSchemeOutcome(error)) throw error;
        phase(dependencies, 'SWAP_DISCRIMINATION');
        const recovered = await recoverUnknownControlledInitialSwapOutcome(
          dependencies.scheme,
          dependencies.adapter,
          swapPlan,
          prepared.verifiedPlan,
        );
        if (recovered.verdict === 'NOT_APPLIED') {
          return recovery(validatedRun, 'SWAP_OUTCOME_NOT_APPLIED');
        }
        if (recovered.verdict !== 'APPLIED') {
          return recovery(validatedRun, 'SWAP_OUTCOME_AMBIGUOUS');
        }
        swapAlreadyApplied = true;
      }
    }
  }

  if (!swapAlreadyApplied) {
    return recovery(validatedRun, 'SWAP_OUTCOME_AMBIGUOUS');
  }

  phase(dependencies, 'POST_SWAP_VERIFICATION');
  if (!reconciliationMatched(await verifyControlledInitialCurrentState(dependencies.adapter, prepared.verifiedPlan))) {
    return recovery(validatedRun, 'POST_SWAP_VERIFICATION_MISMATCH');
  }

  phase(dependencies, 'COMMIT_MARKER');
  const finishedAt = dependencies.clock.now();
  let committedRun: Readonly<MigrationRun>;
  try {
    committedRun = await commitControlledInitialRun(
      dependencies.adapter,
      dependencies.scheme,
      validatedRun,
      recoveryPlan,
      prepared.verifiedPlan,
      finishedAt,
    );
  } catch (error) {
    if (!(error instanceof YdbCommitOutcomeUnknownError)) throw error;
    const recovered = await recoverControlledInitialCommitMarker(
      dependencies.adapter,
      dependencies.scheme,
      validatedRun.id,
      recoveryPlan,
      prepared.verifiedPlan,
      finishedAt,
    );
    if (recovered.status === 'SWAP_APPLIED_MARKER_PENDING') {
      return recovery(validatedRun, 'COMMIT_MARKER_PENDING');
    }
    if (recovered.status !== 'COMMITTED') {
      return recovery(validatedRun, 'COMMIT_MARKER_OUTCOME_AMBIGUOUS');
    }
    committedRun = Object.freeze({
      ...validatedRun,
      state: 'COMMITTED' as const,
      finishedAt,
      errorCode: null,
    });
  }

  phase(dependencies, 'POST_COMMIT_VERIFICATION');
  if (!reconciliationMatched(await verifyControlledInitialCurrentState(dependencies.adapter, prepared.verifiedPlan))) {
    return recovery(committedRun, 'POST_COMMIT_VERIFICATION_MISMATCH');
  }

  return Object.freeze({ status: 'COMMITTED' as const, run: committedRun });
}
