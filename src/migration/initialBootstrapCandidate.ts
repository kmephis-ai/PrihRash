import { SOURCE_SHEET_NAME } from '../integration/google/sourceSchema.js';
import {
  buildInitialBootstrapPlan,
  type InitialBootstrapPlan,
  type InitialSourceRow,
} from './initialSnapshot.js';
import {
  createMigrationRun,
  type MigrationRun,
} from './migrationRunState.js';

export interface InitialSnapshotManifest {
  readonly id: string;
  readonly capturedAt: string;
  readonly sourceSheet: typeof SOURCE_SHEET_NAME;
  readonly snapshotDigest: string;
  readonly rowCount: number;
}

export interface InitialBootstrapCandidateEnvelope {
  readonly snapshot: Readonly<InitialSnapshotManifest>;
  readonly plan: Readonly<InitialBootstrapPlan>;
  readonly run: Readonly<MigrationRun>;
}

export interface BuildInitialBootstrapCandidateInput {
  readonly snapshotId: string;
  readonly migrationRunId: string;
  readonly capturedAt: string;
  readonly startedAt: string;
  readonly snapshotDigest: string;
  readonly rows: readonly InitialSourceRow[];
}

export type InitialBootstrapCandidateErrorCode =
  | 'INVALID_SNAPSHOT_ID'
  | 'INVALID_MIGRATION_RUN_ID'
  | 'EMPTY_SNAPSHOT_DIGEST';

export class InitialBootstrapCandidateError extends Error {
  readonly code: InitialBootstrapCandidateErrorCode;

  constructor(code: InitialBootstrapCandidateErrorCode) {
    super(code);
    this.name = 'InitialBootstrapCandidateError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizeUuid(value: string, errorCode: InitialBootstrapCandidateErrorCode): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InitialBootstrapCandidateError(errorCode);
  }
  return value.toLowerCase();
}

export function buildInitialBootstrapCandidate(
  input: BuildInitialBootstrapCandidateInput,
): Readonly<InitialBootstrapCandidateEnvelope> {
  const snapshotId = normalizeUuid(input.snapshotId, 'INVALID_SNAPSHOT_ID');
  const migrationRunId = normalizeUuid(input.migrationRunId, 'INVALID_MIGRATION_RUN_ID');
  if (input.snapshotDigest.trim().length === 0) {
    throw new InitialBootstrapCandidateError('EMPTY_SNAPSHOT_DIGEST');
  }

  const plan = buildInitialBootstrapPlan(input.rows);
  const snapshot = Object.freeze({
    id: snapshotId,
    capturedAt: input.capturedAt,
    sourceSheet: SOURCE_SHEET_NAME,
    snapshotDigest: input.snapshotDigest,
    rowCount: plan.candidates.length,
  });
  const run = createMigrationRun({
    id: migrationRunId,
    startedAt: input.startedAt,
    sourceSnapshotDigest: input.snapshotDigest,
    counters: plan.counters,
  });

  return Object.freeze({ snapshot, plan, run });
}
