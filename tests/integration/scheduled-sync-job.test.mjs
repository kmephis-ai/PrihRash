import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULED_SYNC_JOB_ENV,
  ScheduledSyncJobError,
  executeScheduledSyncJob,
  readScheduledSyncJobConfig,
} from '../../dist/runtime/scheduledSyncJob.js';

const MULTILINE_SECRET = ['synthetic-line-a', 'synthetic-line-b', ''].join('\n');
const CONFIG = Object.freeze({
  spreadsheetId: 'synthetic-sheet-id',
  googleServiceAccountEmail: 'synthetic-reader@example.invalid',
  googleServiceAccountPrivateKey: MULTILINE_SECRET,
  ydbConnectionString: 'grpcs://synthetic.invalid:2135/?database=/synthetic',
});

function fakeTransport() {
  return Object.freeze({
    async executeRead() {
      throw new Error('UNEXPECTED_YDB_READ');
    },
    async serializableReadWrite() {
      throw new Error('UNEXPECTED_YDB_TRANSACTION');
    },
  });
}

function makeRuntime(options = {}) {
  const calls = options.calls ?? [];
  const digest = Object.freeze({
    digestCanonicalSnapshot(value) { return `snapshot:${value}`; },
    digestCanonicalRow(value) { return `row:${value}`; },
  });
  const source = Object.freeze({
    async readFullSnapshotObservation() {
      throw new Error('UNEXPECTED_SOURCE_READ');
    },
  });
  const applicationResult = Object.freeze({
    decision: 'NO_CHANGE',
    observedSnapshotDigest: 'synthetic-digest',
    incrementalStarted: false,
  });

  return Object.freeze({
    createDigest() {
      calls.push('digest');
      return digest;
    },
    createSource(config, receivedDigest) {
      calls.push('source');
      assert.deepEqual(config, CONFIG);
      assert.equal(receivedDigest, digest);
      return source;
    },
    async createYdbClient(config) {
      calls.push('ydb');
      assert.deepEqual(config, CONFIG);
      return Object.freeze({
        transport: fakeTransport(),
        async close() {
          calls.push('close');
          if (options.closeError) throw options.closeError;
        },
      });
    },
    observationClock: Object.freeze({
      now() {
        return '2026-09-07T17:40:00.000Z';
      },
    }),
    async runApplication(dependencies) {
      calls.push('application');
      assert.equal(dependencies.source, source);
      assert.equal(dependencies.rowDigest, digest);
      assert.equal(dependencies.observationClock.now(), '2026-09-07T17:40:00.000Z');
      if (options.applicationError) throw options.applicationError;
      return applicationResult;
    },
  });
}

test('environment parser requires exact runtime values and preserves multiline secret bytes', () => {
  const env = {
    [SCHEDULED_SYNC_JOB_ENV.spreadsheetId]: CONFIG.spreadsheetId,
    [SCHEDULED_SYNC_JOB_ENV.googleServiceAccountEmail]: CONFIG.googleServiceAccountEmail,
    [SCHEDULED_SYNC_JOB_ENV.googleServiceAccountPrivateKey]: CONFIG.googleServiceAccountPrivateKey,
    [SCHEDULED_SYNC_JOB_ENV.ydbConnectionString]: CONFIG.ydbConnectionString,
  };

  const parsed = readScheduledSyncJobConfig(env);
  assert.deepEqual(parsed, CONFIG);
  assert.equal(parsed.googleServiceAccountPrivateKey.endsWith('\n'), true);
  assert.equal(Object.isFrozen(parsed), true);
});

test('malformed config fails before any provider/runtime creation', async () => {
  const cases = [
    ['spreadsheetId', '', 'INVALID_SPREADSHEET_ID'],
    ['googleServiceAccountEmail', ' padded@example.invalid ', 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'],
    ['googleServiceAccountPrivateKey', '   ', 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'],
    ['ydbConnectionString', ' grpcs://synthetic.invalid ', 'INVALID_YDB_CONNECTION_STRING'],
  ];

  for (const [field, value, code] of cases) {
    const calls = [];
    const invalid = { ...CONFIG, [field]: value };
    await assert.rejects(
      () => executeScheduledSyncJob(invalid, makeRuntime({ calls })),
      (error) => error instanceof ScheduledSyncJobError
        && error.code === code
        && error.message === code,
    );
    assert.deepEqual(calls, []);
  }
});

test('successful one-shot job composes providers in order and closes YDB client', async () => {
  const calls = [];
  const result = await executeScheduledSyncJob(CONFIG, makeRuntime({ calls }));

  assert.deepEqual(calls, ['digest', 'source', 'ydb', 'application', 'close']);
  assert.deepEqual(result, {
    decision: 'NO_CHANGE',
    observedSnapshotDigest: 'synthetic-digest',
    incrementalStarted: false,
  });
});

test('application failure still closes YDB client and preserves the primary error', async () => {
  const calls = [];
  const applicationError = new Error('SYNTHETIC_APPLICATION_FAILURE');
  const closeError = new Error('SYNTHETIC_CLOSE_FAILURE');

  await assert.rejects(
    () => executeScheduledSyncJob(CONFIG, makeRuntime({ calls, applicationError, closeError })),
    (error) => error === applicationError,
  );
  assert.deepEqual(calls, ['digest', 'source', 'ydb', 'application', 'close']);
});

test('close failure after successful application returns a safe close error', async () => {
  const calls = [];
  const closeError = new Error('synthetic close details');

  await assert.rejects(
    () => executeScheduledSyncJob(CONFIG, makeRuntime({ calls, closeError })),
    (error) => error instanceof ScheduledSyncJobError
      && error.code === 'YDB_CLIENT_CLOSE_FAILED'
      && error.message === 'YDB_CLIENT_CLOSE_FAILED',
  );
  assert.deepEqual(calls, ['digest', 'source', 'ydb', 'application', 'close']);
});
