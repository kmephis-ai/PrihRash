import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YANDEX_YDB_DATABASES_API,
  parseYdbDatabaseIdFromConnectionString,
  readYdbResourceLimitsWithRuntimeServiceAccount,
} from '../../dist/runtime/yandexCloudYdbResourceLimits.js';

const FOLDER_ID = 'syntheticfolderid';
const DATABASE_ID = 'syntheticdatabaseid';
const CONNECTION_STRING = `grpcs://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/${DATABASE_ID}`;
const ENVIRONMENT = Object.freeze({
  PRIHRASH_YC_FOLDER_ID: FOLDER_ID,
  PRIHRASH_YDB_CONNECTION_STRING: CONNECTION_STRING,
});
const CONTEXT = Object.freeze({ token: Object.freeze({ access_token: 'synthetic-runtime-iam-token' }) });
const PRIVATE_LOOKING = 'private-db-id private-endpoint private-provider-detail';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function safeUnknown(discovery = 'READ_FAILED', failureStage = discovery === 'READ_FAILED' ? 'TARGET_CONFIG_INVALID' : 'NONE') {
  return {
    status: 'PASS',
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED',
    databaseDiscovery: discovery,
    failureStage,
    mode: 'UNKNOWN',
    enableThrottlingRcuLimit: null,
    throttlingRcuLimit: null,
    provisionedRcuLimit: null,
  };
}

function database(overrides = {}) {
  return {
    id: DATABASE_ID,
    folderId: FOLDER_ID,
    ...overrides,
  };
}

test('connection parser derives exact database id only from canonical managed-YDB path in the expected folder', () => {
  assert.equal(parseYdbDatabaseIdFromConnectionString(CONNECTION_STRING, FOLDER_ID), DATABASE_ID);
  assert.equal(
    parseYdbDatabaseIdFromConnectionString(
      `grpcs://synthetic.invalid:2135/?database=%2Fru-central1%2F${FOLDER_ID}%2F${DATABASE_ID}`,
      FOLDER_ID,
    ),
    DATABASE_ID,
  );

  for (const value of [
    undefined,
    '',
    ' synthetic ',
    'not-a-url',
    `grpc://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/${DATABASE_ID}`,
    `grpcs://user@synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/${DATABASE_ID}`,
    `grpcs://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}`,
    `grpcs://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/${DATABASE_ID}/extra`,
    `grpcs://synthetic.invalid:2135/?database=/ru-central1/foreignfolder/${DATABASE_ID}`,
    `grpcs://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/${DATABASE_ID}&database=/ru-central1/${FOLDER_ID}/otherdb`,
    `grpcs://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/bad%2Fid`,
    `grpcs://synthetic.invalid:2135/?database=/ru-central1/${FOLDER_ID}/${DATABASE_ID}#private`,
  ]) {
    assert.equal(parseYdbDatabaseIdFromConnectionString(value, FOLDER_ID), null);
  }
  assert.equal(parseYdbDatabaseIdFromConnectionString(CONNECTION_STRING, ' foreign '), null);
});

test('runtime-SA resource limits probe performs one exact Database.Get and exposes only safe serverless limits', async () => {
  const calls = [];
  const result = await readYdbResourceLimitsWithRuntimeServiceAccount(
    ENVIRONMENT,
    CONTEXT,
    async (input, init) => {
      calls.push([String(input), init]);
      return response(database({
        endpoint: PRIVATE_LOOKING,
        name: PRIVATE_LOOKING,
        serverlessDatabase: {
          enableThrottlingRcuLimit: true,
          throttlingRcuLimit: '42',
          provisionedRcuLimit: '7',
        },
      }));
    },
  );

  assert.deepEqual(result, {
    status: 'PASS',
    code: 'YDB_RESOURCE_LIMITS_CLASSIFIED',
    databaseDiscovery: 'SINGLE',
    failureStage: 'NONE',
    mode: 'SERVERLESS',
    enableThrottlingRcuLimit: true,
    throttlingRcuLimit: 42,
    provisionedRcuLimit: 7,
  });
  assert.equal(calls.length, 1);
  const [urlString, init] = calls[0];
  const url = new URL(urlString);
  assert.equal(`${url.origin}${url.pathname}`, `${YANDEX_YDB_DATABASES_API}/${DATABASE_ID}`);
  assert.equal(url.search, '');
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Authorization, `Bearer ${CONTEXT.token.access_token}`);
  assert.equal(JSON.stringify(result).includes(PRIVATE_LOOKING), false);
  assert.equal(JSON.stringify(result).includes(DATABASE_ID), false);
  assert.equal(JSON.stringify(result).includes(FOLDER_ID), false);
});

