import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseInitialBootstrapStagingRevisionEvidence,
} from '../../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

const RUN_ID = '00000000-0000-0000-0000-000000000901';
const OTHER_RUN_ID = '00000000-0000-0000-0000-000000000902';
const SNAPSHOT_DIGEST = 'synthetic-snapshot-digest';

function sourceId(index) {
  return `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
}

function observations(count) {
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    sourceOrdinal: index,
    rowHint: index + 2,
    digest: `synthetic-digest-${index}`,
  })));
}

function binding(observation, index) {
  return Object.freeze({
    source_ordinal: observation.sourceOrdinal,
    row_hint: observation.rowHint,
    row_digest: observation.digest,
    source_record_id: sourceId(index),
    transaction_id: null,
  });
}

function manifestRow(sourceObservations) {
  return Object.freeze({
    migration_run_id: RUN_ID,
    run_state: 'STAGING',
    run_snapshot_digest: SNAPSHOT_DIGEST,
    rows_seen: BigInt(sourceObservations.length),
    manifest_snapshot_digest: SNAPSHOT_DIGEST,
    binding_count: BigInt(sourceObservations.length),
    bindings: Object.freeze({
      schema_version: 1,
      bindings: Object.freeze(sourceObservations.map(binding)),
    }),
    snapshot_digest: SNAPSHOT_DIGEST,
    snapshot_row_count: BigInt(sourceObservations.length),
  });
}

function revisionRow(observation, index, migrationRunId = RUN_ID) {
  return Object.freeze({
    source_record_id: sourceId(index),
    revision: 1n,
    migration_run_id: migrationRunId,
    row_hint: BigInt(observation.rowHint),
    row_digest: observation.digest,
  });
}

function reader(sourceObservations, revisionResponder) {
  const calls = [];
  return Object.freeze({
    calls,
    async read(statement) {
      calls.push(statement);
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        return { rows: [manifestRow(sourceObservations)] };
      }
      return { rows: await revisionResponder(statement, calls.length - 1) };
    },
  });
}

test('staging revision diagnostic distinguishes no, partial, complete and cross-run PK evidence', async () => {
  const sourceObservations = observations(2);

  const none = reader(sourceObservations, async () => []);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(none, SNAPSHOT_DIGEST, sourceObservations),
    'NO_REVISION_EVIDENCE',
  );

  const partial = reader(sourceObservations, async () => [revisionRow(sourceObservations[0], 0)]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(partial, SNAPSHOT_DIGEST, sourceObservations),
    'PARTIAL_CURRENT_RUN_ONLY',
  );

  const complete = reader(sourceObservations, async () => sourceObservations.map((item, index) => revisionRow(item, index)));
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(complete, SNAPSHOT_DIGEST, sourceObservations),
    'COMPLETE_CURRENT_RUN_ONLY',
  );

  const collision = reader(sourceObservations, async () => [revisionRow(sourceObservations[0], 0, OTHER_RUN_ID)]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(collision, SNAPSHOT_DIGEST, sourceObservations),
    'CROSS_RUN_PK_COLLISION',
  );
});

test('staging revision diagnostic rejects duplicate transaction ids in manifest evidence', async () => {
  const sourceObservations = observations(2);
  const duplicateTransactionId = '00000000-0000-0000-0000-000000009999';
  const mismatchReader = Object.freeze({
    async read(statement) {
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        const row = manifestRow(sourceObservations);
        return {
          rows: [{
            ...row,
            bindings: {
              schema_version: 1,
              bindings: sourceObservations.map((observation, index) => ({
                ...binding(observation, index),
                transaction_id: duplicateTransactionId,
              })),
            },
          }],
        };
      }
      throw new Error('revision evidence must not be read after malformed manifest');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(mismatchReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_EVIDENCE_MISMATCH',
  );
});

test('staging revision diagnostic fails closed when manifest does not match fresh authoritative snapshot', async () => {
  const sourceObservations = observations(1);
  const mismatchReader = Object.freeze({
    async read(statement) {
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        const row = manifestRow(sourceObservations);
        return { rows: [{ ...row, run_snapshot_digest: 'different' }] };
      }
      throw new Error('revision evidence must not be read after manifest mismatch');
    },
  });
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(mismatchReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_EVIDENCE_MISMATCH',
  );
});

test('staging revision diagnostic fails closed on extra or mismatched same-run evidence', async () => {
  const sourceObservations = observations(1);
  const extraObservation = Object.freeze({ sourceOrdinal: 9, rowHint: 99, digest: 'synthetic-extra' });
  const extraReader = reader(sourceObservations, async () => [revisionRow(extraObservation, 9)]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(extraReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_EVIDENCE_MISMATCH',
  );

  const mismatchReader = reader(sourceObservations, async () => [{
    ...revisionRow(sourceObservations[0], 0),
    row_digest: 'different',
  }]);
  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(mismatchReader, SNAPSHOT_DIGEST, sourceObservations),
    'REVISION_EVIDENCE_MISMATCH',
  );
});

test('staging revision diagnostic bounds cross-run lookup batches to 50 source IDs', async () => {
  const sourceObservations = observations(51);
  const evidenceReader = reader(sourceObservations, async (statement) => {
    if (statement.parameters.migration_run_id !== undefined) {
      return sourceObservations.slice(0, 50).map((item, index) => revisionRow(item, index));
    }
    assert.equal(Object.keys(statement.parameters).filter((key) => key.startsWith('source_record_id_')).length, 1);
    return [];
  });

  assert.equal(
    await diagnoseInitialBootstrapStagingRevisionEvidence(evidenceReader, SNAPSHOT_DIGEST, sourceObservations),
    'PARTIAL_CURRENT_RUN_ONLY',
  );
  assert.equal(evidenceReader.calls.length, 3);
  assert.equal(evidenceReader.calls.every((statement) => statement.kind === 'READ'), true);
});
