import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { createFakeNodeCli } from '../helpers/fake-node-cli.mjs';

const execFileAsync = promisify(execFile);

async function fakeYc(stdoutPayload) {
  return (await createFakeNodeCli(
    'prihrash-recovery-insertions-',
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(stdoutPayload)}\n`)});`,
  )).path;
}

test('recovery invoker accepts only enum-safe insertion-only evidence', async () => {
  const yc = await fakeYc({
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
    stagingSourceDecodeEvidence: [],
    stagingExactRevisionEvidence: 'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN',
  });

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['scripts/invoke-yandex-initial-bootstrap-recovery.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID: 'synthetic-function-id',
        PRIHRASH_YC_BIN: yc,
      },
    },
  );

  assert.deepEqual(JSON.parse(stdout), {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
  });
  assert.deepEqual(stderr.trim().split('\n'), [
    'R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
    'R1_STAGING_DURABLE_REVISION_EVIDENCE=PARTIAL_CURRENT_RUN_ONLY',
    'R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY',
    'R1_STAGING_SOURCE_DECODE_EVIDENCE=NONE',
    'R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN',
  ]);
});
