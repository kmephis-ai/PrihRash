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
const FUNCTION_ID = 'synthetic-function-id';

async function fakeYc(source) {
  return createFakeNodeCli('prihrash-fake-yc-deadline-', source);
}

async function runInvoker(fakeSource) {
  const fake = await fakeYc(fakeSource);
  try {
    return await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PRIHRASH_YC_BIN: fake.path,
        PRIHRASH_YANDEX_READINESS_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-token',
      },
      encoding: 'utf8',
    });
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
}

test('one runtime readiness deadline is retried once and can recover', async () => {
  const result = await runInvoker(`
const fs = require('node:fs');
const state = __filename + '.attempt';
const attempt = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) : 0;
fs.writeFileSync(state, String(attempt + 1));
if (attempt === 0) {
  process.stdout.write(JSON.stringify({readinessFailure:'DEADLINE_EXCEEDED'}));
} else {
  process.stdout.write(JSON.stringify({googleSource:'READY',ydbSchema:'READY',requiredMigrationVersion:4}));
}
`);

  assert.deepEqual(JSON.parse(result.stdout), { status: 'PASS', code: 'READINESS_READY' });
  assert.equal(result.stderr, '');
});

test('persistent runtime readiness deadline remains in the existing safe timeout contract after the bounded retry', async () => {
  let error;
  try {
    await runInvoker(`process.stdout.write(JSON.stringify({readinessFailure:'DEADLINE_EXCEEDED'}));`);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 2);
  assert.deepEqual(JSON.parse(error?.stdout ?? ''), {
    status: 'FAIL',
    code: 'READINESS_INVOKE_FUNCTION_TIMEOUT',
  });
  assert.equal(error?.stderr, '');
});
