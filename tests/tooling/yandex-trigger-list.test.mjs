import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { classifyTriggerList } from '../../scripts/classify-yandex-trigger-list.mjs';

const target = 'function-target-id';

test('trigger list classifies exact target Function reference without exposing trigger metadata', () => {
  const present = classifyTriggerList({
    curlExitCode: 0,
    httpStatus: '200',
    responseText: JSON.stringify({
      triggers: [{
        id: 'private-trigger-id',
        name: 'private-trigger-name',
        rule: { timer: { invokeFunction: { functionId: target } } },
      }],
    }),
    targetFunctionId: target,
  });
  assert.deepEqual(present, {
    status: 'PASS',
    code: 'TRIGGER_LIST_CLASSIFIED',
    targetFunction: 'PRESENT',
  });

  const absent = classifyTriggerList({
    curlExitCode: 0,
    httpStatus: '200',
    responseText: JSON.stringify({
      triggers: [{ rule: { timer: { invokeFunction: { functionId: 'different-function' } } } }],
    }),
    targetFunctionId: target,
  });
  assert.equal(absent.targetFunction, 'ABSENT');
});

test('trigger list transport and HTTP failures remain distinct bounded enums', () => {
  assert.equal(classifyTriggerList({
    curlExitCode: 28, httpStatus: '000', responseText: '', targetFunctionId: target,
  }).code, 'TRIGGER_LIST_TIMEOUT');
  assert.equal(classifyTriggerList({
    curlExitCode: 63, httpStatus: '000', responseText: '', targetFunctionId: target,
  }).code, 'TRIGGER_LIST_RESPONSE_TOO_LARGE');
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '401', responseText: '{}', targetFunctionId: target,
  }).code, 'TRIGGER_LIST_AUTH_REQUIRED');
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '403', responseText: '{}', targetFunctionId: target,
  }).code, 'TRIGGER_LIST_PERMISSION_DENIED');
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '404', responseText: '{}', targetFunctionId: target,
  }).code, 'TRIGGER_LIST_NOT_FOUND');
});

test('malformed and paginated trigger list responses fail closed', () => {
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '200', responseText: '{', targetFunctionId: target,
  }).code, 'TRIGGER_LIST_JSON_INVALID');
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '200', responseText: JSON.stringify({ triggers: {}, nextPageToken: '' }), targetFunctionId: target,
  }).code, 'TRIGGER_LIST_RESPONSE_INVALID');
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '200', responseText: JSON.stringify({ triggers: [], nextPageToken: 'next' }), targetFunctionId: target,
  }).code, 'TRIGGER_LIST_PAGINATION_INCOMPLETE');
  assert.equal(classifyTriggerList({
    curlExitCode: 0, httpStatus: '200', responseText: JSON.stringify({ triggers: [null] }), targetFunctionId: target,
  }).code, 'TRIGGER_LIST_ENTRY_INVALID');
});

test('classifier CLI publishes only enum-safe evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prih-trigger-list-'));
  const responsePath = join(dir, 'response.json');
  writeFileSync(responsePath, JSON.stringify({
    triggers: [{ id: 'secret-trigger-id', rule: { timer: { invokeFunction: { functionId: target } } } }],
  }));
  const stdout = execFileSync(process.execPath, [
    'scripts/classify-yandex-trigger-list.mjs',
    '0',
    '200',
    responsePath,
    target,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(stdout), {
    status: 'PASS',
    code: 'TRIGGER_LIST_CLASSIFIED',
    targetFunction: 'PRESENT',
  });
  assert.doesNotMatch(stdout, /secret-trigger-id|function-target-id/);
});
