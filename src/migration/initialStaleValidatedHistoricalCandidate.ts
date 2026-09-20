import { createCanonicalSourceDigest } from '../integration/google/canonicalSourceDigest.js';
import { readStatement, type YdbReadScope } from '../integration/ydb/adapter.js';
import { uint64Parameter, uuidParameter } from '../integration/ydb/parameters.js';
import { normalizeYdbTimestampReadback, ydbTimestampReadbackMatches } from '../integration/ydb/readbackTimestamp.js';
import type { ReferenceResolver } from '../normalization/types.js';
import { buildInitialBootstrapCandidate } from './initialBootstrapCandidate.js';
import {
  buildInitialBootstrapIdentityManifest,
  initialBootstrapIdentityManifestReadStatement,
  initialBootstrapIdentityManifestsEqual,
  parseInitialBootstrapIdentityManifestRows,
} from './initialBootstrapIdentityManifest.js';
import type { InitialBootstrapPrivateHistoricalEvidence } from './initialBootstrapPrivateEvidence.js';
import type { RawPayload } from './rawPayloadDecoder.js';
import { normalizeRawPayload, serializeRawPayload, serializeRawPayloadForLineageDigest } from './rawPayloadProvenance.js';
import { buildInitialSourceLineageProjection } from './initialSourceLineage.js';
import { projectInitialSnapshot } from './initialSnapshotProjection.js';
import { evaluateValidatedInitialControlledRebuildContinuation } from './initialValidationGate.js';
import type { MigrationRun } from './migrationRunState.js';
import {
  buildInitialVerifiedCurrentPlan,
  type InitialTransactionIdentityAssignment,
  type InitialVerifiedCurrentPlan,
} from './initialVerifiedCurrentPlan.js';

export type InitialStaleValidatedHistoricalCandidateErrorCode =
  | 'RUN_NOT_VALIDATED'
  | 'MANIFEST_EVIDENCE_INVALID'
  | 'SNAPSHOT_EVIDENCE_INVALID'
  | 'REVISION_EVIDENCE_INVALID'
  | 'REVISION_PAYLOAD_DIGEST_MISMATCH'
  | 'IDENTITY_MANIFEST_RECONSTRUCTION_MISMATCH'
  | 'PROJECTION_CONTEXT_MISMATCH'
  | 'VALIDATED_RUN_INVARIANTS_MISMATCH'
  | 'VERIFIED_PLAN_RECONSTRUCTION_FAILED';

export class InitialStaleValidatedHistoricalCandidateError extends Error {
  readonly code: InitialStaleValidatedHistoricalCandidateErrorCode;

  constructor(code: InitialStaleValidatedHistoricalCandidateErrorCode) {
    super(code);
    this.name = 'InitialStaleValidatedHistoricalCandidateError';
    this.code = code;
  }
}

interface SnapshotRow {
  readonly captured_at?: unknown;
  readonly snapshot_digest?: unknown;
  readonly row_count?: unknown;
}

interface RevisionRow {
  readonly source_record_id?: unknown;
  readonly revision?: unknown;
  readonly migration_run_id?: unknown;
  readonly observed_at?: unknown;
  readonly row_hint?: unknown;
  readonly row_digest?: unknown;
  readonly change_class?: unknown;
  readonly raw_payload?: unknown;
}

