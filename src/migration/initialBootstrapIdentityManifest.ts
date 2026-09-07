import {
  readStatement,
  type YdbReadScope,
  type YdbStatement,
  writeStatement,
} from '../integration/ydb/adapter.js';
import {
  jsonDocumentParameter,
  stringParameter,
  uint64Parameter,
  uuidParameter,
  type YdbParameter,
} from '../integration/ydb/parameters.js';
import type { InitialBootstrapCandidateEnvelope } from './initialBootstrapCandidate.js';
import type { InitialSnapshotProjection } from './initialSnapshotProjection.js';
import type { InitialSourceRow } from './initialSnapshot.js';
import type { InitialTransactionIdentityAssignment } from './initialVerifiedCurrentPlan.js';

export interface InitialBootstrapIdentityBinding {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly rowDigest: string;
  readonly sourceRecordId: string;
  readonly transactionId: string | null;
}

export interface InitialBootstrapIdentityManifest {
  readonly migrationRunId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotDigest: string;
  readonly bindings: readonly Readonly<InitialBootstrapIdentityBinding>[];
}

export interface PreparedInitialBootstrapIdentityManifestWrite {
  readonly role: 'IDENTITY_MANIFEST';
  readonly manifest: Readonly<InitialBootstrapIdentityManifest>;
  readonly statement: YdbStatement;
  readonly estimatedParameterBytes: number;
}

export interface InitialBootstrapResumeObservation {
  readonly sourceOrdinal: number;
  readonly rowHint: number;
  readonly digest: string;
}

export interface InitialBootstrapIdentityRecovery {
  readonly sourceSnapshotId: string;
  readonly sourceRows: readonly Readonly<InitialSourceRow>[];
  readonly transactionAssignments: readonly Readonly<InitialTransactionIdentityAssignment>[];
}

export interface InitialBootstrapIdentityManifestReadback {
  readonly manifest: Readonly<InitialBootstrapIdentityManifest>;
  readonly runState: string;
  readonly runSnapshotDigest: string;
  readonly snapshotDigest: string;
  readonly snapshotRowCount: number;
}

export type InitialBootstrapIdentityManifestErrorCode =
  | 'RUN_NOT_STAGING'
  | 'PROJECTION_LENGTH_MISMATCH'
  | 'PROJECTION_IDENTITY_MISMATCH'
  | 'INVALID_PROJECTION_OUTCOME'
  | 'INVALID_TRANSACTION_ASSIGNMENT_UUID'
  | 'DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID'
  | 'DUPLICATE_TRANSACTION_ID'
  | 'MISSING_TRANSACTION_ASSIGNMENT'
  | 'UNEXPECTED_TRANSACTION_ASSIGNMENT'
  | 'MALFORMED_MANIFEST_ROW'
  | 'MANIFEST_NOT_FOUND'
  | 'MANIFEST_EVIDENCE_MISMATCH'
  | 'INVALID_RESUME_OBSERVATION'
  | 'DUPLICATE_RESUME_ORDINAL'
  | 'RUN_NOT_RESUMABLE';

export class InitialBootstrapIdentityManifestError extends Error {
  readonly code: InitialBootstrapIdentityManifestErrorCode;

  constructor(code: InitialBootstrapIdentityManifestErrorCode) {
    super(code);
    this.name = 'InitialBootstrapIdentityManifestError';
    this.code = code;
  }
}

