import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YandexTimerScheduledSyncFunctionError,
  executeYandexScheduledSyncReadinessFunction,
  executeYandexTimerScheduledSyncFunction,
} from '../../dist/runtime/yandexCloudScheduledSyncFunction.js';

const TIMER_TYPE = 'yandex.cloud.events.serverless.triggers.TimerMessage';
const ENVIRONMENT = Object.freeze({
  PRIHRASH_GOOGLE_SPREADSHEET_ID: 'synthetic-sheet',
});

test('readiness entrypoint invokes only the injected read-only readiness job with environment', async () => {
  const calls = [];
  const safeResult = Object.freeze({
    googleSource: 'READY',
    ydbSchema: 'READY',
    requiredMigrationVersion: 2,
  });

  const result = await executeYandexScheduledSyncReadinessFunction(
    ENVIRONMENT,
    async (environment) => {
      calls.push(environment);
      return safeResult;
    },
  );

  assert.equal(result, safeResult);
  assert.deepEqual(calls, [ENVIRONMENT]);
});

function timerEvent(overrides = {}) {
  return {
    messages: [{
      event_metadata: {
        event_id: 'synthetic-event-id',
        event_type: TIMER_TYPE,
        created_at: '2026-09-07T17:45:00.000Z',
        cloud_id: 'synthetic-cloud',
        folder_id: 'synthetic-folder',
      },
      details: {
        trigger_id: 'synthetic-trigger',
        payload: 'ignored-synthetic-payload',
      },
      ...overrides,
    }],
  };
}

test('valid TimerMessage invokes the one-shot job exactly once and returns only its safe result', async () => {
  const calls = [];
  const safeResult = Object.freeze({
    decision: 'NO_CHANGE',
    observedSnapshotDigest: 'synthetic-digest',
    incrementalStarted: false,
  });

  const result = await executeYandexTimerScheduledSyncFunction(
    timerEvent(),
    ENVIRONMENT,
    async (environment) => {
      calls.push(environment);
      return safeResult;
    },
  );

  assert.equal(result, safeResult);
  assert.deepEqual(calls, [ENVIRONMENT]);
});

test('timer payload and provider identifiers are not used as job inputs', async () => {
  const received = [];
  await executeYandexTimerScheduledSyncFunction(
    timerEvent({
      details: {
        trigger_id: 'different-synthetic-trigger',
        payload: '{"financial":"must-be-ignored"}',
      },
    }),
    ENVIRONMENT,
    async (environment) => {
      received.push(environment);
      return Object.freeze({
        decision: 'BOOTSTRAP_REQUIRED',
        observedSnapshotDigest: 'synthetic-digest',
        incrementalStarted: false,
      });
    },
  );

  assert.deepEqual(received, [ENVIRONMENT]);
});

test('malformed or non-timer events fail closed before the job is called', async () => {
  const malformed = [
    null,
    {},
    { messages: [] },
    { messages: [{}, {}] },
    { messages: [null] },
    { messages: [{}] },
    { messages: [{ event_metadata: null }] },
    { messages: [{ event_metadata: {} }] },
    { messages: [{ event_metadata: { event_type: 'other.event.Type' } }] },
  ];

  for (const event of malformed) {
    let calls = 0;
    await assert.rejects(
      () => executeYandexTimerScheduledSyncFunction(
        event,
        ENVIRONMENT,
        async () => {
          calls += 1;
          throw new Error('JOB_MUST_NOT_RUN');
        },
      ),
      (error) => error instanceof YandexTimerScheduledSyncFunctionError
        && error.code === 'MALFORMED_TIMER_EVENT'
        && error.message === 'MALFORMED_TIMER_EVENT',
    );
    assert.equal(calls, 0);
  }
});

test('job failure propagates without wrapping provider or private payload into a new error', async () => {
  const primary = new Error('SYNTHETIC_JOB_FAILURE');

  await assert.rejects(
    () => executeYandexTimerScheduledSyncFunction(
      timerEvent(),
      ENVIRONMENT,
      async () => { throw primary; },
    ),
    (error) => error === primary,
  );
});