interface HistoricalRevision {
  readonly sourceRecordId: string;
  readonly observedAt: string;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly rawPayload: RawPayload;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function integer(value: unknown, minimum: number): number | null {
  if (typeof value === 'bigint') {
    if (value < BigInt(minimum) || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function rawPayload(value: unknown): RawPayload | null {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  try {
    return normalizeRawPayload(parsed as Readonly<Record<string, unknown>>);
  } catch {
    return null;
  }
}

function revisionStatement(runId: string) {
  return readStatement(
    'SELECT source_record_id, revision, migration_run_id, observed_at, row_hint, '
      + 'CAST(row_digest AS Utf8) AS row_digest, change_class, raw_payload '
      + 'FROM source_record_revisions '
      + 'WHERE migration_run_id = $migration_run_id AND revision = $revision '
      + 'ORDER BY source_record_id',
    {
      migration_run_id: uuidParameter(runId),
      revision: uint64Parameter(1),
    },
  );
}

function snapshotStatement(snapshotId: string) {
  return readStatement(
    'SELECT captured_at, CAST(snapshot_digest AS Utf8) AS snapshot_digest, row_count '
      + 'FROM source_snapshots WHERE id = $id',
    { id: uuidParameter(snapshotId) },
  );
}

function parseSnapshot(
  rows: readonly Readonly<SnapshotRow>[],
  expectedDigest: string,
  expectedRowCount: number,
): string {
  if (rows.length !== 1) {
    throw new InitialStaleValidatedHistoricalCandidateError('SNAPSHOT_EVIDENCE_INVALID');
  }
  const row = rows[0];
  const capturedAt = normalizeYdbTimestampReadback(row?.captured_at);
  if (
    row === undefined
    || capturedAt === null
    || row.snapshot_digest !== expectedDigest
    || integer(row.row_count, 0) !== expectedRowCount
  ) {
    throw new InitialStaleValidatedHistoricalCandidateError('SNAPSHOT_EVIDENCE_INVALID');
  }
  return capturedAt;
}

function parseRevisions(
  rows: readonly Readonly<RevisionRow>[],
  run: Readonly<MigrationRun>,
  capturedAt: string,
  expectedBySource: ReadonlyMap<string, Readonly<{ rowHint: number; rowDigest: string }>>,
): readonly Readonly<HistoricalRevision>[] {
  if (rows.length !== expectedBySource.size) {
    throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
  }
  const seen = new Set<string>();
  const digest = createCanonicalSourceDigest();
  const revisions: HistoricalRevision[] = [];

  for (const row of rows) {
    const sourceRecordId = uuid(row.source_record_id);
    const migrationRunId = uuid(row.migration_run_id);
    const observedAt = normalizeYdbTimestampReadback(row.observed_at);
    const rowHint = integer(row.row_hint, 1);
    const rowDigest = nonEmptyString(row.row_digest);
    const payload = rawPayload(row.raw_payload);
    const expected = sourceRecordId === null ? undefined : expectedBySource.get(sourceRecordId);
    if (
      sourceRecordId === null
      || migrationRunId !== run.id.toLowerCase()
      || integer(row.revision, 1) !== 1
      || observedAt === null
      || !ydbTimestampReadbackMatches(row.observed_at, capturedAt)
      || rowHint === null
      || rowDigest === null
      || row.change_class !== null
      || payload === null
      || expected === undefined
      || expected.rowHint !== rowHint
      || expected.rowDigest !== rowDigest
      || seen.has(sourceRecordId)
    ) {
      throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
    }
    const recomputedDigest = digest.digestCanonicalRow(serializeRawPayloadForLineageDigest(payload));
    if (recomputedDigest !== rowDigest) {
      throw new InitialStaleValidatedHistoricalCandidateError('REVISION_PAYLOAD_DIGEST_MISMATCH');
    }
    seen.add(sourceRecordId);
    revisions.push(Object.freeze({ sourceRecordId, observedAt, rowHint, rowDigest, rawPayload: payload }));
  }

  if (seen.size !== expectedBySource.size) {
    throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
  }
  return Object.freeze(revisions);
}

export async function reconstructInitialStaleValidatedHistoricalCandidate(
  reader: YdbReadScope,
  run: Readonly<MigrationRun>,
  refs: ReferenceResolver,
  historicalEvidence: Readonly<InitialBootstrapPrivateHistoricalEvidence>,
): Promise<Readonly<{
  run: Readonly<MigrationRun>;
  verifiedPlan: Readonly<InitialVerifiedCurrentPlan>;
}>> {
  if (run.state !== 'VALIDATED' || run.finishedAt !== null || run.errorCode !== null) {
    throw new InitialStaleValidatedHistoricalCandidateError('RUN_NOT_VALIDATED');
  }

  let readback;
  try {
    const manifestResult = await reader.read<Record<string, unknown>>(
      initialBootstrapIdentityManifestReadStatement(run.id),
    );
    readback = parseInitialBootstrapIdentityManifestRows(run.id, manifestResult.rows);
  } catch {
    throw new InitialStaleValidatedHistoricalCandidateError('MANIFEST_EVIDENCE_INVALID');
  }

  if (
    readback.runState !== 'VALIDATED'
    || readback.runSnapshotDigest !== run.sourceSnapshotDigest
    || readback.snapshotDigest !== run.sourceSnapshotDigest
    || readback.manifest.sourceSnapshotDigest !== run.sourceSnapshotDigest
    || readback.snapshotRowCount !== run.rowsSeen
    || readback.manifest.bindings.length !== run.rowsSeen
  ) {
    throw new InitialStaleValidatedHistoricalCandidateError('MANIFEST_EVIDENCE_INVALID');
  }

  const snapshotResult = await reader.read<SnapshotRow>(snapshotStatement(readback.manifest.sourceSnapshotId));
  const capturedAt = parseSnapshot(snapshotResult.rows, run.sourceSnapshotDigest, run.rowsSeen);
  historicalEvidence.assertCompatibleRowCount(run.rowsSeen);

  const expectedBySource = new Map(readback.manifest.bindings.map((binding) => [
    binding.sourceRecordId,
    Object.freeze({ rowHint: binding.rowHint, rowDigest: binding.rowDigest }),
  ] as const));
  let durableRevisions: readonly Readonly<HistoricalRevision>[];
  try {
    const revisionResult = await reader.read<RevisionRow>(revisionStatement(run.id));
    durableRevisions = parseRevisions(revisionResult.rows, run, capturedAt, expectedBySource);
  } catch (error) {
    if (error instanceof InitialStaleValidatedHistoricalCandidateError) throw error;
    throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
  }

  const revisionBySource = new Map(durableRevisions.map((revision) => [revision.sourceRecordId, revision] as const));
  const sourceRows = readback.manifest.bindings.map((binding) => Object.freeze({
    sourceRecordId: binding.sourceRecordId,
    rowHint: binding.rowHint,
    digest: binding.rowDigest,
  }));
  const baseCandidate = buildInitialBootstrapCandidate({
    snapshotId: readback.manifest.sourceSnapshotId,
    migrationRunId: run.id,
    capturedAt,
    startedAt: run.startedAt,
    snapshotDigest: run.sourceSnapshotDigest,
    rows: sourceRows,
  });

  const projectionRows = readback.manifest.bindings.map((binding) => {
    const revision = revisionBySource.get(binding.sourceRecordId);
    if (revision === undefined) {
      throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
    }
    return Object.freeze({
      sourceRecordId: binding.sourceRecordId,
      sourceOrdinal: binding.sourceOrdinal,
      rawPayload: revision.rawPayload,
      aggregatePeriodMonth: historicalEvidence.aggregatePeriodMonthForSourceOrdinal(binding.sourceOrdinal),
    });
  });

  let projection;
  try {
    projection = projectInitialSnapshot(projectionRows, Object.freeze({
      granularityEvidence: historicalEvidence.granularityEvidence,
      refs,
    }));
  } catch {
    throw new InitialStaleValidatedHistoricalCandidateError('PROJECTION_CONTEXT_MISMATCH');
  }

  const assignments: Readonly<InitialTransactionIdentityAssignment>[] = Object.freeze(
    readback.manifest.bindings.flatMap((binding) => (
      binding.transactionId === null
        ? []
        : [Object.freeze({ sourceRecordId: binding.sourceRecordId, transactionId: binding.transactionId })]
    )),
  );

  try {
    const rebuiltManifest = buildInitialBootstrapIdentityManifest(baseCandidate, projection, assignments);
    if (!initialBootstrapIdentityManifestsEqual(rebuiltManifest, readback.manifest)) {
      throw new InitialStaleValidatedHistoricalCandidateError('IDENTITY_MANIFEST_RECONSTRUCTION_MISMATCH');
    }
  } catch (error) {
    if (error instanceof InitialStaleValidatedHistoricalCandidateError) throw error;
    throw new InitialStaleValidatedHistoricalCandidateError('IDENTITY_MANIFEST_RECONSTRUCTION_MISMATCH');
  }

  const lineage = buildInitialSourceLineageProjection(
    baseCandidate,
    readback.manifest.bindings.map((binding) => {
      const revision = revisionBySource.get(binding.sourceRecordId);
      if (revision === undefined) {
        throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
      }
      return Object.freeze({ sourceRecordId: binding.sourceRecordId, payload: revision.rawPayload });
    }),
  );
  const lineageRevisionBySource = new Map(lineage.revisions.map((revision) => [revision.sourceRecordId, revision] as const));
  for (const durable of durableRevisions) {
    const rebuilt = lineageRevisionBySource.get(durable.sourceRecordId);
    if (
      rebuilt === undefined
      || rebuilt.migrationRunId !== run.id.toLowerCase()
      || rebuilt.observedAt !== capturedAt
      || rebuilt.rowHint !== durable.rowHint
      || rebuilt.rowDigest !== durable.rowDigest
      || rebuilt.changeClass !== null
      || rebuilt.rawPayload !== serializeRawPayload(durable.rawPayload)
    ) {
      throw new InitialStaleValidatedHistoricalCandidateError('REVISION_EVIDENCE_INVALID');
    }
  }

  const validation = evaluateValidatedInitialControlledRebuildContinuation(run, projection);
  if (!validation.ok) {
    throw new InitialStaleValidatedHistoricalCandidateError('VALIDATED_RUN_INVARIANTS_MISMATCH');
  }

  try {
    return Object.freeze({
      run: validation.validatedRun,
      verifiedPlan: buildInitialVerifiedCurrentPlan(
        validation.validatedRun,
        lineage,
        projection,
        assignments,
      ),
    });
  } catch {
    throw new InitialStaleValidatedHistoricalCandidateError('VERIFIED_PLAN_RECONSTRUCTION_FAILED');
  }
}
