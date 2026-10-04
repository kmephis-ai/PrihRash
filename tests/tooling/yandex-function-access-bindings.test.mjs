import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { classifyFunctionAccessBindings } from '../../scripts/classify-yandex-function-access-bindings.mjs';

const wif = 'synthetic-wif-service-account';
const runtime = 'synthetic-runtime-service-account';

function binding(roleId, subjectId, subjectType = 'serviceAccount') {
  return { roleId, subject: { id: subjectId, type: subjectType } };
}

function classify(response, overrides = {}) {
  return classifyFunctionAccessBindings({
    curlExitCode: 0,
    httpStatus: '200',
    responseText: JSON.stringify(response),
    wifServiceAccountId: wif,
    runtimeServiceAccountId: runtime,
    ...overrides,
  });
}

test('exact REST Function bindings distinguish the required invokers and public subjects', () => {
  assert.deepEqual(classify({ accessBindings: [
    binding('functions.functionInvoker', wif),
    binding('functions.functionInvoker', runtime),
    binding('functions.editor', wif),
  ] }), {
    status: 'PASS',
    code: 'FUNCTION_BINDINGS_CLASSIFIED',
    publicInvoker: 'ABSENT',
    runtimeInvoker: 'PRESENT',
    wifEditor: 'PRESENT',
    wifInvoker: 'PRESENT',
  });
  assert.equal(classify({ accessBindings: [binding('functions.functionInvoker', 'allUsers', 'system')] }).publicInvoker, 'PRESENT');
  assert.equal(classify({}).wifInvoker, 'ABSENT');
  assert.equal(classify({ accessBindings: [] }).runtimeInvoker, 'ABSENT');
});

test('REST transport and HTTP failures retain distinct bounded enums', () => {
  const classifyStatus = (status) => classifyFunctionAccessBindings({
    curlExitCode: 0,
    httpStatus: String(status),
    responseText: 'private response never echoed',
    wifServiceAccountId: wif,
    runtimeServiceAccountId: runtime,
  }).code;
  assert.equal(classifyStatus(401), 'FUNCTION_BINDINGS_AUTH_REQUIRED');
  assert.equal(classifyStatus(403), 'FUNCTION_BINDINGS_PERMISSION_DENIED');
  assert.equal(classifyStatus(404), 'FUNCTION_BINDINGS_FUNCTION_NOT_FOUND');
  assert.equal(classifyStatus(204), 'FUNCTION_BINDINGS_HTTP_STATUS_UNEXPECTED');
  assert.equal(classifyStatus(500), 'FUNCTION_BINDINGS_HTTP_STATUS_UNEXPECTED');
  assert.equal(classifyFunctionAccessBindings({
    curlExitCode: 28, httpStatus: '000', responseText: '',
    wifServiceAccountId: wif, runtimeServiceAccountId: runtime,
  }).code, 'FUNCTION_BINDINGS_TIMEOUT');
  assert.equal(classifyFunctionAccessBindings({
    curlExitCode: 7, httpStatus: '000', responseText: '',
    wifServiceAccountId: wif, runtimeServiceAccountId: runtime,
  }).code, 'FUNCTION_BINDINGS_TRANSPORT_FAILED');
  assert.equal(classifyFunctionAccessBindings({
    curlExitCode: 63, httpStatus: '000', responseText: '',
    wifServiceAccountId: wif, runtimeServiceAccountId: runtime,
  }).code, 'FUNCTION_BINDINGS_RESPONSE_TOO_LARGE');
});

test('malformed, ambiguous and paginated REST responses remain fail-closed', () => {
  assert.equal(classifyFunctionAccessBindings({
    curlExitCode: 0, httpStatus: '200', responseText: '{',
    wifServiceAccountId: wif, runtimeServiceAccountId: runtime,
  }).code, 'FUNCTION_BINDINGS_JSON_INVALID');
  assert.equal(classify(null).code, 'FUNCTION_BINDINGS_RESPONSE_INVALID');
  assert.equal(classify({ accessBindings: null }).code, 'FUNCTION_BINDINGS_RESPONSE_INVALID');
  assert.equal(classify({ accessBindings: [], nextPageToken: 42 }).code, 'FUNCTION_BINDINGS_RESPONSE_INVALID');
  assert.equal(classify({ accessBindings: [], nextPageToken: 'next-page' }).code, 'FUNCTION_BINDINGS_PAGINATION_INCOMPLETE');
  assert.equal(classify({ accessBindings: Array.from({ length: 1_000 }, (_, index) => binding('functions.viewer', `sa-${index}`)) })
    .code, 'FUNCTION_BINDINGS_PAGINATION_INCOMPLETE');
  assert.equal(classify({ accessBindings: [binding('functions.functionInvoker', wif), binding('functions.functionInvoker', wif)] })
    .code, 'FUNCTION_BINDINGS_AMBIGUOUS');
  assert.equal(classify({ accessBindings: [{ roleId: 'functions.functionInvoker', subject: { id: wif } }] })
    .code, 'FUNCTION_BINDINGS_ENTRY_INVALID');
  assert.equal(classify({ extraResponseField: true, accessBindings: [] }).code, 'FUNCTION_BINDINGS_RESPONSE_INVALID');
});

test('classifier CLI publishes only role-presence enums, not Function or subject IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'function-bindings-classifier-'));
  const responsePath = join(directory, 'response.json');
  writeFileSync(responsePath, JSON.stringify({ accessBindings: [binding('functions.functionInvoker', wif)] }), 'utf8');
  try {
    const child = spawnSync(process.execPath, [
      'scripts/classify-yandex-function-access-bindings.mjs', '0', '200', responsePath, wif, runtime,
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
    assert.deepEqual(JSON.parse(child.stdout), {
      status: 'PASS',
      code: 'FUNCTION_BINDINGS_CLASSIFIED',
      publicInvoker: 'ABSENT',
      runtimeInvoker: 'ABSENT',
      wifEditor: 'ABSENT',
      wifInvoker: 'PRESENT',
    });
    assert.doesNotMatch(child.stdout, /synthetic-/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
