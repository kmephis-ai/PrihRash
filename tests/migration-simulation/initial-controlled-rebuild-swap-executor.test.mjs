import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YdbSchemeAdapter,
  YdbSchemeError,
  YdbSchemeTransportOutcomeUnknownError,
} from '../../dist/integration/ydb/scheme.js';
import {
  executeControlledInitialSwap,
  ControlledInitialSwapExecutionError,
} from '../../dist/migration/initialControlledRebuildSwapExecutor.js';

const RUN_ID = '00000000-0000-0000-0000-000000009301';
const DIRECTORY = 'rebuild/r_00000000000000000000000000009301';

function plan() {
  return Object.freeze({
    runId: RUN_ID,
    replacements: Object.freeze([
      Object.freeze({ source: `${DIRECTORY}/transactions`, destination: 'transactions', replace: true }),
      Object.freeze({ source: `${DIRECTORY}/source_records`, destination: 'source_records', replace: true }),
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

test('executes both gated replacements in exactly one atomic rename call', async () => {
  const fake = fakeScheme();
  const result = await executeControlledInitialSwap(fake.adapter, plan());

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0][0], 'rename');
  assert.deepEqual(fake.calls[0][1], plan().replacements);
  assert.deepEqual(result, { runId: RUN_ID, replacementCount: 2 });
  assert.equal(Object.isFrozen(result), true);
});

test('unknown atomic rename outcome is surfaced once and never auto-retried', async () => {
  let calls = 0;
  const fake = fakeScheme({
    async renameTables() {
      calls += 1;
      throw new YdbSchemeTransportOutcomeUnknownError(new Error('synthetic rename ambiguity'));
    },
  });

  await assert.rejects(
    () => executeControlledInitialSwap(fake.adapter, plan()),
    (error) => error instanceof YdbSchemeError && error.code === 'SCHEME_OPERATION_OUTCOME_UNKNOWN',
  );
  assert.equal(calls, 1);
});

test('definite provider rejection is not rewritten and does not produce a success result', async () => {
  const rejection = new Error('synthetic definite rename rejection');
  const fake = fakeScheme({ async renameTables() { throw rejection; } });
  await assert.rejects(() => executeControlledInitialSwap(fake.adapter, plan()), (error) => error === rejection);
});

test('rejects reordered, non-replace, foreign-run, or malformed plans before provider call', async () => {
  for (const malformed of [
    Object.freeze({ ...plan(), replacements: Object.freeze([...plan().replacements].reverse()) }),
    Object.freeze({ ...plan(), replacements: Object.freeze([
      Object.freeze({ ...plan().replacements[0], replace: false }),
      plan().replacements[1],
    ]) }),
    Object.freeze({ ...plan(), runId: '00000000-0000-0000-0000-000000009399' }),
    Object.freeze({ ...plan(), replacements: Object.freeze([plan().replacements[0]]) }),
  ]) {
    const fake = fakeScheme();
    await assert.rejects(
      () => executeControlledInitialSwap(fake.adapter, malformed),
      (error) => error instanceof ControlledInitialSwapExecutionError && error.code === 'INVALID_SWAP_PLAN',
    );
    assert.equal(fake.calls.length, 0);
  }
});
