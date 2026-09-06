import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YdbSchemeAdapter,
  YdbSchemeError,
  YdbSchemeTransportOutcomeUnknownError,
} from '../../dist/integration/ydb/scheme.js';

function fakeTransport(overrides = {}) {
  const calls = [];
  return {
    calls,
    transport: {
      async ensureDirectory(path) { calls.push(['mkdir', path]); },
      async copyTables(items) { calls.push(['copy', items]); },
      async renameTables(items) { calls.push(['rename', items]); },
      ...overrides,
    },
  };
}

function expectCode(code, work) {
  return assert.rejects(
    work,
    (error) => error instanceof YdbSchemeError && error.code === code,
  );
}

test('passes the whole copy set to transport in one call with immutable structured items', async () => {
  const fake = fakeTransport();
  const adapter = new YdbSchemeAdapter(fake.transport);
  const input = [
    { source: 'transactions', destination: 'rebuild/r_00000000000000000000000000008901/transactions', omitIndexes: false },
    { source: 'source_records', destination: 'rebuild/r_00000000000000000000000000008901/source_records', omitIndexes: false },
  ];

  await adapter.copyTables(input);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0][0], 'copy');
  assert.deepEqual(fake.calls[0][1], input);
  assert.equal(Object.isFrozen(fake.calls[0][1]), true);
  assert.equal(Object.isFrozen(fake.calls[0][1][0]), true);
});

test('passes the whole replacement set to transport in one call and keeps replace explicit', async () => {
  const fake = fakeTransport();
  const adapter = new YdbSchemeAdapter(fake.transport);
  await adapter.renameTables([
    { source: 'rebuild/r_00000000000000000000000000008901/transactions', destination: 'transactions', replace: true },
    { source: 'rebuild/r_00000000000000000000000000008901/source_records', destination: 'source_records', replace: true },
  ]);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0][0], 'rename');
  assert.deepEqual(fake.calls[0][1].map((item) => item.replace), [true, true]);
});

test('validates directory and table paths before transport is invoked', async () => {
  const fake = fakeTransport();
  const adapter = new YdbSchemeAdapter(fake.transport);

  await expectCode('INVALID_SCHEME_PATH', () => adapter.ensureDirectory('/absolute/rebuild'));
  await expectCode('INVALID_SCHEME_PATH', () => adapter.copyTables([
    { source: 'transactions', destination: 'rebuild/r_safe/../transactions', omitIndexes: false },
  ]));
  await expectCode('INVALID_SCHEME_PATH', () => adapter.renameTables([
    { source: 'rebuild/r_safe/transactions`', destination: 'transactions', replace: true },
  ]));
  assert.equal(fake.calls.length, 0);
});

test('rejects empty, duplicate-source, and duplicate-destination operation sets', async () => {
  const fake = fakeTransport();
  const adapter = new YdbSchemeAdapter(fake.transport);

  await expectCode('EMPTY_SCHEME_OPERATION', () => adapter.copyTables([]));
  await expectCode('DUPLICATE_SCHEME_SOURCE', () => adapter.copyTables([
    { source: 'transactions', destination: 'rebuild/r_a/transactions', omitIndexes: false },
    { source: 'transactions', destination: 'rebuild/r_a/transactions_2', omitIndexes: false },
  ]));
  await expectCode('DUPLICATE_SCHEME_DESTINATION', () => adapter.renameTables([
    { source: 'rebuild/r_a/transactions', destination: 'transactions', replace: true },
    { source: 'rebuild/r_a/source_records', destination: 'transactions', replace: true },
  ]));
  assert.equal(fake.calls.length, 0);
});

test('preserves unknown provider outcome as recovery-required instead of guessing failure or success', async () => {
  const cause = new Error('synthetic network ambiguity');
  const fake = fakeTransport({
    async renameTables() {
      throw new YdbSchemeTransportOutcomeUnknownError(cause);
    },
  });
  const adapter = new YdbSchemeAdapter(fake.transport);

  await assert.rejects(
    () => adapter.renameTables([
      { source: 'rebuild/r_a/transactions', destination: 'transactions', replace: true },
    ]),
    (error) => error instanceof YdbSchemeError
      && error.code === 'SCHEME_OPERATION_OUTCOME_UNKNOWN'
      && error.cause === cause,
  );
});

test('does not rewrite ordinary provider failures into outcome-unknown errors', async () => {
  const providerError = new Error('synthetic definite provider rejection');
  const fake = fakeTransport({ async copyTables() { throw providerError; } });
  const adapter = new YdbSchemeAdapter(fake.transport);

  await assert.rejects(
    () => adapter.copyTables([{ source: 'transactions', destination: 'rebuild/r_a/transactions', omitIndexes: false }]),
    (error) => error === providerError,
  );
});
