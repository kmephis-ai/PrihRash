import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YdbSchemeAdapter,
  YdbSchemeError,
  YdbSchemeTransportOutcomeUnknownError,
} from '../../dist/integration/ydb/scheme.js';
import {
  executeInitialControlledRebuildSetup,
  InitialControlledRebuildSetupExecutionError,
} from '../../dist/migration/initialControlledRebuildSetupExecutor.js';

const DIRECTORY = 'rebuild/r_00000000000000000000000000009101';

function plan(createDirectory = true) {
  return Object.freeze({
    stagingDirectory: DIRECTORY,
    createDirectory,
    copyItems: Object.freeze([
      Object.freeze({ source: 'transactions', destination: `${DIRECTORY}/transactions` }),
      Object.freeze({ source: 'source_records', destination: `${DIRECTORY}/source_records` }),
    ]),
  });
}

function fakeScheme(overrides = {}) {
  const calls = [];
  const transport = {
    async ensureDirectory(path) { calls.push(['mkdir', path]); },
    async copyTables(items) { calls.push(['copy', items]); },
    async renameTables(items) { calls.push(['rename', items]); },
    ...overrides,
  };
  return { calls, adapter: new YdbSchemeAdapter(transport) };
}

test('ensures run directory then copies both canonical tables in one atomic scheme call', async () => {
  const fake = fakeScheme();
  const result = await executeInitialControlledRebuildSetup(fake.adapter, plan(true));

  assert.deepEqual(fake.calls.map(([name]) => name), ['mkdir', 'copy']);
  assert.equal(fake.calls[1][1].length, 2);
  assert.deepEqual(fake.calls[1][1].map(({ source, destination, omitIndexes }) => ({ source, destination, omitIndexes })), [
    { source: 'transactions', destination: `${DIRECTORY}/transactions`, omitIndexes: false },
    { source: 'source_records', destination: `${DIRECTORY}/source_records`, omitIndexes: false },
  ]);
  assert.deepEqual(result, { stagingDirectory: DIRECTORY, directoryEnsured: true, copiedTableCount: 2 });
  assert.equal(Object.isFrozen(result), true);
});

test('skips mkdir at the proven safe retry point but still issues exactly one copy call', async () => {
  const fake = fakeScheme();
  const result = await executeInitialControlledRebuildSetup(fake.adapter, plan(false));
  assert.deepEqual(fake.calls.map(([name]) => name), ['copy']);
  assert.equal(result.directoryEnsured, false);
});

test('definite mkdir failure stops before copy', async () => {
  const rejection = new Error('synthetic definite mkdir rejection');
  const fake = fakeScheme({ async ensureDirectory() { throw rejection; } });
  await assert.rejects(
    () => executeInitialControlledRebuildSetup(fake.adapter, plan(true)),
    (error) => error === rejection,
  );
  assert.equal(fake.calls.length, 0);
});

test('unknown copy outcome stays recovery-required and is not automatically retried', async () => {
  let copyCalls = 0;
  const fake = fakeScheme({
    async copyTables() {
      copyCalls += 1;
      throw new YdbSchemeTransportOutcomeUnknownError(new Error('synthetic ambiguity'));
    },
  });
  await assert.rejects(
    () => executeInitialControlledRebuildSetup(fake.adapter, plan(false)),
    (error) => error instanceof YdbSchemeError && error.code === 'SCHEME_OPERATION_OUTCOME_UNKNOWN',
  );
  assert.equal(copyCalls, 1);
});

test('rejects malformed copy role/order/path before scheme transport is called', async () => {
  const fake = fakeScheme();
  const malformed = Object.freeze({
    ...plan(false),
    copyItems: Object.freeze([
      Object.freeze({ source: 'source_records', destination: `${DIRECTORY}/source_records` }),
      Object.freeze({ source: 'transactions', destination: `${DIRECTORY}/transactions` }),
    ]),
  });
  await assert.rejects(
    () => executeInitialControlledRebuildSetup(fake.adapter, malformed),
    (error) => error instanceof InitialControlledRebuildSetupExecutionError && error.code === 'INVALID_SETUP_PLAN',
  );
  assert.equal(fake.calls.length, 0);
});
