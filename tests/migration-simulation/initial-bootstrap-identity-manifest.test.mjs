import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { buildInitialBootstrapCandidate } from '../../dist/migration/initialBootstrapCandidate.js';
import {
  InitialBootstrapIdentityManifestError,
  buildInitialBootstrapIdentityManifest,
  prepareInitialBootstrapIdentityManifestWrite,
  recoverInitialBootstrapIdentities,
} from '../../dist/migration/initialBootstrapIdentityManifest.js';

const SNAPSHOT_ID = '00000000-0000-0000-0000-000000009401';
const RUN_ID = '00000000-0000-0000-0000-000000009402';
const SOURCE_ID_1 = '00000000-0000-0000-0000-000000009403';
const SOURCE_ID_2 = '00000000-0000-0000-0000-000000009404';
const TRANSACTION_ID = '00000000-0000-0000-0000-000000009405';

function candidate() {
  return buildInitialBootstrapCandidate({
    snapshotId: SNAPSHOT_ID,
    migrationRunId: RUN_ID,
    capturedAt: '2026-09-07T19:40:00Z',
    startedAt: '2026-09-07T19:40:01Z',
    snapshotDigest: 'synthetic-snapshot-digest',
    rows: [
      { sourceRecordId: SOURCE_ID_1, rowHint: 2, digest: 'synthetic-row-a' },
      { sourceRecordId: SOURCE_ID_2, rowHint: 3, digest: 'synthetic-row-b' },
    ],
  });
}

function projection() {
  return {
    outcomes: [
      {
        sourceRecordId: SOURCE_ID_1,
        sourceOrdinal: 0,
        classification: 'FINANCIAL_RECORD',
        legacyPeriodCloseClassification: null,
        transaction: {},
        projectionError: null,
      },
      {
        sourceRecordId: SOURCE_ID_2,
        sourceOrdinal: 1,
        classification: 'AMBIGUOUS',
        legacyPeriodCloseClassification: null,
        transaction: null,
        projectionError: null,
      },
    ],
    counters: {},
  };
}

function assignment() {
  return { sourceRecordId: SOURCE_ID_1, transactionId: TRANSACTION_ID };
}

function manifest() {
  return buildInitialBootstrapIdentityManifest(candidate(), projection(), [assignment()]);
}

function readbackRow(write, overrides = {}) {
  return {
    source_snapshot_id: SNAPSHOT_ID,
    source_snapshot_digest: 'synthetic-snapshot-digest',
    binding_count: 2n,
    bindings: JSON.parse(write.statement.parameters.bindings.value),
    run_state: 'STAGING',
    run_snapshot_digest: 'synthetic-snapshot-digest',
    snapshot_digest: 'synthetic-snapshot-digest',
    snapshot_row_count: 2n,
    ...overrides,
  };
}

