import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ScheduledSyncReadinessError,
  runScheduledSyncReadinessProbe,
} from '../../dist/runtime/scheduledSyncReadinessProbe.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-readiness.mjs');
const PRIVATE_LOOKING = 'private-ydb-endpoint private-database-path private-token';

function sourceThatSucceeds() {
  return {
    async readFullSnapshotObservation() {
      return Object.freeze({ snapshotDigest: 'synthetic-digest', snapshot: Object.freeze({}) });
    },
  };
}

function adapterForTableDiagnostic(tableProbeFails) {
  const capture = { statements: [], transactions: 0 };
  let readIndex = 0;
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      capture.statements.push(statement);
      readIndex += 1;
      if (readIndex === 2) throw new Error(`${PRIVATE_LOOKING} synthetic-column-shape-failure`);
      if (readIndex === 3 && tableProbeFails) {
        throw new Error(`${PRIVATE_LOOKING} synthetic-table-resolve-failure`);
      }
      return Object.freeze({ rows: Object.freeze([]) });
    },
    async serializableReadWrite() {
      capture.transactions += 1;
      throw new Error('unexpected transaction');
    },
  });
  return { adapter, capture };
}

test('migration schema failure is split from table resolve/read failure without writes', async () => {
  const tableFailure = adapterForTableDiagnostic(true);
  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), tableFailure.adapter),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'YDB_MIGRATION_TABLE_READ_FAILED'
      && error.message === 'YDB_MIGRATION_TABLE_READ_FAILED'
      && !JSON.stringify(error).includes(PRIVATE_LOOKING)
      && !Object.hasOwn(error, 'cause'),
  );
  assert.deepEqual(
    tableFailure.capture.statements.map((statement) => statement.text),
    [
      'SELECT 1 AS readiness_probe',
      'SELECT version, checksum, applied_at FROM schema_migrations LIMIT 0',
      'SELECT 1 AS readiness_table_probe FROM schema_migrations LIMIT 0',
    ],
  );
  assert.equal(tableFailure.capture.transactions, 0);

  const columnFailure = adapterForTableDiagnostic(false);
  await assert.rejects(
    () => runScheduledSyncReadinessProbe(sourceThatSucceeds(), columnFailure.adapter),
    (error) => error instanceof ScheduledSyncReadinessError
      && error.code === 'YDB_MIGRATION_SCHEMA_READ_FAILED',
  );
  assert.equal(columnFailure.capture.transactions, 0);
});

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-yc-table-diagnostic-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

test('safe invoker maps migration table failure without exposing captured provider detail', async () => {
  const fake = await fakeYc(`
process.stderr.write(${JSON.stringify(`YDB_MIGRATION_TABLE_READ_FAILED\n${PRIVATE_LOOKING}`)});
process.exit(17);
`);

  try {
    let result;
    try {
      await execFileAsync(process.execPath, [INVOKER], {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PRIHRASH_YC_BIN: fake.path,
          PRIHRASH_YANDEX_READINESS_FUNCTION_ID: 'synthetic-function-id',
          YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
        },
        encoding: 'utf8',
      });
      assert.fail('expected invoker failure');
    } catch (error) {
      result = error;
    }

    assert.equal(result.code, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'FAIL',
      code: 'READINESS_YDB_MIGRATION_TABLE_READ_FAILED',
    });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
});
