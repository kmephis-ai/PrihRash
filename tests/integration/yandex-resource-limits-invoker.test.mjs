import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const INVOKER = resolve(ROOT, 'scripts/invoke-yandex-resource-limits.mjs');
const FUNCTION_ID = 'synthetic-function-id';
const PRIVATE_LOOKING = 'private-provider-id private-endpoint private-detail';

async function fakeYc(source) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-resource-limits-yc-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}

async function runInvoker({ fakeSource, includeFunctionId = true, ycPath = null }) {
  const fake = fakeSource === null ? null : await fakeYc(fakeSource);
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PRIHRASH_YC_BIN: ycPath ?? fake?.path,
    YC_IAM_TOKEN: 'synthetic-short-lived-iam-token',
    SYNTHETIC_PRIVATE_VALUE: PRIVATE_LOOKING,
    ...(includeFunctionId ? { PRIHRASH_YANDEX_READINESS_FUNCTION_ID: FUNCTION_ID } : {}),
  };
  try {
    const result = await execFileAsync(process.execPath, [INVOKER], { cwd: ROOT, env: environment, encoding: 'utf8' });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
    };
  } finally {
    if (fake !== null) await rm(fake.directory, { recursive: true, force: true });
  }
}

function assertSafe(result, expected) {
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(PRIVATE_LOOKING), false);
  assert.equal(result.stderr.includes(PRIVATE_LOOKING), false);
}

test('resource limits invoker calls exactly the pinned read-only tag once and accepts bounded evidence', async () => {
  const result = await runInvoker({ fakeSource: `
const expected = ['serverless','function','invoke','--id','${FUNCTION_ID}','--tag','r1-ydb-resource-limits','--retry','0','--no-user-output'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(91);
if (process.env.PRIHRASH_YANDEX_READINESS_FUNCTION_ID !== undefined) process.exit(92);
if (process.env.SYNTHETIC_PRIVATE_VALUE !== undefined) process.exit(93);
if (process.env.YC_IAM_TOKEN !== 'synthetic-short-lived-iam-token') process.exit(94);
process.stdout.write(JSON.stringify({status:'PASS',code:'YDB_RESOURCE_LIMITS_CLASSIFIED',databaseDiscovery:'SINGLE',failureStage:'NONE',mode:'SERVERLESS',enableThrottlingRcuLimit:true,throttlingRcuLimit:42,provisionedRcuLimit:7}));
` });

  assert.equal(result.exitCode, 0);
  assertSafe(result, {
    status: 'PASS', code: 'YDB_RESOURCE_LIMITS_CLASSIFIED', databaseDiscovery: 'SINGLE', failureStage: 'NONE', mode: 'SERVERLESS',
    enableThrottlingRcuLimit: true, throttlingRcuLimit: 42, provisionedRcuLimit: 7,
  });
});

test('resource limits invoker accepts fail-closed READ_FAILED evidence without exposing provider detail', async () => {
  const result = await runInvoker({ fakeSource: `
process.stderr.write('');
process.stdout.write(JSON.stringify({status:'PASS',code:'YDB_RESOURCE_LIMITS_CLASSIFIED',databaseDiscovery:'READ_FAILED',failureStage:'FORBIDDEN',mode:'UNKNOWN',enableThrottlingRcuLimit:null,throttlingRcuLimit:null,provisionedRcuLimit:null}));
` });
  assert.equal(result.exitCode, 0);
  assertSafe(result, {
    status: 'PASS', code: 'YDB_RESOURCE_LIMITS_CLASSIFIED', databaseDiscovery: 'READ_FAILED', failureStage: 'FORBIDDEN', mode: 'UNKNOWN',
    enableThrottlingRcuLimit: null, throttlingRcuLimit: null, provisionedRcuLimit: null,
  });
});

test('resource limits invoker rejects malformed success output and never echoes it', async () => {
  for (const output of [
    PRIVATE_LOOKING,
    JSON.stringify({ status: 'PASS', code: 'YDB_RESOURCE_LIMITS_CLASSIFIED', databaseDiscovery: 'SINGLE', failureStage: 'NONE', mode: 'SERVERLESS', enableThrottlingRcuLimit: true, throttlingRcuLimit: -1, provisionedRcuLimit: 7 }),
    JSON.stringify({ status: 'PASS', code: 'YDB_RESOURCE_LIMITS_CLASSIFIED', databaseDiscovery: 'SINGLE', failureStage: 'NONE', mode: 'SERVERLESS', enableThrottlingRcuLimit: true, throttlingRcuLimit: 1, provisionedRcuLimit: 7, private: PRIVATE_LOOKING }),
  ]) {
    const result = await runInvoker({ fakeSource: `process.stdout.write(${JSON.stringify(output)});` });
    assert.equal(result.exitCode, 2);
    assertSafe(result, { status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_OUTPUT_INVALID' });
  }
});

test('resource limits invoker fails closed on provider failure or missing configuration without retries', async () => {
  const providerFailure = await runInvoker({ fakeSource: `process.stdout.write('${PRIVATE_LOOKING}'); process.stderr.write('${PRIVATE_LOOKING}'); process.exit(17);` });
  assert.equal(providerFailure.exitCode, 2);
  assertSafe(providerFailure, { status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_FAILED' });

  const missingId = await runInvoker({ includeFunctionId: false, fakeSource: `process.exit(99);` });
  assert.equal(missingId.exitCode, 2);
  assertSafe(missingId, { status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_CONFIG_INVALID' });

  const missingCli = await runInvoker({ fakeSource: null, ycPath: resolve(tmpdir(), 'prihrash-resource-limits-missing-yc') });
  assert.equal(missingCli.exitCode, 2);
  assertSafe(missingCli, { status: 'FAIL', code: 'YDB_RESOURCE_LIMITS_INVOKE_FAILED' });
});
