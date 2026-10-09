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

test('R1 direct-YDB denial reaches a single database-scoped Owner authority decision, not IAM bypass', async () => {
  const closure = await readFile(new URL('../../docs/R1_CLOSURE_PATH.md', import.meta.url), 'utf8');
  const sprint = await readFile(new URL('../../docs/R1_COMPLETION_SPRINT.md', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../../.github/workflows/r1-direct-ydb-readonly.yml', import.meta.url), 'utf8');

  assert.match(closure, /37829722475/);
  assert.match(closure, /R1_DIRECT_PROBE=YDB_METADATA_PERMISSION_DENIED/);
  assert.match(closure, /ни `Driver\.ready\(\)`, ни `SELECT 1` не достигнуты/i);
  assert.match(closure, /BLOCKED_NEEDS_EXPLICIT_DATABASE_READ_AUTHORITY/);
  assert.match(closure, /временный grant `ydb\.viewer` на конкретную `prihrash-prod`/);
  assert.match(closure, /возможность читать финансовые строки/);
  assert.match(closure, /Это разрешение \*\*израсходовано\*\*/);
  assert.match(closure, /не folder\/cloud-wide role/);
  assert.match(closure, /не `set-access-bindings`/);
  assert.match(closure, /retirement \*\*только собственной\*\* binding/);
  assert.match(closure, /CreateVersion.*GRANTED\/PENDING_HOLD_CLEARANCE/s);

  assert.match(sprint, /BLOCKED_NEEDS_EXPLICIT_DATABASE_READ_AUTHORITY/);
  assert.match(sprint, /CreateVersion` one-shot\s+authority does \*\*not\*\* cover this IAM change/);
  assert.match(workflow, /R1_DIRECT_PROBE=YDB_METADATA_PERMISSION_DENIED/);
  assert.doesNotMatch(workflow, /\bydb\.viewer\b|\badd-access-binding\b|\bset-access-bindings\b/);
  assert.doesNotMatch(workflow, /\bselect\s+\*/i);
});

test('temporary exact-database viewer authority was consumed and retired without claiming YDB SELECT', async () => {
  const closure = await readFile(new URL('../../docs/R1_CLOSURE_PATH.md', import.meta.url), 'utf8');
  const sprint = await readFile(new URL('../../docs/R1_COMPLETION_SPRINT.md', import.meta.url), 'utf8');
  assert.match(closure, /Authority: #630 comment `6079632335`/);
  assert.match(closure, /postmortem evidence: #630 comment[\s\S]{0,30}`6079713439`/);
  assert.match(closure, /`R1_TEMP_EXACT_DB_VIEWER_FOR_SINGLE_READONLY_PROBE`[\s\S]{0,30}CONSUMED/);
  assert.match(closure, /manual probe `37921856585`/);
  assert.match(closure, /R1_DIRECT_PROBE=YDB_METADATA_PERMISSION_DENIED/);
  assert.match(closure, /exactly 1 target-SA viewer/);
  assert.match(closure, /0 target bindings/);
  assert.match(closure, /No `Driver\.ready\(\)` or `SELECT 1` was[\s\S]{0,20}reached/);
  assert.match(closure, /at least 60 seconds|как минимум 60 секунд/);
  assert.match(closure, /разрешение[\s\S]{0,20}израсходовано/);
  assert.match(closure, /нового отдельного.*Owner-разрешения/s);
  assert.match(closure, /`Database\.Get`/);
  assert.match(sprint, /one-shot IAM authority is \*\*CONSUMED\*\*/);
  assert.match(sprint, /Original database ACL was restored/);
  assert.match(sprint, /up to one minute for role propagation/);
  assert.match(sprint, /A \*\*new explicit Owner decision\*\*/);
  assert.doesNotMatch(sprint, /READ_ONLY_SELECT_OK.*37921856585/);
});
