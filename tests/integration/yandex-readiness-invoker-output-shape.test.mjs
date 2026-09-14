import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-readiness.mjs');
const FUNCTION_ID = 'synthetic-readiness-function-id';
const PRIVATE_LOOKING = 'private-sheet-id grpcs://private-ydb private-token-value 12345';

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-readiness-shape-yc-'));
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
        PRIHRASH_YANDEX_READINESS_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
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

function assertSafeShape(result, outputShape) {
  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'READINESS_INVOKE_NONZERO_UNCLASSIFIED',
  });
  assert.deepEqual(
    result.stderr.trim().split('\n'),
    [
      `READINESS_INVOKE_OUTPUT_SHAPE=${outputShape}`,
      `READINESS_INVOKE_OUTPUT_SHAPE=${outputShape}`,
    ],
  );
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('GitHub Actions observability reports enum-only shape for both bounded private-text attempts', async () => {
  const result = await runInvoker(`
process.stdout.write('${PRIVATE_LOOKING}');
process.stderr.write('${PRIVATE_LOOKING}');
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_TEXT__STDERR_TEXT');
});

test('GitHub Actions observability distinguishes JSON object stdout without keys or values', async () => {
  const result = await runInvoker(`
process.stdout.write(JSON.stringify({private:'${PRIVATE_LOOKING}'}));
process.exit(17);
`);

  assertSafeShape(result, 'STDOUT_JSON_OBJECT__STDERR_EMPTY');
});
