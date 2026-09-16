import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseInitialBootstrapStagingRevisionEvidence,
} from '../../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

const RUN_ID = '00000000-0000-0000-0000-000000000951';
const SNAPSHOT_DIGEST = 'synthetic-sequence-snapshot';

function sourceId(index) {
  return `00000000-0000-0000-0000-${String(index + 951).padStart(12, '0')}`;
}

function observation(sourceOrdinal, rowHint, digest) {
  return Object.freeze({ sourceOrdinal, rowHint, digest });
}

function manifestRow(durable) {
  return Object.freeze({
    migration_run_id: RUN_ID,
    run_state: 'STAGING',
    run_snapshot_digest: SNAPSHOT_DIGEST,
    rows_seen: BigInt(durable.length),
    manifest_snapshot_digest: SNAPSHOT_DIGEST,
    binding_count: BigInt(durable.length),
    bindings: Object.freeze({
      schema_version: 1,
      bindings: Object.freeze(durable.map((item, index) => Object.freeze({
        source_ordinal: item.sourceOrdinal,
        row_hint: item.rowHint,
        row_digest: item.digest,
        source_record_id: sourceId(index),
        transaction_id: null,
      }))),
    }),
    snapshot_digest: SNAPSHOT_DIGEST,
    snapshot_row_count: BigInt(durable.length),
  });
}

function reader(durable) {
  const calls = [];
  return Object.freeze({
    calls,
    async read(statement) {
      calls.push(statement);
      if (statement.text.includes("WHERE r.state = 'STAGING'")) {
        return { rows: [manifestRow(durable)] };
      }
      throw new Error('revision evidence must not be read after authoritative sequence classification');
    },
  });
}

const durable = Object.freeze([
  observation(0, 2, 'A'),
  observation(1, 3, 'B'),
  observation(2, 4, 'C'),
]);

async function classify(current, durableRows = durable) {
  const evidenceReader = reader(durableRows);
  const diagnostic = await diagnoseInitialBootstrapStagingRevisionEvidence(
    evidenceReader,
    'fresh-authoritative-snapshot-digest',
    current,
  );
  assert.equal(evidenceReader.calls.length, 1);
  assert.equal(evidenceReader.calls[0].kind, 'READ');
  return diagnostic;
}

test('staging revision diagnostic proves deterministic insertion-only source drift', async () => {
  const current = Object.freeze([
    observation(0, 2, 'A'),
    observation(1, 3, 'X'),
    observation(2, 4, 'B'),
    observation(3, 5, 'C'),
  ]);

  assert.equal(
    await classify(current),
    'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
  );
});

test('staging revision diagnostic fails closed for revision, deletion and reorder mixed with growth', async () => {
  const revision = Object.freeze([
    observation(0, 2, 'A'),
    observation(1, 3, 'B-CHANGED'),
    observation(2, 4, 'C'),
    observation(3, 5, 'X'),
  ]);
  const deletion = Object.freeze([
    observation(0, 2, 'A'),
    observation(1, 3, 'C'),
    observation(2, 4, 'X'),
    observation(3, 5, 'Y'),
  ]);
  const reorder = Object.freeze([
    observation(0, 2, 'B'),
    observation(1, 3, 'A'),
    observation(2, 4, 'C'),
    observation(3, 5, 'X'),
  ]);

  for (const current of [revision, deletion, reorder]) {
    assert.equal(
      await classify(current),
      'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
    );
  }
});

test('staging revision diagnostic fails closed when insertion lands inside duplicate digest evidence', async () => {
  const duplicateDurable = Object.freeze([
    observation(0, 2, 'A'),
    observation(1, 3, 'D'),
    observation(2, 4, 'D'),
    observation(3, 5, 'B'),
  ]);
  const duplicateCurrent = Object.freeze([
    observation(0, 2, 'A'),
    observation(1, 3, 'D'),
    observation(2, 4, 'D'),
    observation(3, 5, 'D'),
    observation(4, 6, 'B'),
  ]);

  assert.equal(
    await classify(duplicateCurrent, duplicateDurable),
    'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  );
});
