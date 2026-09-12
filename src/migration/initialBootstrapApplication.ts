import {
  YdbAdapter,
  YdbCommitOutcomeUnknownError,
  readStatement,
} from '../integration/ydb/adapter.js';
import { uuidParameter } from '../integration/ydb/parameters.js';
import { promoteAtomicDelta } from './atomicPromotion.js';
import {
  buildInitialBootstrapCandidate,
  type InitialBootstrapCandidateEnvelope,
} from './initialBootstrapCandidate.js';
import {
  buildInitialBootstrapIdentityManifest,
  prepareInitialBootstrapIdentityManifestWrite,
  recoverInitialBootstrapIdentities,
  type InitialBootstrapResumeObservation,
} from './initialBootstrapIdentityManifest.js';
import { executeInitialBootstrapMetadataWrites } from './initialBootstrapMetadataExecutor.js';
import { prepareInitialBootstrapMetadataWrites } from './initialBootstrapPersistence.js';
import { readControlledRebuildCurrentEvidence } from './initialControlledRebuildEvidenceReader.js';
import {
  buildExpectedControlledRebuildReconciliation,
  compareControlledRebuildStagingReconciliation,
} from './initialControlledRebuildReconciliation.js';
import { planInitialBootstrapPromotion } from './initialBootstrapPromotionRoute.js';
import type { InitialSnapshotProjection, InitialSnapshotProjectionContext } from './initialSnapshotProjection.js';
import { projectInitialSnapshot } from './initialSnapshotProjection.js';
import {
  INITIAL_RECONCILIATION_CHECKS,
  evaluateInitialValidation,
  type InitialReconciliationEvidence,
  type InitialValidationBlocker,
} from './initialValidationGate.js';
import type { RawPayload } from './rawPayloadDecoder.js';
import { refineInitialRunCounters } from './initialRunCounterRefinement.js';
import {
  executeInitialRunCounterRefinementWrite,
  prepareInitialRunCounterRefinementWrite,
} from './initialRunCounterRefinementPersistence.js';
import {
  buildInitialSourceLineageProjection,
  type InitialSourceLineageProjection,
} from './initialSourceLineage.js';
import { prepareInitialSourceRevisionWrites } from './initialSourceLineagePersistence.js';
import {
  executeInitialRevisionEvidenceBatches,
  planInitialRevisionEvidenceBatches,
} from './initialSourceRevisionEvidenceExecutor.js';
import { planInitialSourceRevisionEvidenceResume } from './initialSourceRevisionEvidenceRecovery.js';
import {
  prepareMigrationRunValidatedWrite,
} from './migrationRunPersistence.js';
import { executeMigrationRunLifecycleWrite } from './migrationRunLifecycleExecutor.js';
import type { MigrationRun } from './migrationRunState.js';
import { readScheduledSyncAdmissionEvidence } from './scheduledSyncAdmissionEvidence.js';
import {
  buildInitialVerifiedCurrentPlan,
  type InitialTransactionIdentityAssignment,
  type InitialVerifiedCurrentPlan,
} from './initialVerifiedCurrentPlan.js';
import { prepareInitialVerifiedCurrentWrites } from './initialVerifiedCurrentPersistence.js';

export interface InitialBootstrapObservationRow {
  readonly rowHint: number;
  readonly digest: string;
  readonly rawPayload: RawPayload;
  readonly aggregatePeriodMonth: string | null;
}

export interface InitialBootstrapObservation {
  readonly capturedAt: string;
  readonly snapshotDigest: string;
  readonly rows: readonly Readonly<InitialBootstrapObservationRow>[];
}

export interface InitialBootstrapSourceIdentityInput {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly digest: string;
}

export interface InitialBootstrapTransactionIdentityInput {
  readonly sourceOrdinal: number;
  readonly sourceRecordId: string;
}

export interface InitialBootstrapIdentityAllocator {
  allocateSnapshotId(): string;
  allocateMigrationRunId(): string;
  allocateSourceRecordId(input: Readonly<InitialBootstrapSourceIdentityInput>): string;
  allocateTransactionId(input: Readonly<InitialBootstrapTransactionIdentityInput>): string;
}

