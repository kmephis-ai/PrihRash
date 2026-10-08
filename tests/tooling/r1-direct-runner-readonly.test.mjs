import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = new URL('../../scripts/r1-direct-runner-readonly.mjs', import.meta.url);

test('R1 external probe rejects missing credentials before network access', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(url)], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
    },
    timeout: 6000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /^R1_DIRECT_PROBE=CONFIG_MISSING_OR_INVALID\n$/);
});

test('R1 external probe uses bounded read-only SELECT without provider mutation', async () => {
  const source = await readFile(url, 'utf8');
  assert.match(source, /AccessTokenCredentialsProvider/);
  assert.match(source, /SELECT 1 AS r1_readonly_probe;/);
  assert.match(source, /AbortSignal\.timeout\(12000\)/);
  assert.match(source, /\.timeout\(10000\)/);
  assert.doesNotMatch(source, /(?:\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bUPSERT\b|\bCREATE\b|\bDROP\b|\bALTER\b|execSync|fetch\()/i);
  assert.doesNotMatch(source, /console\.log\(.*token|process\.stdout\.write\(.*token/);
});

test('hosted proof is manual, exact-main, WIF-only and read-only', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/r1-direct-ydb-readonly.yml', import.meta.url), 'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  assert.match(workflow, /YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID/);
  assert.match(workflow, /node scripts\/r1-direct-runner-readonly\.mjs/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /function version create|serverless function invoke|iam.*(add|remove)-access-binding|table query execute/i);
});
