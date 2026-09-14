import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-readiness.mjs');
const FUNCTION_ID = 'synthetic-function-id';

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-fake-yc-retry-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

async function runInvoker(fakeSource) {
  const fake = await fakeYc(fakeSource);
  try {
    const result = await execFileAsync(process.execPath, [INVOKER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PRIHRASH_YC_BIN: fake.path,
        PRIHRASH_YANDEX_READINESS_FUNCTION_ID: FUNCTION_ID,
        YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
      },
      encoding: 'utf8',
    });
    return Object.freeze({
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      attempts: Number(await readFile(`${fake.path}.attempt`, 'utf8')),
    });
  } catch (error) {
    return Object.freeze({
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
      attempts: Number(await readFile(`${fake.path}.attempt`, 'utf8')),
    });
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
}

const counterPrelude = `
const fs = require('node:fs');
const state = __filename + '.attempt';
const attempt = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) : 0;
fs.writeFileSync(state, String(attempt + 1));
`;

test('orchestrated readiness retries categories-stage failure once and can recover without owner choreography', async () => {
  const result = await runInvoker(`${counterPrelude}
if (attempt === 0) {
  process.stdout.write(JSON.stringify({readinessFailure:'YDB_CATEGORIES_SCHEMA_READ_FAILED'}));
} else {
  process.stdout.write(JSON.stringify({googleSource:'READY',ydbSchema:'READY',requiredMigrationVersion:3}));
}
`);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'PASS', code: 'READINESS_READY' });
  assert.equal(result.stderr, '');
  assert.equal(result.attempts, 2);
});

test('orchestrated readiness never retries categories-stage failure more than once', async () => {
  const result = await runInvoker(`${counterPrelude}
process.stdout.write(JSON.stringify({readinessFailure:'YDB_CATEGORIES_SCHEMA_READ_FAILED'}));
`);

  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'READINESS_YDB_CATEGORIES_SCHEMA_READ_FAILED',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.attempts, 2);
});

test('definitive readiness blockers remain single-attempt fail-closed', async () => {
  const result = await runInvoker(`${counterPrelude}
process.stdout.write(JSON.stringify({readinessFailure:'MISSING_REQUIRED_SCHEMA_MIGRATION'}));
`);

  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'FAIL',
    code: 'READINESS_MISSING_REQUIRED_SCHEMA_MIGRATION',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.attempts, 1);
});