function reader(rows) {
  return new YdbAdapter({
    async executeRead(statement) {
      assert.match(statement.text, /FROM initial_bootstrap_identity_manifests AS m/);
      assert.equal(statement.parameters.migration_run_id.value, RUN_ID);
      return { rows };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });
}

function expectManifestError(code, work) {
  return assert.rejects(
    work,
    (error) => error instanceof InitialBootstrapIdentityManifestError && error.code === code,
  );
}

test('builds one immutable run-scoped identity manifest with exact source and applicable transaction IDs', () => {
  const value = manifest();
  assert.deepEqual(value, {
    migrationRunId: RUN_ID,
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    bindings: [
      {
        sourceOrdinal: 0,
        rowHint: 2,
        rowDigest: 'synthetic-row-a',
        sourceRecordId: SOURCE_ID_1,
        transactionId: TRANSACTION_ID,
      },
      {
        sourceOrdinal: 1,
        rowHint: 3,
        rowDigest: 'synthetic-row-b',
        sourceRecordId: SOURCE_ID_2,
        transactionId: null,
      },
    ],
  });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(value.bindings.every(Object.isFrozen), true);
});

test('prepares only a non-overwriting INSERT manifest write with versioned canonical bindings JSON', () => {
  const write = prepareInitialBootstrapIdentityManifestWrite(manifest());
  assert.equal(write.role, 'IDENTITY_MANIFEST');
  assert.match(write.statement.text, /^INSERT INTO initial_bootstrap_identity_manifests /);
  assert.equal(write.statement.parameters.migration_run_id.value, RUN_ID);
  assert.equal(write.statement.parameters.source_snapshot_id.value, SNAPSHOT_ID);
  assert.equal(write.statement.parameters.binding_count.value, 2n);
  assert.equal(write.statement.parameters.bindings.type, 'JsonDocument');
  assert.deepEqual(JSON.parse(write.statement.parameters.bindings.value), {
    schema_version: 1,
    bindings: [
      {
        source_ordinal: 0,
        row_hint: 2,
        row_digest: 'synthetic-row-a',
        source_record_id: SOURCE_ID_1,
        transaction_id: TRANSACTION_ID,
      },
      {
        source_ordinal: 1,
        row_hint: 3,
        row_digest: 'synthetic-row-b',
        source_record_id: SOURCE_ID_2,
        transaction_id: null,
      },
    ],
  });
  assert.equal(write.estimatedParameterBytes > 0, true);
});

test('financial identity must be explicit while ambiguous/non-financial rows cannot receive invented transaction IDs', () => {
  assert.throws(
    () => buildInitialBootstrapIdentityManifest(candidate(), projection(), []),
    (error) => error instanceof InitialBootstrapIdentityManifestError
      && error.code === 'MISSING_TRANSACTION_ASSIGNMENT',
  );
  assert.throws(
    () => buildInitialBootstrapIdentityManifest(candidate(), projection(), [
      assignment(),
      { sourceRecordId: SOURCE_ID_2, transactionId: '00000000-0000-0000-0000-000000009499' },
    ]),
    (error) => error instanceof InitialBootstrapIdentityManifestError
      && error.code === 'UNEXPECTED_TRANSACTION_ASSIGNMENT',
  );
});

test('restart after durable claim recovers exactly the same source and transaction identities', async () => {
  const write = prepareInitialBootstrapIdentityManifestWrite(manifest());
  const recovered = await recoverInitialBootstrapIdentities(
    reader([readbackRow(write)]),
    RUN_ID,
    'synthetic-snapshot-digest',
    [
      { sourceOrdinal: 0, rowHint: 2, digest: 'synthetic-row-a' },
      { sourceOrdinal: 1, rowHint: 3, digest: 'synthetic-row-b' },
    ],
  );

  assert.deepEqual(recovered, {
    sourceSnapshotId: SNAPSHOT_ID,
    sourceRows: [
      { sourceRecordId: SOURCE_ID_1, rowHint: 2, digest: 'synthetic-row-a' },
      { sourceRecordId: SOURCE_ID_2, rowHint: 3, digest: 'synthetic-row-b' },
    ],
    transactionAssignments: [assignment()],
  });
});

test('resume fails closed when current observation no longer matches the claimed manifest', async () => {
  const write = prepareInitialBootstrapIdentityManifestWrite(manifest());
  await expectManifestError(
    'MANIFEST_EVIDENCE_MISMATCH',
    () => recoverInitialBootstrapIdentities(
      reader([readbackRow(write)]),
      RUN_ID,
      'synthetic-snapshot-digest',
      [
        { sourceOrdinal: 0, rowHint: 2, digest: 'synthetic-row-a' },
        { sourceOrdinal: 1, rowHint: 3, digest: 'changed-row-b' },
      ],
    ),
  );
});

test('contradictory durable bindings are rejected instead of choosing an identity', async () => {
  const write = prepareInitialBootstrapIdentityManifestWrite(manifest());
  const malformedBindings = JSON.parse(write.statement.parameters.bindings.value);
  malformedBindings.bindings[1].source_record_id = SOURCE_ID_1;

  await expectManifestError(
    'MALFORMED_MANIFEST_ROW',
    () => recoverInitialBootstrapIdentities(
      reader([readbackRow(write, { bindings: malformedBindings })]),
      RUN_ID,
      'synthetic-snapshot-digest',
      [
        { sourceOrdinal: 0, rowHint: 2, digest: 'synthetic-row-a' },
        { sourceOrdinal: 1, rowHint: 3, digest: 'synthetic-row-b' },
      ],
    ),
  );
});

test('COMMITTED or FAILED run is not reopened as a resumable initial writer', async () => {
  const write = prepareInitialBootstrapIdentityManifestWrite(manifest());
  for (const state of ['COMMITTED', 'FAILED']) {
    await expectManifestError(
      'RUN_NOT_RESUMABLE',
      () => recoverInitialBootstrapIdentities(
        reader([readbackRow(write, { run_state: state })]),
        RUN_ID,
        'synthetic-snapshot-digest',
        [
          { sourceOrdinal: 0, rowHint: 2, digest: 'synthetic-row-a' },
          { sourceOrdinal: 1, rowHint: 3, digest: 'synthetic-row-b' },
        ],
      ),
    );
  }
});