interface IdentityManifestReadRow {
  readonly source_snapshot_id?: unknown;
  readonly source_snapshot_digest?: unknown;
  readonly binding_count?: unknown;
  readonly bindings?: unknown;
  readonly run_state?: unknown;
  readonly run_snapshot_digest?: unknown;
  readonly snapshot_digest?: unknown;
  readonly snapshot_row_count?: unknown;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TEXT_ENCODER = new TextEncoder();
const PARAMETER_VALUE_OVERHEAD_BYTES = 16;

function normalizedUuid(value: string, code: InitialBootstrapIdentityManifestErrorCode): string {
  if (!UUID_PATTERN.test(value)) throw new InitialBootstrapIdentityManifestError(code);
  return value.toLowerCase();
}

function assignmentMap(
  assignments: readonly InitialTransactionIdentityAssignment[],
): ReadonlyMap<string, string> {
  const bySource = new Map<string, string>();
  const transactionIds = new Set<string>();
  for (const assignment of assignments) {
    const sourceRecordId = assignment.sourceRecordId.toLowerCase();
    const transactionId = normalizedUuid(assignment.transactionId, 'INVALID_TRANSACTION_ASSIGNMENT_UUID');
    if (bySource.has(sourceRecordId)) {
      throw new InitialBootstrapIdentityManifestError('DUPLICATE_TRANSACTION_ASSIGNMENT_SOURCE_ID');
    }
    if (transactionIds.has(transactionId)) {
      throw new InitialBootstrapIdentityManifestError('DUPLICATE_TRANSACTION_ID');
    }
    bySource.set(sourceRecordId, transactionId);
    transactionIds.add(transactionId);
  }
  return bySource;
}

function projectionByOrdinal(
  projection: Readonly<InitialSnapshotProjection>,
): ReadonlyMap<number, InitialSnapshotProjection['outcomes'][number]> {
  const byOrdinal = new Map<number, InitialSnapshotProjection['outcomes'][number]>();
  for (const outcome of projection.outcomes) {
    if (byOrdinal.has(outcome.sourceOrdinal)) {
      throw new InitialBootstrapIdentityManifestError('PROJECTION_IDENTITY_MISMATCH');
    }
    byOrdinal.set(outcome.sourceOrdinal, outcome);
  }
  return byOrdinal;
}

function transactionApplicable(outcome: InitialSnapshotProjection['outcomes'][number]): boolean {
  if (outcome.projectionError !== null) {
    if (outcome.transaction !== null) {
      throw new InitialBootstrapIdentityManifestError('INVALID_PROJECTION_OUTCOME');
    }
    return false;
  }
  if (outcome.classification === 'FINANCIAL_RECORD') {
    if (outcome.transaction === null) {
      throw new InitialBootstrapIdentityManifestError('INVALID_PROJECTION_OUTCOME');
    }
    return true;
  }
  if (outcome.transaction !== null) {
    throw new InitialBootstrapIdentityManifestError('INVALID_PROJECTION_OUTCOME');
  }
  return false;
}

export function buildInitialBootstrapIdentityManifest(
  candidate: Readonly<InitialBootstrapCandidateEnvelope>,
  projection: Readonly<InitialSnapshotProjection>,
  assignments: readonly InitialTransactionIdentityAssignment[],
): Readonly<InitialBootstrapIdentityManifest> {
  if (candidate.run.state !== 'STAGING') {
    throw new InitialBootstrapIdentityManifestError('RUN_NOT_STAGING');
  }
  if (projection.outcomes.length !== candidate.plan.candidates.length) {
    throw new InitialBootstrapIdentityManifestError('PROJECTION_LENGTH_MISMATCH');
  }

  const outcomes = projectionByOrdinal(projection);
  const assignmentsBySource = assignmentMap(assignments);
  const usedAssignments = new Set<string>();
  const bindings = candidate.plan.candidates.map((source): Readonly<InitialBootstrapIdentityBinding> => {
    const outcome = outcomes.get(source.sourceOrdinal);
    if (outcome === undefined || outcome.sourceRecordId.toLowerCase() !== source.sourceRecordId) {
      throw new InitialBootstrapIdentityManifestError('PROJECTION_IDENTITY_MISMATCH');
    }
    const assignedTransactionId = assignmentsBySource.get(source.sourceRecordId) ?? null;
    if (transactionApplicable(outcome)) {
      if (assignedTransactionId === null) {
        throw new InitialBootstrapIdentityManifestError('MISSING_TRANSACTION_ASSIGNMENT');
      }
      usedAssignments.add(source.sourceRecordId);
    } else if (assignedTransactionId !== null) {
      throw new InitialBootstrapIdentityManifestError('UNEXPECTED_TRANSACTION_ASSIGNMENT');
    }

    return Object.freeze({
      sourceOrdinal: source.sourceOrdinal,
      rowHint: source.rowHint,
      rowDigest: source.digest,
      sourceRecordId: source.sourceRecordId,
      transactionId: assignedTransactionId,
    });
  });

  if (usedAssignments.size !== assignmentsBySource.size) {
    throw new InitialBootstrapIdentityManifestError('UNEXPECTED_TRANSACTION_ASSIGNMENT');
  }

  return Object.freeze({
    migrationRunId: candidate.run.id,
    sourceSnapshotId: candidate.snapshot.id,
    sourceSnapshotDigest: candidate.snapshot.snapshotDigest,
    bindings: Object.freeze(bindings),
  });
}

function serializedBindings(manifest: Readonly<InitialBootstrapIdentityManifest>): string {
  return JSON.stringify({
    schema_version: 1,
    bindings: manifest.bindings.map((binding) => ({
      source_ordinal: binding.sourceOrdinal,
      row_hint: binding.rowHint,
      row_digest: binding.rowDigest,
      source_record_id: binding.sourceRecordId,
      transaction_id: binding.transactionId,
    })),
  });
}

function parameterBytes(parameter: YdbParameter): number {
  if (parameter.value === null) return 0;
  return TEXT_ENCODER.encode(String(parameter.value)).byteLength;
}

function estimatedParameterBytes(parameters: Readonly<Record<string, YdbParameter>>): number {
  return Object.values(parameters).reduce(
    (total, parameter) => total + PARAMETER_VALUE_OVERHEAD_BYTES + parameterBytes(parameter),
    0,
  );
}

export function prepareInitialBootstrapIdentityManifestWrite(
  manifest: Readonly<InitialBootstrapIdentityManifest>,
): Readonly<PreparedInitialBootstrapIdentityManifestWrite> {
  const parameters = Object.freeze({
    migration_run_id: uuidParameter(manifest.migrationRunId),
    source_snapshot_id: uuidParameter(manifest.sourceSnapshotId),
    source_snapshot_digest: stringParameter(manifest.sourceSnapshotDigest),
    binding_count: uint64Parameter(manifest.bindings.length),
    bindings: jsonDocumentParameter(serializedBindings(manifest)),
  });
  return Object.freeze({
    role: 'IDENTITY_MANIFEST' as const,
    manifest,
    statement: writeStatement(
      'INSERT INTO initial_bootstrap_identity_manifests '
        + '(migration_run_id, source_snapshot_id, source_snapshot_digest, binding_count, bindings) '
        + 'VALUES ($migration_run_id, $source_snapshot_id, $source_snapshot_digest, $binding_count, $bindings)',
      parameters,
    ),
    estimatedParameterBytes: estimatedParameterBytes(parameters),
  });
}

function malformed(): never {
  throw new InitialBootstrapIdentityManifestError('MALFORMED_MANIFEST_ROW');
}

function safeInteger(value: unknown, minimum: number): number {
  if (typeof value === 'bigint') {
    if (value < BigInt(minimum) || value > BigInt(Number.MAX_SAFE_INTEGER)) malformed();
    return Number(value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) malformed();
  return value;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) malformed();
  return value;
}

function parseBinding(value: unknown): Readonly<InitialBootstrapIdentityBinding> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) malformed();
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  const expected = ['source_ordinal', 'row_hint', 'row_digest', 'source_record_id', 'transaction_id'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) malformed();
  const transactionId = record.transaction_id === null
    ? null
    : normalizedUuid(nonEmptyString(record.transaction_id), 'MALFORMED_MANIFEST_ROW');
  return Object.freeze({
    sourceOrdinal: safeInteger(record.source_ordinal, 0),
    rowHint: safeInteger(record.row_hint, 1),
    rowDigest: nonEmptyString(record.row_digest),
    sourceRecordId: normalizedUuid(nonEmptyString(record.source_record_id), 'MALFORMED_MANIFEST_ROW'),
    transactionId,
  });
}

