import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { recoverInitialBootstrapIdentities } from '../../dist/migration/initialBootstrapIdentityManifest.js';

const RUN_ID = '00000000-0000-0000-0000-000000009501';
const SNAPSHOT_ID = '00000000-0000-0000-0000-000000009502';
const SOURCE_ID = '00000000-0000-0000-0000-000000009503';
const SNAPSHOT_DIGEST = ' synthetic-snapshot-digest ';
const ROW_DIGEST = ' synthetic-row-digest ';

test('resume preserves exact nonblank digest evidence instead of imposing trim normalization', async () => {
  const adapter = new YdbAdapter({
    async executeRead() {
      return {
        rows: [{
          source_snapshot_id: SNAPSHOT_ID,
          source_snapshot_digest: SNAPSHOT_DIGEST,
          binding_count: 1n,
          bindings: {
            schema_version: 1,
            bindings: [{
              source_ordinal: 0,
              row_hint: 2n,
              row_digest: ROW_DIGEST,
              source_record_id: SOURCE_ID,
              transaction_id: null,
            }],
          },
          run_state: 'STAGING',
          run_snapshot_digest: SNAPSHOT_DIGEST,
          snapshot_digest: SNAPSHOT_DIGEST,
          snapshot_row_count: 1n,
        }],
      };
    },
    async serializableReadWrite() { throw new Error('write not expected'); },
  });

  const recovered = await recoverInitialBootstrapIdentities(
    adapter,
    RUN_ID,
    SNAPSHOT_DIGEST,
    [{ sourceOrdinal: 0, rowHint: 2, digest: ROW_DIGEST }],
  );

  assert.deepEqual(recovered, {
    sourceSnapshotId: SNAPSHOT_ID,
    sourceRows: [{ sourceRecordId: SOURCE_ID, rowHint: 2, digest: ROW_DIGEST }],
    transactionAssignments: [],
  });
});