export interface InitialBootstrapReconciliationInput {
  readonly run: Readonly<MigrationRun>;
  readonly projection: Readonly<InitialSnapshotProjection>;
  readonly lineage: Readonly<InitialSourceLineageProjection>;
}

// Production implementations must derive this evidence independently; candidate self-comparison is forbidden.
export interface InitialBootstrapReconciliationPort {
  reconcile(input: Readonly<InitialBootstrapReconciliationInput>): Promise<Readonly<InitialReconciliationEvidence>>;
}

export interface InitialBootstrapApplicationClock {
  now(): string;
}

export interface InitialBootstrapApplicationDependencies {
  readonly adapter: YdbAdapter;
  readonly identityAllocator: InitialBootstrapIdentityAllocator;
  readonly projectionContext: Readonly<InitialSnapshotProjectionContext>;
  readonly reconciliation: InitialBootstrapReconciliationPort;
  readonly clock: InitialBootstrapApplicationClock;
}

export type InitialBootstrapRecoveryReason =
  | 'CLAIM_OUTCOME_UNKNOWN'
  | 'REVISION_EVIDENCE_OUTCOME_UNKNOWN'
  | 'COUNTER_REFINEMENT_OUTCOME_UNKNOWN'
  | 'VALIDATION_TRANSITION_OUTCOME_UNKNOWN'
  | 'PROMOTION_OUTCOME_UNKNOWN'
  | 'VALIDATED_RUN_REQUIRES_RECOVERY';

export type InitialBootstrapApplicationResult =
  | Readonly<{
      status: 'BASELINE_EXISTS';
      run: Readonly<MigrationRun>;
    }>
  | Readonly<{
      status: 'VALIDATION_BLOCKED';
      run: Readonly<MigrationRun>;
      blockers: readonly Readonly<InitialValidationBlocker>[];
    }>
  | Readonly<{
      status: 'CONTROLLED_REBUILD_REQUIRED';
      run: Readonly<MigrationRun>;
      preflight: ReturnType<typeof planInitialBootstrapPromotion>['preflight'];
    }>
  | Readonly<{
      status: 'COMMITTED';
      run: Readonly<MigrationRun>;
    }>
  | Readonly<{
      status: 'RECOVERY_REQUIRED';
      run: Readonly<MigrationRun> | null;
      reason: InitialBootstrapRecoveryReason;
    }>;

export type InitialBootstrapApplicationErrorCode =
  | 'MULTIPLE_INCOMPLETE_RUNS'
  | 'RESUME_SNAPSHOT_DIGEST_MISMATCH'
  | 'RESUME_RUN_COUNTERS_MISMATCH'
  | 'RESUME_COUNTER_REFINEMENT_CONFLICT'
  | 'SNAPSHOT_EVIDENCE_MISSING'
  | 'SNAPSHOT_EVIDENCE_AMBIGUOUS'
  | 'SNAPSHOT_EVIDENCE_MISMATCH'
  | 'CURRENT_STATE_NOT_EMPTY'
  | 'PROMOTION_PREFLIGHT_DRIFT';

export class InitialBootstrapApplicationError extends Error {
  readonly code: InitialBootstrapApplicationErrorCode;

  constructor(code: InitialBootstrapApplicationErrorCode) {
    super(code);
    this.name = 'InitialBootstrapApplicationError';
    this.code = code;
  }
}

interface DurableSnapshotRow {
  readonly captured_at?: unknown;
  readonly snapshot_digest?: unknown;
  readonly row_count?: unknown;
}

interface PreparedBootstrapContext {
  readonly candidate: Readonly<InitialBootstrapCandidateEnvelope>;
  readonly projection: Readonly<InitialSnapshotProjection>;
  readonly assignments: readonly Readonly<InitialTransactionIdentityAssignment>[];
}