function parseBindings(value: unknown): readonly Readonly<InitialBootstrapIdentityBinding>[] {
  let payload: unknown = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      malformed();
    }
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) malformed();
  const record = payload as Readonly<Record<string, unknown>>;
  if (record.schema_version !== 1 || !Array.isArray(record.bindings)) malformed();
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes('schema_version') || !keys.includes('bindings')) malformed();

  const bindings = record.bindings.map(parseBinding).sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
  const sourceIds = new Set<string>();
  const transactionIds = new Set<string>();
  for (const [index, binding] of bindings.entries()) {
    if (binding.sourceOrdinal !== index || sourceIds.has(binding.sourceRecordId)) malformed();
    sourceIds.add(binding.sourceRecordId);
    if (binding.transactionId !== null) {
      if (transactionIds.has(binding.transactionId)) malformed();
      transactionIds.add(binding.transactionId);
    }
  }
  return Object.freeze(bindings);
}

export function initialBootstrapIdentityManifestReadStatement(migrationRunId: string): YdbStatement {
  return readStatement(
    'SELECT m.source_snapshot_id, CAST(m.source_snapshot_digest AS Utf8) AS source_snapshot_digest, '
      + 'm.binding_count, m.bindings, r.state AS run_state, '
      + 'CAST(r.source_snapshot_digest AS Utf8) AS run_snapshot_digest, '
      + 'CAST(s.snapshot_digest AS Utf8) AS snapshot_digest, s.row_count AS snapshot_row_count '
      + 'FROM initial_bootstrap_identity_manifests AS m '
      + 'JOIN migration_runs AS r ON r.id = m.migration_run_id '
      + 'JOIN source_snapshots AS s ON s.id = m.source_snapshot_id '
      + 'WHERE m.migration_run_id = $migration_run_id',
    { migration_run_id: uuidParameter(migrationRunId) },
  );
}

