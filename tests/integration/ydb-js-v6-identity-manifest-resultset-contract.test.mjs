import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from '@bufbuild/protobuf';
import { StatusIds_StatusCode } from '@ydbjs/api/operation';
import { ResultSetSchema } from '@ydbjs/api/value';
import { query } from '@ydbjs/query';
import * as primitive from '@ydbjs/value/primitive';
import { Optional } from '@ydbjs/value/optional';

import {
  createYdbJsV6DataTransport,
  createYdbJsV6ParameterMapper,
} from '../../dist/integration/ydb/ydbJsV6DataTransport.js';
import {
  initialBootstrapIdentityManifestReadStatement,
  parseInitialBootstrapIdentityManifestRows,
} from '../../dist/migration/initialBootstrapIdentityManifest.js';

const MIGRATION_RUN_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_RECORD_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_DIGEST = 'fixture-snapshot-digest';

const EXPECTED_COLUMNS = Object.freeze([
  'source_snapshot_id',
  'source_snapshot_digest',
  'binding_count',
  'bindings',
  'run_state',
  'run_snapshot_digest',
  'snapshot_digest',
  'snapshot_row_count',
]);

function resultSetFixture() {
  const values = [
    new primitive.Uuid(SNAPSHOT_ID),
    new primitive.Utf8(SNAPSHOT_DIGEST),
    new primitive.Uint64(1n),
    new primitive.JsonDocument(JSON.stringify({
      schema_version: 1,
      bindings: [{
        source_ordinal: 0,
        row_hint: 2,
        row_digest: 'fixture-row-digest',
        source_record_id: SOURCE_RECORD_ID,
        transaction_id: null,
      }],
    })),
    new primitive.Utf8('STAGING'),
    new primitive.Utf8(SNAPSHOT_DIGEST),
    new primitive.Utf8(SNAPSHOT_DIGEST),
    new primitive.Uint64(1n),
  ];

  return create(ResultSetSchema, {
    columns: EXPECTED_COLUMNS.map((name, index) => ({
      name,
      type: values[index].type.encode(),
    })),
    rows: [{ items: values.map((value) => value.encode()) }],
  });
}

function attachStream(signal) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { status: StatusIds_StatusCode.SUCCESS, issues: [] };
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      }
    },
  };
}

function fixtureDriver(resultSet) {
  return {
    identity: Object.freeze({ endpoint: 'fixture.invalid', database: '/fixture' }),
    async ready() {},
    createClient() {
      return {
        async createSession() {
          return {
            status: StatusIds_StatusCode.SUCCESS,
            issues: [],
            sessionId: 'fixture-session',
            nodeId: 1n,
          };
        },
        attachSession(_request, options = {}) {
          return attachStream(options.signal ?? new AbortController().signal);
        },
        executeQuery() {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                status: StatusIds_StatusCode.SUCCESS,
                issues: [],
                resultSetIndex: 0n,
                resultSet,
              };
            },
          };
        },
        async deleteSession() {
          return { status: StatusIds_StatusCode.SUCCESS, issues: [] };
        },
      };
    },
  };
}

test('pinned YDB SDK ResultSet preserves every identity-manifest alias through the real decoder seam', async () => {
  const statement = initialBootstrapIdentityManifestReadStatement(MIGRATION_RUN_ID);
  for (const column of EXPECTED_COLUMNS) {
    assert.match(statement.text, new RegExp(`\\bAS ${column}\\b|\\b${column} AS ${column}\\b`));
  }

  const rawSql = query(fixtureDriver(resultSetFixture()), { poolOptions: { maxSize: 1 } });
  const mapper = createYdbJsV6ParameterMapper(Object.freeze({ ...primitive, Optional }));
  const transport = createYdbJsV6DataTransport(rawSql, mapper);

  try {
    const result = await transport.executeRead(statement);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(Object.keys(result.rows[0]), EXPECTED_COLUMNS);

    const readback = parseInitialBootstrapIdentityManifestRows(MIGRATION_RUN_ID, result.rows);
    assert.equal(readback.manifest.migrationRunId, MIGRATION_RUN_ID);
    assert.equal(readback.manifest.sourceSnapshotId, SNAPSHOT_ID);
    assert.equal(readback.manifest.sourceSnapshotDigest, SNAPSHOT_DIGEST);
    assert.equal(readback.manifest.bindings.length, 1);
    assert.equal(readback.manifest.bindings[0].sourceRecordId, SOURCE_RECORD_ID);
    assert.equal(readback.manifest.bindings[0].transactionId, null);
    assert.equal(readback.runState, 'STAGING');
    assert.equal(readback.runSnapshotDigest, SNAPSHOT_DIGEST);
    assert.equal(readback.snapshotDigest, SNAPSHOT_DIGEST);
    assert.equal(readback.snapshotRowCount, 1);
  } finally {
    await rawSql[Symbol.asyncDispose]();
  }
});
