import { YdbAdapter } from '../integration/ydb/adapter.js';
import type { ReferenceResolver } from '../normalization/types.js';
import type { GoogleSnapshotMigrationProjection } from './googleSnapshotProjection.js';
import type { InitialReconciliationEvidence } from './initialValidationGate.js';
import { readConsistentIncrementalCurrentEvidence } from './consistentIncrementalCurrentEvidence.js';
import {
  runPreparedScheduledIncremental,
  type ScheduledIncrementalExecutionResult,
} from './scheduledIncrementalExecution.js';
import type {
  IncrementalSourceIdentityAllocator,
  IncrementalTransactionIdentityAllocator,
} from './scheduledIncrementalCandidatePreparation.js';
import { evaluateScheduledSyncAdmission } from './scheduledSyncAdmission.js';
import type {
  AuthoritativeFullSnapshotLease,
  ScheduledIncrementalRunner,
} from './scheduledSyncInvocation.js';

export interface ScheduledIncrementalObservationProjection {
  readonly projection: Readonly<GoogleSnapshotMigrationProjection>;
  readonly observedAt: string;
}

export interface ScheduledIncrementalRunContext {
  readonly runId: string;
  readonly startedAt: string;
  readonly promotedAt: string;
  readonly finishedAt: string;
}

export interface ScheduledIncrementalApplicationDependencies<TSnapshot> {
  readonly projectObservation: (
    observation: Readonly<AuthoritativeFullSnapshotLease<TSnapshot>>,
  ) => Readonly<ScheduledIncrementalObservationProjection>;
  readonly createRunContext: () => Readonly<ScheduledIncrementalRunContext>;
  readonly readReconciliationEvidence: () => Promise<Readonly<InitialReconciliationEvidence>>;
  readonly refs: ReferenceResolver;
  readonly sourceIdentityAllocator: IncrementalSourceIdentityAllocator;
  readonly transactionIdentityAllocator: IncrementalTransactionIdentityAllocator;
}

export type ScheduledIncrementalApplicationRunnerErrorCode =
  | 'ADMISSION_CHANGED_BEFORE_CANDIDATE'
  | 'MISSING_COMMITTED_BASELINE';

export class ScheduledIncrementalApplicationRunnerError extends Error {
  readonly code: ScheduledIncrementalApplicationRunnerErrorCode;

  constructor(code: ScheduledIncrementalApplicationRunnerErrorCode) {
    super(code);
    this.name = 'ScheduledIncrementalApplicationRunnerError';
    this.code = code;
  }
}

export class ScheduledIncrementalApplicationRunner<TSnapshot>
  implements ScheduledIncrementalRunner<TSnapshot> {
  readonly #adapter: YdbAdapter;
  readonly #dependencies: ScheduledIncrementalApplicationDependencies<TSnapshot>;
  #lastResult: Readonly<ScheduledIncrementalExecutionResult> | null = null;

  constructor(
    adapter: YdbAdapter,
    dependencies: ScheduledIncrementalApplicationDependencies<TSnapshot>,
  ) {
    this.#adapter = adapter;
    this.#dependencies = dependencies;
  }

  get lastResult(): Readonly<ScheduledIncrementalExecutionResult> | null {
    return this.#lastResult;
  }

  async runIncremental(
    observation: Readonly<AuthoritativeFullSnapshotLease<TSnapshot>>,
  ): Promise<void> {
    const evidence = await readConsistentIncrementalCurrentEvidence(this.#adapter);
    const admission = evaluateScheduledSyncAdmission({
      observedSnapshotDigest: observation.snapshotDigest,
      committedBaselineRun: evidence.admissionEvidence.committedBaselineRun,
      incompleteRuns: evidence.admissionEvidence.incompleteRuns,
    });

    if (admission.decision !== 'START_INCREMENTAL') {
      throw new ScheduledIncrementalApplicationRunnerError('ADMISSION_CHANGED_BEFORE_CANDIDATE');
    }

    const baselineRun = evidence.admissionEvidence.committedBaselineRun;
    if (baselineRun === null) {
      throw new ScheduledIncrementalApplicationRunnerError('MISSING_COMMITTED_BASELINE');
    }

    const projected = this.#dependencies.projectObservation(observation);
    const context = this.#dependencies.createRunContext();
    const reconciliationEvidence = await this.#dependencies.readReconciliationEvidence();
    this.#lastResult = await runPreparedScheduledIncremental(this.#adapter, {
      baselineRun,
      sourceEvidence: evidence.sourceEvidence,
      revisionEvidence: evidence.revisionEvidence,
      previousTransactions: evidence.previousTransactions,
      projection: projected.projection,
      leasedSnapshotDigest: observation.snapshotDigest,
      runId: context.runId,
      startedAt: context.startedAt,
      observedAt: projected.observedAt,
      promotedAt: context.promotedAt,
      finishedAt: context.finishedAt,
      refs: this.#dependencies.refs,
      sourceIdentityAllocator: this.#dependencies.sourceIdentityAllocator,
      transactionIdentityAllocator: this.#dependencies.transactionIdentityAllocator,
      reconciliationEvidence,
    });
  }
}