export function parseInitialBootstrapIdentityManifestRows(
  migrationRunId: string,
  rows: readonly Readonly<IdentityManifestReadRow>[],
): Readonly<InitialBootstrapIdentityManifestReadback> {
  if (rows.length === 0) throw new InitialBootstrapIdentityManifestError('MANIFEST_NOT_FOUND');
  if (rows.length !== 1) malformed();
  const row = rows[0];
  if (row === undefined) malformed();
  const bindings = parseBindings(row.bindings);
  const bindingCount = safeInteger(row.binding_count, 0);
  const snapshotRowCount = safeInteger(row.snapshot_row_count, 0);
  if (bindingCount !== bindings.length) malformed();
  const runState = nonEmptyString(row.run_state);
  return Object.freeze({
    manifest: Object.freeze({
      migrationRunId: normalizedUuid(migrationRunId, 'MALFORMED_MANIFEST_ROW'),
      sourceSnapshotId: normalizedUuid(nonEmptyString(row.source_snapshot_id), 'MALFORMED_MANIFEST_ROW'),
      sourceSnapshotDigest: nonEmptyString(row.source_snapshot_digest),
      bindings,
    }),
    runState,
    runSnapshotDigest: nonEmptyString(row.run_snapshot_digest),
    snapshotDigest: nonEmptyString(row.snapshot_digest),
    snapshotRowCount,
  });
}

export function initialBootstrapIdentityManifestsEqual(
  left: Readonly<InitialBootstrapIdentityManifest>,
  right: Readonly<InitialBootstrapIdentityManifest>,
): boolean {
  if (
    left.migrationRunId !== right.migrationRunId
    || left.sourceSnapshotId !== right.sourceSnapshotId
    || left.sourceSnapshotDigest !== right.sourceSnapshotDigest
    || left.bindings.length !== right.bindings.length
  ) return false;
  return left.bindings.every((binding, index) => {
    const other = right.bindings[index];
    return other !== undefined
      && binding.sourceOrdinal === other.sourceOrdinal
      && binding.rowHint === other.rowHint
      && binding.rowDigest === other.rowDigest
      && binding.sourceRecordId === other.sourceRecordId
      && binding.transactionId === other.transactionId;
  });
}