function counter(value: unknown): number | null {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function envelopeWithRun(
  candidate: Readonly<InitialBootstrapCandidateEnvelope>,
  run: Readonly<MigrationRun>,
): Readonly<InitialBootstrapCandidateEnvelope> {
  return Object.freeze({
    snapshot: candidate.snapshot,
    plan: candidate.plan,
    run,
  });
}

function projectionRows(
  candidate: Readonly<InitialBootstrapCandidateEnvelope>,
  observation: Readonly<InitialBootstrapObservation>,
) {
  return candidate.plan.candidates.map((source) => {
    const row = observation.rows[source.sourceOrdinal];
    if (row === undefined) {
      throw new InitialBootstrapApplicationError('RESUME_RUN_COUNTERS_MISMATCH');
    }
    return Object.freeze({
      sourceRecordId: source.sourceRecordId,
      sourceOrdinal: source.sourceOrdinal,
      rawPayload: row.rawPayload,
      aggregatePeriodMonth: row.aggregatePeriodMonth,
    });
  });
}

function lineageObservations(
  candidate: Readonly<InitialBootstrapCandidateEnvelope>,
  observation: Readonly<InitialBootstrapObservation>,
) {
  return candidate.plan.candidates.map((source) => {
    const row = observation.rows[source.sourceOrdinal];
    if (row === undefined) {
      throw new InitialBootstrapApplicationError('RESUME_RUN_COUNTERS_MISMATCH');
    }
    return Object.freeze({
      sourceRecordId: source.sourceRecordId,
      payload: row.rawPayload,
    });
  });
}

function allocateFreshSourceRows(
  observation: Readonly<InitialBootstrapObservation>,
  allocator: InitialBootstrapIdentityAllocator,
) {
  return observation.rows.map((row, sourceOrdinal) => Object.freeze({
    sourceRecordId: allocator.allocateSourceRecordId(Object.freeze({
      sourceOrdinal,
      rowHint: row.rowHint,
      digest: row.digest,
    })),
    rowHint: row.rowHint,
    digest: row.digest,
  }));
}

function allocateTransactionAssignments(
  projection: Readonly<InitialSnapshotProjection>,
  allocator: InitialBootstrapIdentityAllocator,
): readonly Readonly<InitialTransactionIdentityAssignment>[] {
  const assignments: Readonly<InitialTransactionIdentityAssignment>[] = [];
  for (const outcome of projection.outcomes) {
    if (
      outcome.projectionError === null
      && outcome.classification === 'FINANCIAL_RECORD'
      && outcome.transaction !== null
    ) {
      assignments.push(Object.freeze({
        sourceRecordId: outcome.sourceRecordId,
        transactionId: allocator.allocateTransactionId(Object.freeze({
          sourceOrdinal: outcome.sourceOrdinal,
          sourceRecordId: outcome.sourceRecordId,
        })),
      }));
    }
  }
  return Object.freeze(assignments);
}

function resumeObservations(
  observation: Readonly<InitialBootstrapObservation>,
): readonly Readonly<InitialBootstrapResumeObservation>[] {
  return Object.freeze(observation.rows.map((row, sourceOrdinal) => Object.freeze({
    sourceOrdinal,
    rowHint: row.rowHint,
    digest: row.digest,
  })));
}

function assertResumeRunMatchesCandidate(
  run: Readonly<MigrationRun>,
  candidate: Readonly<InitialBootstrapCandidateEnvelope>,
): void {
  if (
    run.rowsSeen !== candidate.plan.counters.rowsSeen
    || run.rowsNew !== candidate.plan.counters.rowsNew
    || run.rowsChanged !== 0
    || run.rowsMissing !== 0
  ) {
    throw new InitialBootstrapApplicationError('RESUME_RUN_COUNTERS_MISMATCH');
  }
}

async function readDurableSnapshot(
  adapter: YdbAdapter,
  snapshotId: string,
  expectedDigest: string,
  expectedRowCount: number,
): Promise<Readonly<{ capturedAt: string }>> {
  const result = await adapter.read<DurableSnapshotRow>(readStatement(
    'SELECT captured_at, CAST(snapshot_digest AS Utf8) AS snapshot_digest, row_count '
      + 'FROM source_snapshots WHERE id = $id',
    { id: uuidParameter(snapshotId) },
  ));
  if (result.rows.length === 0) {
    throw new InitialBootstrapApplicationError('SNAPSHOT_EVIDENCE_MISSING');
  }
  if (result.rows.length !== 1) {
    throw new InitialBootstrapApplicationError('SNAPSHOT_EVIDENCE_AMBIGUOUS');
  }
  const row = result.rows[0];
  const rowCount = counter(row?.row_count);
  if (
    row === undefined
    || typeof row.captured_at !== 'string'
    || row.captured_at.length === 0
    || row.captured_at !== row.captured_at.trim()
    || !Number.isFinite(Date.parse(row.captured_at))
    || row.snapshot_digest !== expectedDigest
    || rowCount !== expectedRowCount
  ) {
    throw new InitialBootstrapApplicationError('SNAPSHOT_EVIDENCE_MISMATCH');
  }
  return Object.freeze({ capturedAt: row.captured_at });
}

async function assertCurrentStateEmpty(adapter: YdbAdapter): Promise<void> {
  const expected = buildExpectedControlledRebuildReconciliation({
    sourceRecords: Object.freeze([]),
    transactions: Object.freeze([]),
  });
  const observed = await readControlledRebuildCurrentEvidence(adapter);
  const evidence = compareControlledRebuildStagingReconciliation(expected, observed);
  if (
    evidence.unexplainedHighImpactMismatchCount !== 0
    || INITIAL_RECONCILIATION_CHECKS.some((check) => evidence.checks[check] !== 'MATCHED')
  ) {
    throw new InitialBootstrapApplicationError('CURRENT_STATE_NOT_EMPTY');
  }
}

function recoveryRequired(
  reason: InitialBootstrapRecoveryReason,
  run: Readonly<MigrationRun> | null,
): InitialBootstrapApplicationResult {
  return Object.freeze({
    status: 'RECOVERY_REQUIRED' as const,
    run,
    reason,
  });
}

async function prepareFreshContext(
  observation: Readonly<InitialBootstrapObservation>,
  dependencies: Readonly<InitialBootstrapApplicationDependencies>,
): Promise<Readonly<PreparedBootstrapContext> | InitialBootstrapApplicationResult> {
  const sourceRows = allocateFreshSourceRows(observation, dependencies.identityAllocator);
  const candidate = buildInitialBootstrapCandidate({
    snapshotId: dependencies.identityAllocator.allocateSnapshotId(),
    migrationRunId: dependencies.identityAllocator.allocateMigrationRunId(),
    capturedAt: observation.capturedAt,
    startedAt: dependencies.clock.now(),
    snapshotDigest: observation.snapshotDigest,
    rows: sourceRows,
  });
  const projection = projectInitialSnapshot(
    projectionRows(candidate, observation),
    dependencies.projectionContext,
  );
  const assignments = allocateTransactionAssignments(projection, dependencies.identityAllocator);
  const manifest = buildInitialBootstrapIdentityManifest(candidate, projection, assignments);
  const metadataWrites = prepareInitialBootstrapMetadataWrites(candidate);
  const manifestWrite = prepareInitialBootstrapIdentityManifestWrite(manifest);
  try {
    await executeInitialBootstrapMetadataWrites(
      dependencies.adapter,
      candidate,
      metadataWrites,
      manifestWrite,
    );
  } catch (error) {
    if (error instanceof YdbCommitOutcomeUnknownError) {
      return recoveryRequired('CLAIM_OUTCOME_UNKNOWN', null);
    }
    throw error;
  }
  return Object.freeze({ candidate, projection, assignments });
}

async function prepareResumeContext(
  observation: Readonly<InitialBootstrapObservation>,
  run: Readonly<MigrationRun>,
  dependencies: Readonly<InitialBootstrapApplicationDependencies>,
): Promise<Readonly<PreparedBootstrapContext>> {
  if (run.sourceSnapshotDigest !== observation.snapshotDigest) {
    throw new InitialBootstrapApplicationError('RESUME_SNAPSHOT_DIGEST_MISMATCH');
  }
  const recovered = await recoverInitialBootstrapIdentities(
    dependencies.adapter,
    run.id,
    observation.snapshotDigest,
    resumeObservations(observation),
  );
  const snapshot = await readDurableSnapshot(
    dependencies.adapter,
    recovered.sourceSnapshotId,
    observation.snapshotDigest,
    observation.rows.length,
  );
  const baseCandidate = buildInitialBootstrapCandidate({
    snapshotId: recovered.sourceSnapshotId,
    migrationRunId: run.id,
    capturedAt: snapshot.capturedAt,
    startedAt: run.startedAt,
    snapshotDigest: observation.snapshotDigest,
    rows: recovered.sourceRows,
  });
  assertResumeRunMatchesCandidate(run, baseCandidate);
  const candidate = envelopeWithRun(baseCandidate, run);
  const projection = projectInitialSnapshot(
    projectionRows(candidate, observation),
    dependencies.projectionContext,
  );
  // Rebuilding the manifest is a pure semantic consistency check. No manifest write occurs on resume.
  buildInitialBootstrapIdentityManifest(candidate, projection, recovered.transactionAssignments);
  return Object.freeze({
    candidate,
    projection,
    assignments: recovered.transactionAssignments,
  });
}

async function persistRevisionEvidence(
  context: Readonly<PreparedBootstrapContext>,
  observation: Readonly<InitialBootstrapObservation>,
  adapter: YdbAdapter,
): Promise<InitialBootstrapApplicationResult | null> {
  const lineage = buildInitialSourceLineageProjection(
    context.candidate,
    lineageObservations(context.candidate, observation),
  );
  const resume = await planInitialSourceRevisionEvidenceResume(adapter, lineage.revisions);
  const missingWrites = prepareInitialSourceRevisionWrites(resume.missingRevisions);
  const batches = planInitialRevisionEvidenceBatches(missingWrites);
  try {
    await executeInitialRevisionEvidenceBatches(adapter, batches);
  } catch (error) {
    if (error instanceof YdbCommitOutcomeUnknownError) {
      return recoveryRequired('REVISION_EVIDENCE_OUTCOME_UNKNOWN', context.candidate.run);
    }
    throw error;
  }
  return null;
}

async function refineDurableRun(
  run: Readonly<MigrationRun>,
  projection: Readonly<InitialSnapshotProjection>,
  adapter: YdbAdapter,
): Promise<Readonly<MigrationRun> | InitialBootstrapApplicationResult> {
  const expectedAmbiguous = projection.counters.ambiguous;
  if (run.rowsAmbiguous === expectedAmbiguous) return run;
  if (run.rowsAmbiguous !== 0) {
    throw new InitialBootstrapApplicationError('RESUME_COUNTER_REFINEMENT_CONFLICT');
  }
  const refined = refineInitialRunCounters(run, projection);
  const prepared = prepareInitialRunCounterRefinementWrite(run, refined);
  try {
    return await executeInitialRunCounterRefinementWrite(adapter, prepared, refined);
  } catch (error) {
    if (error instanceof YdbCommitOutcomeUnknownError) {
      return recoveryRequired('COUNTER_REFINEMENT_OUTCOME_UNKNOWN', run);
    }
    throw error;
  }
}

function isApplicationResult(
  value: Readonly<MigrationRun> | InitialBootstrapApplicationResult,
): value is InitialBootstrapApplicationResult {
  return 'status' in value;
}

export async function runInitialBootstrapApplication(
  observation: Readonly<InitialBootstrapObservation>,
  dependencies: Readonly<InitialBootstrapApplicationDependencies>,
): Promise<InitialBootstrapApplicationResult> {
  const admission = await readScheduledSyncAdmissionEvidence(dependencies.adapter);
  if (admission.committedBaselineRun !== null) {
    return Object.freeze({
      status: 'BASELINE_EXISTS' as const,
      run: admission.committedBaselineRun,
    });
  }
  if (admission.incompleteRuns.length > 1) {
    throw new InitialBootstrapApplicationError('MULTIPLE_INCOMPLETE_RUNS');
  }

  const incomplete = admission.incompleteRuns[0] ?? null;
  if (incomplete?.state === 'VALIDATED') {
    return recoveryRequired('VALIDATED_RUN_REQUIRES_RECOVERY', incomplete);
  }

  await assertCurrentStateEmpty(dependencies.adapter);

  const prepared = incomplete === null
    ? await prepareFreshContext(observation, dependencies)
    : await prepareResumeContext(observation, incomplete, dependencies);
  if ('status' in prepared) return prepared;

  const evidenceRecovery = await persistRevisionEvidence(prepared, observation, dependencies.adapter);
  if (evidenceRecovery !== null) return evidenceRecovery;

  const lineage = buildInitialSourceLineageProjection(
    prepared.candidate,
    lineageObservations(prepared.candidate, observation),
  );
  const refined = await refineDurableRun(
    prepared.candidate.run,
    prepared.projection,
    dependencies.adapter,
  );
  if (isApplicationResult(refined)) return refined;
  const durableCandidate = envelopeWithRun(prepared.candidate, refined);

  const reconciliation = await dependencies.reconciliation.reconcile(Object.freeze({
    run: refined,
    projection: prepared.projection,
    lineage,
  }));
  const validation = evaluateInitialValidation(refined, prepared.projection, reconciliation);
  if (!validation.ok) {
    return Object.freeze({
      status: 'VALIDATION_BLOCKED' as const,
      run: refined,
      blockers: validation.blockers,
    });
  }

  const verifiedPlan: Readonly<InitialVerifiedCurrentPlan> = buildInitialVerifiedCurrentPlan(
    validation.validatedRun,
    lineage,
    prepared.projection,
    prepared.assignments,
  );
  const promotedAt = dependencies.clock.now();
  const currentWrites = prepareInitialVerifiedCurrentWrites(
    validation.validatedRun,
    verifiedPlan,
    promotedAt,
  );
  const promotionPlan = planInitialBootstrapPromotion(currentWrites);
  if (promotionPlan.route === 'CONTROLLED_REBUILD_REQUIRED') {
    return Object.freeze({
      status: 'CONTROLLED_REBUILD_REQUIRED' as const,
      run: durableCandidate.run,
      preflight: promotionPlan.preflight,
    });
  }

  // Re-prove the known-empty initial current state as close as possible to the ordinary atomic promotion.
  // No other production writer is authorized before cutover; any observed row therefore fails closed.
  await assertCurrentStateEmpty(dependencies.adapter);

  const validatedWrite = prepareMigrationRunValidatedWrite(refined, validation.validatedRun);
  let validatedRun: Readonly<MigrationRun>;
  try {
    validatedRun = await executeMigrationRunLifecycleWrite(
      dependencies.adapter,
      validatedWrite,
      validation.validatedRun,
    );
  } catch (error) {
    if (error instanceof YdbCommitOutcomeUnknownError) {
      return recoveryRequired('VALIDATION_TRANSITION_OUTCOME_UNKNOWN', refined);
    }
    throw error;
  }

  const finishedAt = dependencies.clock.now();
  try {
    const promotion = await promoteAtomicDelta(
      dependencies.adapter,
      validatedRun,
      promotionPlan.currentWrites,
      finishedAt,
    );
    if (promotion.status === 'FAILED_PRECHECK') {
      throw new InitialBootstrapApplicationError('PROMOTION_PREFLIGHT_DRIFT');
    }
    return Object.freeze({
      status: 'COMMITTED' as const,
      run: promotion.run,
    });
  } catch (error) {
    if (error instanceof YdbCommitOutcomeUnknownError) {
      return recoveryRequired('PROMOTION_OUTCOME_UNKNOWN', validatedRun);
    }
    throw error;
  }
}
