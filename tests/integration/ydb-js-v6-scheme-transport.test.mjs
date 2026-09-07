import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '@bufbuild/protobuf';
import { anyPack } from '@bufbuild/protobuf/wkt';
import {
  OperationParams_OperationMode,
  StatusIds_StatusCode,
} from '@ydbjs/api/operation';
import { CreateSessionResultSchema } from '@ydbjs/api/table';
import {
  YdbJsV6SchemeProviderError,
  YdbJsV6SchemeTransport,
} from '../../dist/integration/ydb/ydbJsV6SchemeTransport.js';
import { YdbSchemeTransportOutcomeUnknownError } from '../../dist/integration/ydb/scheme.js';

function successOperation(result) {
  return { ready: true, status: StatusIds_StatusCode.SUCCESS, issues: [], ...(result === undefined ? {} : { result }) };
}

function sessionOperation(id = 'session-1') {
  return successOperation(anyPack(CreateSessionResultSchema, create(CreateSessionResultSchema, { sessionId: id })));
}

function fakeDriver(overrides = {}) {
  const events = [];
  const schemeClient = {
    async makeDirectory(request) {
      events.push(['makeDirectory', request]);
      return { operation: successOperation() };
    },
  };
  const tableClient = {
    async createSession(request) {
      events.push(['createSession', request]);
      return { operation: sessionOperation() };
    },
    async copyTables(request) {
      events.push(['copyTables', request]);
      return { operation: successOperation() };
    },
    async renameTables(request) {
      events.push(['renameTables', request]);
      return { operation: successOperation() };
    },
    async deleteSession(request) {
      events.push(['deleteSession', request]);
      return { operation: successOperation() };
    },
  };
  Object.assign(schemeClient, overrides.schemeClient);
  Object.assign(tableClient, overrides.tableClient);
  return {
    events,
    driver: {
      database: '/ru-central1/test/db',
      createClient(definition) {
        return Object.hasOwn(definition, 'makeDirectory') ? schemeClient : tableClient;
      },
    },
  };
}

test('binds directory/copy/rename to one SYNC provider call with qualified paths', async () => {
  const fake = fakeDriver();
  const transport = new YdbJsV6SchemeTransport(fake.driver);
  await transport.ensureDirectory('rebuild/r_001');
  await transport.copyTables([
    { source: 'transactions', destination: 'rebuild/r_001/transactions', omitIndexes: false },
    { source: 'source_records', destination: 'rebuild/r_001/source_records', omitIndexes: false },
  ]);
  await transport.renameTables([
    { source: 'rebuild/r_001/transactions', destination: 'transactions', replace: true },
    { source: 'rebuild/r_001/source_records', destination: 'source_records', replace: true },
  ]);

  const mkdir = fake.events.find(([name]) => name === 'makeDirectory')[1];
  assert.equal(mkdir.path, '/ru-central1/test/db/rebuild/r_001');
  assert.equal(mkdir.operationParams.operationMode, OperationParams_OperationMode.SYNC);

  const copies = fake.events.filter(([name]) => name === 'copyTables');
  assert.equal(copies.length, 1);
  assert.deepEqual(copies[0][1].tables.map(({ sourcePath, destinationPath, omitIndexes }) => ({ sourcePath, destinationPath, omitIndexes })), [
    { sourcePath: '/ru-central1/test/db/transactions', destinationPath: '/ru-central1/test/db/rebuild/r_001/transactions', omitIndexes: false },
    { sourcePath: '/ru-central1/test/db/source_records', destinationPath: '/ru-central1/test/db/rebuild/r_001/source_records', omitIndexes: false },
  ]);

  const renames = fake.events.filter(([name]) => name === 'renameTables');
  assert.equal(renames.length, 1);
  assert.deepEqual(renames[0][1].tables.map(({ sourcePath, destinationPath, replaceDestination }) => ({ sourcePath, destinationPath, replaceDestination })), [
    { sourcePath: '/ru-central1/test/db/rebuild/r_001/transactions', destinationPath: '/ru-central1/test/db/transactions', replaceDestination: true },
    { sourcePath: '/ru-central1/test/db/rebuild/r_001/source_records', destinationPath: '/ru-central1/test/db/source_records', replaceDestination: true },
  ]);
});

test('classifies mutation RPC exception and indeterminate statuses as outcome unknown', async () => {
  for (const tableClient of [
    { copyTables: async () => { throw new Error('network'); } },
    { copyTables: async () => ({ operation: { ready: true, status: StatusIds_StatusCode.TIMEOUT, issues: [] } }) },
    { copyTables: async () => ({ operation: { ready: true, status: StatusIds_StatusCode.UNDETERMINED, issues: [] } }) },
    { copyTables: async () => ({ operation: { ready: false, status: StatusIds_StatusCode.SUCCESS, issues: [] } }) },
  ]) {
    const fake = fakeDriver({ tableClient });
    await assert.rejects(
      () => new YdbJsV6SchemeTransport(fake.driver).copyTables([
        { source: 'transactions', destination: 'rebuild/r_001/transactions', omitIndexes: false },
      ]),
      (error) => error instanceof YdbSchemeTransportOutcomeUnknownError,
    );
  }
});

test('preserves completed non-success provider status as definite rejection', async () => {
  const fake = fakeDriver({ tableClient: {
    renameTables: async () => ({ operation: { ready: true, status: StatusIds_StatusCode.SCHEME_ERROR, issues: [] } }),
  } });
  await assert.rejects(
    () => new YdbJsV6SchemeTransport(fake.driver).renameTables([
      { source: 'rebuild/r_001/transactions', destination: 'transactions', replace: true },
    ]),
    (error) => error instanceof YdbJsV6SchemeProviderError
      && error.code === 'SCHEME_PROVIDER_REJECTED'
      && error.status === StatusIds_StatusCode.SCHEME_ERROR,
  );
});

test('session creation failure is definite and mutation is never issued', async () => {
  const fake = fakeDriver({ tableClient: {
    createSession: async () => ({ operation: { ready: true, status: StatusIds_StatusCode.BAD_SESSION, issues: [] } }),
  } });
  await assert.rejects(
    () => new YdbJsV6SchemeTransport(fake.driver).copyTables([
      { source: 'transactions', destination: 'rebuild/r_001/transactions', omitIndexes: false },
    ]),
    (error) => error instanceof YdbJsV6SchemeProviderError && error.code === 'TABLE_SESSION_CREATE_FAILED',
  );
  assert.equal(fake.events.some(([name]) => name === 'copyTables'), false);
});