function normalizeResumeObservations(
  observations: readonly InitialBootstrapResumeObservation[],
): readonly Readonly<InitialBootstrapResumeObservation>[] {
  const ordinals = new Set<number>();
  const normalized = observations.map((observation) => {
    if (
      !Number.isSafeInteger(observation.sourceOrdinal)
      || observation.sourceOrdinal < 0
      || !Number.isSafeInteger(observation.rowHint)
      || observation.rowHint < 1
      || observation.digest.trim().length === 0
      || observation.digest !== observation.digest.trim()
    ) {
      throw new InitialBootstrapIdentityManifestError('INVALID_RESUME_OBSERVATION');
    }
    if (ordinals.has(observation.sourceOrdinal)) {
      throw new InitialBootstrapIdentityManifestError('DUPLICATE_RESUME_ORDINAL');
    }
    ordinals.add(observation.sourceOrdinal);
    return Object.freeze({ ...observation });
  }).sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
  for (const [index, observation] of normalized.entries()) {
    if (observation.sourceOrdinal !== index) {
      throw new InitialBootstrapIdentityManifestError('INVALID_RESUME_OBSERVATION');
    }
  }
  return Object.freeze(normalized);
}

export async function recoverInitialBootstrapIdentities(
  reader: YdbReadScope,
  migrationRunId: string,
  sourceSnapshotDigest: string,
  observations: readonly InitialBootstrapResumeObservation[],
): Promise<Readonly<InitialBootstrapIdentityRecovery>> {
  const result = await reader.read<IdentityManifestReadRow>(
    initialBootstrapIdentityManifestReadStatement(migrationRunId),
  );
  const readback = parseInitialBootstrapIdentityManifestRows(migrationRunId, result.rows);
  if (readback.runState !== 'STAGING' && readback.runState !== 'VALIDATED') {
    throw new InitialBootstrapIdentityManifestError('RUN_NOT_RESUMABLE');
  }
  const normalizedObservations = normalizeResumeObservations(observations);
  if (
    readback.manifest.sourceSnapshotDigest !== sourceSnapshotDigest
    || readback.runSnapshotDigest !== sourceSnapshotDigest
    || readback.snapshotDigest !== sourceSnapshotDigest
    || readback.snapshotRowCount !== normalizedObservations.length
    || readback.manifest.bindings.length !== normalizedObservations.length
  ) {
    throw new InitialBootstrapIdentityManifestError('MANIFEST_EVIDENCE_MISMATCH');
  }

  const sourceRows: Readonly<InitialSourceRow>[] = [];
  const transactionAssignments: Readonly<InitialTransactionIdentityAssignment>[] = [];
  for (const [index, binding] of readback.manifest.bindings.entries()) {
    const observation = normalizedObservations[index];
    if (
      observation === undefined
      || binding.sourceOrdinal !== observation.sourceOrdinal
      || binding.rowHint !== observation.rowHint
      || binding.rowDigest !== observation.digest
    ) {
      throw new InitialBootstrapIdentityManifestError('MANIFEST_EVIDENCE_MISMATCH');
    }
    sourceRows.push(Object.freeze({
      sourceRecordId: binding.sourceRecordId,
      rowHint: binding.rowHint,
      digest: binding.rowDigest,
    }));
    if (binding.transactionId !== null) {
      transactionAssignments.push(Object.freeze({
        sourceRecordId: binding.sourceRecordId,
        transactionId: binding.transactionId,
      }));
    }
  }

  return Object.freeze({
    sourceSnapshotId: readback.manifest.sourceSnapshotId,
    sourceRows: Object.freeze(sourceRows),
    transactionAssignments: Object.freeze(transactionAssignments),
  });
}
