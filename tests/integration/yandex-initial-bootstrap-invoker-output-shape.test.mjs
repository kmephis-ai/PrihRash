import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-initial-bootstrap.mjs');
const FUNCTION_ID = 'synthetic-bootstrap-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-bootstrap-shape-yc-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

async function runInvoker(fakeSource) {
  const fake = await fakeYc(fakeSource);
  try {
    await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_ACTIONS: 'true',
        PRIHRASH_YC_BIN: fake.path,
        PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
      },
      encoding: 'utf8',
    });
    assert.fail('non-success bootstrap result must keep the invoker exit non-zero');
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
    code: 'INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED',
    outputShape,
    transportClass,
  });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('GitHub Actions observability reports only enum shape and OTHER class for private text output', async () => {
  const result = await runInvoker(`
process.stdout.write('${PRIVATE_LOOKING}');
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_TEXT__STDERR_TEXT', 'OTHER');
});

test('GitHub Actions observability distinguishes empty stdout from provider stderr text', async () => {
  const result = await runInvoker(`
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_EMPTY__STDERR_TEXT', 'OTHER');
});

test('GitHub Actions observability reports JSON container type without keys or values', async () => {
  const result = await runInvoker(`
process.stdout.write(JSON.stringify({private:'${PRIVATE_LOOKING}'}));
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_JSON_OBJECT__STDERR_EMPTY', 'EMPTY');
});

test('GitHub Actions observability classifies authorization transport text without preserving it', async () => {
  const result = await runInvoker(`
process.stderr.write('PermissionDenied: synthetic authorization failure ${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_EMPTY__STDERR_TEXT', 'AUTH');
});

test('GitHub Actions observability classifies deadline transport text without preserving it', async () => {
  const result = await runInvoker(`
process.stderr.write('context deadline exceeded ${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_EMPTY__STDERR_TEXT', 'DEADLINE');
});
