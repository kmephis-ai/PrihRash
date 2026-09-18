import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import {
  buildInitialBootstrapIdentityManifest,
  prepareInitialBootstrapIdentityManifestWrite,
} from '../../dist/migration/initialBootstrapIdentityManifest.js';
import { executeInitialBootstrapMetadataWrites } from '../../dist/migration/initialBootstrapMetadataExecutor.js';
import { prepareInitialBootstrapMetadataWrites } from '../../dist/migration/initialBootstrapPersistence.js';
import {
  ScheduledSyncAdmissionEvidenceError,
  parseScheduledSyncAdmissionEvidence,
} from '../../dist/migration/scheduledSyncAdmissionEvidence.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000009801';
const RUN_ID = '00000000-0000-0000-0000-000000009802';
const SOURCE_ID = '00000000-0000-0000-0000-000000009803';

function candidate() {
  return buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-15T07:00:00Z',
    startedAt: '2026-09-15T07:00:01Z',
    snapshotDigest: 'synthetic-timestamp-readback-digest',
    rows: [{ sourceRecordId: SOURCE_ID, rowHint: 2, digest: 'synthetic-row-digest' }],
  });
}

function identityWrite(input) {
  const projection = {
    outcomes: [{
      sourceRecordId: SOURCE_ID,
      sourceOrdinal: 0,
      classification: 'NON_FINANCIAL',
      legacyPeriodCloseClassification: null,
      transaction: null,
      projectionError: null,
    }],
    counters: {},
  };
  return prepareInitialBootstrapIdentityManifestWrite(
    buildInitialBootstrapIdentityManifest(input, projection, []),
  );
}

function runRow(input) {
  return {
    id: input.run.id,
    started_at: new Date(input.run.startedAt),
    finished_at: null,
    source_snapshot_digest: input.run.sourceSnapshotDigest,
    state: 'STAGING',
    rows_seen: BigInt(input.run.rowsSeen),
    rows_new: BigInt(input.run.rowsNew),
    rows_changed: BigInt(input.run.rowsChanged),
    rows_missing: BigInt(input.run.rowsMissing),
    rows_ambiguous: BigInt(input.run.rowsAmbiguous),
    error_code: null,
  };
}

test('fresh claim accepts native Date values returned for YDB Timestamp columns', async () => {
  const input = candidate();
  const writes = prepareInitialBootstrapMetadataWrites(input);
  const manifestWrite = identityWrite(input);
  const manifest = manifestWrite.manifest;
  let admissionReads = 0;
  const transport = {
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          if (statement.kind === 'WRITE') return { rows: [] };
          if (statement.text.includes("FROM migration_runs WHERE state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
            admissionReads += 1;
            return { rows: admissionReads === 1 ? [] : [runRow(input)] };
          }
          if (statement.text.includes('FROM source_snapshots WHERE id = $id')) {
            return { rows: [{
              captured_at: new Date(input.snapshot.capturedAt),
              source_sheet: input.snapshot.sourceSheet,
              snapshot_digest: input.snapshot.snapshotDigest,
              row_count: BigInt(input.snapshot.rowCount),
            }] };
          }
          if (statement.text.includes('FROM migration_runs WHERE id = $id')) {
            return { rows: [runRow(input)] };
          }
          if (statement.text.includes('FROM initial_bootstrap_identity_manifests')) {
            return { rows: [{
              source_snapshot_id: manifest.sourceSnapshotId,
              source_snapshot_digest: manifest.sourceSnapshotDigest,
              binding_count: BigInt(manifest.bindings.length),
              bindings: JSON.parse(manifestWrite.statement.parameters.bindings.value),
            }] };
          }
          throw new Error(`unexpected read: ${statement.text}`);
        },
      });
    },
  };

  await executeInitialBootstrapMetadataWrites(
    new YdbAdapter(transport),
    input,
    writes,
    manifestWrite,
  );
  assert.equal(admissionReads, 2);
});

test('admission evidence normalizes native Date but rejects invalid Date', () => {
  const parsed = parseScheduledSyncAdmissionEvidence([runRow(candidate())]);
  assert.equal(parsed.incompleteRuns[0].startedAt, '2026-09-15T07:00:01.000Z');

  assert.throws(
    () => parseScheduledSyncAdmissionEvidence([{ ...runRow(candidate()), started_at: new Date(Number.NaN) }]),
    (error) => error instanceof ScheduledSyncAdmissionEvidenceError
      && error.code === 'MALFORMED_RUN_EVIDENCE',
  );
});
