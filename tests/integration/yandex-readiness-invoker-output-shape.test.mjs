import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createFakeNodeCli } from '../helpers/fake-node-cli.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-readiness.mjs');
const FUNCTION_ID = 'synthetic-readiness-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function fakeYc(source) {
  return createFakeNodeCli('prihrash-fake-readiness-shape-yc-', source);
}

async function runInvoker(fakeSource, extraEnvironment = {}) {
  const fake = await fakeYc(fakeSource);
  try {
    await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_ACTIONS: 'true',
        PRIHRASH_YC_BIN: fake.path,
        PRIHRASH_YANDEX_READINESS_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
        ...extraEnvironment,
      },
      encoding: 'utf8',
    });
    assert.fail('persistent non-zero readiness result must keep the invoker exit non-zero');
  } catch (error) {
    return Object.freeze({
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    });
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
}

function assertSafeShape(result, outputShape, transportClass) {
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'READINESS_INVOKE_NONZERO_UNCLASSIFIED',
    outputShape,
    transportClass,
  });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('GitHub Actions evidence returns enum-only shape after bounded private-text attempts', async () => {
  const result = await runInvoker(`
process.stdout.write('${PRIVATE_LOOKING}');
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_TEXT__STDERR_TEXT', 'OTHER');
});

test('GitHub Actions evidence distinguishes JSON object stdout without keys or values', async () => {
  const result = await runInvoker(`
process.stdout.write(JSON.stringify({private:'${PRIVATE_LOOKING}'}));
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_JSON_OBJECT__STDERR_EMPTY', 'EMPTY');
});

test('GitHub Actions evidence classifies provider transport stderr without publishing text', async () => {
  const result = await runInvoker(`
process.stderr.write('rpc error: code = PermissionDenied details=${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_EMPTY__STDERR_TEXT', 'AUTH');
});

test('GitHub Actions evidence classifies function 502 stderr without publishing text', async () => {
  const result = await runInvoker(`
process.stderr.write('HTTP 502 Bad Gateway X-Function-Error: true details=${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_EMPTY__STDERR_TEXT', 'FUNCTION_ERROR');
});

test('GitHub Actions evidence classifies deadline transport stderr without publishing text', async () => {
  const result = await runInvoker(`
process.stderr.write('rpc error: code = DeadlineExceeded details=${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_EMPTY__STDERR_TEXT', 'DEADLINE');
});

test('non-GitHub invoker contract stays exact status/code without output shape', async () => {
  const result = await runInvoker(`
process.stdout.write('${PRIVATE_LOOKING}');
process.exit(17);
`, { GITHUB_ACTIONS: 'false' });

  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'READINESS_INVOKE_NONZERO_UNCLASSIFIED',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
});
