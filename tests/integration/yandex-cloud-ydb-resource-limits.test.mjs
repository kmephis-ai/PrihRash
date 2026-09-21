import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YANDEX_YDB_DATABASES_API,
  readYdbResourceLimitsWithRuntimeServiceAccount,
} from '../../dist/runtime/yandexCloudYdbResourceLimits.js';

const ENVIRONMENT = Object.freeze({ PRIHRASH_YC_FOLDER_ID: 'synthetic-folder-id' });
const CONTEXT = Object.freeze({ token: Object.freeze({ access_token: 'synthetic-runtime-iam-token' }) });
const PRIVATE_LOOKING = 'private-db-id private-endpoint private-provider-detail';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function safeUnknown(discovery) {
  return {
    status: 'PASS',
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED',
    databaseDiscovery: discovery,
    mode: 'UNKNOWN',
    enableThrottlingRcuLimit: null,
    throttlingRcuLimit: null,
    provisionedRcuLimit: null,
  };
}

test('runtime-SA resource limits probe performs one bounded YDB Database.List GET and exposes only safe serverless limits', async () => {
  const calls = [];
  const result = await readYdbResourceLimitsWithRuntimeServiceAccount(
    ENVIRONMENT,
    CONTEXT,
    async (input, init) => {
      calls.push([String(input), init]);
      return response({
        databases: [{
          id: PRIVATE_LOOKING,
          endpoint: PRIVATE_LOOKING,
          name: PRIVATE_LOOKING,
          serverlessDatabase: {
            enableThrottlingRcuLimit: true,
            throttlingRcuLimit: '42',
            provisionedRcuLimit: '7',
          },
        }],
        nextPageToken: '',
      });
    },
  );

  assert.deepEqual(result, {
    status: 'PASS',
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED',
    databaseDiscovery: 'SINGLE',
    mode: 'SERVERLESS',
    enableThrottlingRcuLimit: true,
    throttlingRcuLimit: 42,
    provisionedRcuLimit: 7,
  });
  assert.equal(calls.length, 1);
  const [urlString, init] = calls[0];
  const url = new URL(urlString);
  assert.equal(`${url.origin}${url.pathname}`, YANDEX_YDB_DATABASES_API);
  assert.equal(url.searchParams.get('folderId'), ENVIRONMENT.PRIHRASH_YC_FOLDER_ID);
  assert.equal(url.searchParams.get('pageSize'), '2');
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Authorization, `Bearer ${CONTEXT.token.access_token}`);
  assert.equal(JSON.stringify(result).includes(PRIVATE_LOOKING), false);
});

test('runtime-SA resource limits probe classifies none, ambiguous, dedicated and unknown without provider identifiers', async () => {
  const cases = [
    [{ databases: [], nextPageToken: '' }, safeUnknown('NONE')],
    [{ databases: [{ id: PRIVATE_LOOKING }, { id: `${PRIVATE_LOOKING}-2` }], nextPageToken: '' }, safeUnknown('AMBIGUOUS')],
    [{ databases: [{ id: PRIVATE_LOOKING }], nextPageToken: 'private-page-token' }, safeUnknown('AMBIGUOUS')],
    [{ databases: [{ id: PRIVATE_LOOKING, dedicatedDatabase: { resourcePresetId: PRIVATE_LOOKING } }], nextPageToken: '' }, {
      ...safeUnknown('SINGLE'), mode: 'DEDICATED',
    }],
    [{ databases: [{ id: PRIVATE_LOOKING, zonalDatabase: { zoneId: PRIVATE_LOOKING } }], nextPageToken: '' }, safeUnknown('SINGLE')],
  ];

  for (const [body, expected] of cases) {
    const result = await readYdbResourceLimitsWithRuntimeServiceAccount(
      ENVIRONMENT,
      CONTEXT,
      async () => response(body),
    );
    assert.deepEqual(result, expected);
    assert.equal(JSON.stringify(result).includes(PRIVATE_LOOKING), false);
  }
});

test('runtime-SA resource limits probe fails closed for malformed limits, context, environment and provider responses', async () => {
  const malformedBodies = [
    null,
    {},
    { databases: 'private' },
    { databases: [], nextPageToken: 7 },
    { databases: [{ serverlessDatabase: { enableThrottlingRcuLimit: true, throttlingRcuLimit: '-1', provisionedRcuLimit: '7' } }] },
    { databases: [{ serverlessDatabase: { enableThrottlingRcuLimit: true, throttlingRcuLimit: '9007199254740992', provisionedRcuLimit: '7' } }] },
    { databases: [{ serverlessDatabase: { enableThrottlingRcuLimit: 'true', throttlingRcuLimit: '1', provisionedRcuLimit: '1' } }] },
    { databases: [{ serverlessDatabase: {}, dedicatedDatabase: {} }] },
  ];

  for (const body of malformedBodies) {
    assert.deepEqual(
      await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => response(body)),
      safeUnknown('READ_FAILED'),
    );
  }

  let calls = 0;
  const mustNotRun = async () => { calls += 1; throw new Error(PRIVATE_LOOKING); };
  for (const [environment, context] of [
    [{}, CONTEXT],
    [{ PRIHRASH_YC_FOLDER_ID: ' synthetic ' }, CONTEXT],
    [ENVIRONMENT, {}],
    [ENVIRONMENT, { token: {} }],
    [ENVIRONMENT, { token: { access_token: ' synthetic ' } }],
  ]) {
    assert.deepEqual(
      await readYdbResourceLimitsWithRuntimeServiceAccount(environment, context, mustNotRun),
      safeUnknown('READ_FAILED'),
    );
  }
  assert.equal(calls, 0);

  assert.deepEqual(
    await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => { throw new Error(PRIVATE_LOOKING); }),
    safeUnknown('READ_FAILED'),
  );
  assert.deepEqual(
    await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => response({ detail: PRIVATE_LOOKING }, 403)),
    safeUnknown('READ_FAILED'),
  );
  assert.deepEqual(
    await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => new Response(PRIVATE_LOOKING, { status: 200 })),
    safeUnknown('READ_FAILED'),
  );
});