test('runtime-SA exact Database.Get classifies dedicated and unknown without provider identifiers', async () => {
  const cases = [
    [database({ dedicatedDatabase: { resourcePresetId: PRIVATE_LOOKING } }), {
      ...safeUnknown('SINGLE'), mode: 'DEDICATED',
    }],
    [database({ zonalDatabase: { zoneId: PRIVATE_LOOKING } }), safeUnknown('SINGLE')],
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

test('runtime-SA exact Database.Get fails closed for invalid target, malformed limits, context and provider responses', async () => {
  const malformedBodies = [
    [null, 'IDENTITY_MISMATCH'],
    [{}, 'IDENTITY_MISMATCH'],
    [database({ id: 'otherdatabaseid' }), 'IDENTITY_MISMATCH'],
    [database({ folderId: 'otherfolderid' }), 'IDENTITY_MISMATCH'],
    [database({ serverlessDatabase: { enableThrottlingRcuLimit: true, throttlingRcuLimit: '-1', provisionedRcuLimit: '7' } }), 'LIMITS_MALFORMED'],
    [database({ serverlessDatabase: { enableThrottlingRcuLimit: true, throttlingRcuLimit: '9007199254740992', provisionedRcuLimit: '7' } }), 'LIMITS_MALFORMED'],
    [database({ serverlessDatabase: { enableThrottlingRcuLimit: 'true', throttlingRcuLimit: '1', provisionedRcuLimit: '1' } }), 'LIMITS_MALFORMED'],
    [database({ serverlessDatabase: {}, dedicatedDatabase: {} }), 'LIMITS_MALFORMED'],
  ];

  for (const [body, failureStage] of malformedBodies) {
    assert.deepEqual(
      await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => response(body)),
      safeUnknown('READ_FAILED', failureStage),
    );
  }

  let calls = 0;
  const mustNotRun = async () => { calls += 1; throw new Error(PRIVATE_LOOKING); };
  for (const [environment, context] of [
    [{}, CONTEXT],
    [{ PRIHRASH_YC_FOLDER_ID: FOLDER_ID }, CONTEXT],
    [{ PRIHRASH_YC_FOLDER_ID: ' foreign ', PRIHRASH_YDB_CONNECTION_STRING: CONNECTION_STRING }, CONTEXT],
    [{ PRIHRASH_YC_FOLDER_ID: FOLDER_ID, PRIHRASH_YDB_CONNECTION_STRING: 'private' }, CONTEXT],
    [ENVIRONMENT, {}],
    [ENVIRONMENT, { token: {} }],
    [ENVIRONMENT, { token: { access_token: ' synthetic ' } }],
  ]) {
    assert.deepEqual(
      await readYdbResourceLimitsWithRuntimeServiceAccount(environment, context, mustNotRun),
      safeUnknown('READ_FAILED', 'TARGET_CONFIG_INVALID'),
    );
  }
  assert.equal(calls, 0);

  assert.deepEqual(
    await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => { throw new Error(PRIVATE_LOOKING); }),
    safeUnknown('READ_FAILED', 'TRANSPORT_FAILED'),
  );

  for (const [status, failureStage] of [
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [503, 'PROVIDER_5XX'],
    [418, 'UNEXPECTED_STATUS'],
  ]) {
    assert.deepEqual(
      await readYdbResourceLimitsWithRuntimeServiceAccount(
        ENVIRONMENT,
        CONTEXT,
        async () => response({ detail: PRIVATE_LOOKING }, status),
      ),
      safeUnknown('READ_FAILED', failureStage),
    );
  }

  assert.deepEqual(
    await readYdbResourceLimitsWithRuntimeServiceAccount(ENVIRONMENT, CONTEXT, async () => new Response(PRIVATE_LOOKING, { status: 200 })),
    safeUnknown('READ_FAILED', 'MALFORMED_JSON'),
  );
});
