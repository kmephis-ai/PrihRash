import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function fakeYc(stdoutPayload) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-recovery-insertions-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${JSON.stringify(stdoutPayload)}\n`)});\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

test('recovery invoker accepts only enum-safe insertion-only evidence', async () => {
  const yc = await fakeYc({
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
    stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
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
  ]);
});
