import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function fakeYc(stdoutPayload) {
  const directory = await mkdtemp(join(tmpdir(), 'prihrash-recovery-invoker-'));
  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${JSON.stringify(stdoutPayload)}\n`)});\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

test('recovery invoker keeps canonical stdout shape and emits only enum diagnostic to stderr', async () => {
  const yc = await fakeYc({
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
    verdict: 'RECOVERY_REQUIRED',
    reason: 'STAGING_RUN_PRESENT',
    stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
    stagingDurableRevisionEvidence: 'CROSS_RUN_PK_COLLISION',
    stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
    stagingSourceDecodeEvidence: [
      { errorCode: 'INVALID_DATE_CELL', field: 'date' },
      { errorCode: 'INVALID_TEXT_CELL', field: 'description' },
    ],
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
    'R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
    'R1_STAGING_DURABLE_REVISION_EVIDENCE=CROSS_RUN_PK_COLLISION',
    'R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
    'R1_STAGING_SOURCE_DECODE_EVIDENCE=INVALID_DATE_CELL@date,INVALID_TEXT_CELL@description',
  ]);
});

test('recovery invoker rejects missing or unknown STAGING diagnostics fail-closed', async () => {
  const invalidPayloads = [
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [],
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'SYNTHETIC_UNKNOWN_DIAGNOSTIC',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [],
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
      stagingRetirementEvidence: 'SYNTHETIC_UNKNOWN_RETIREMENT_DIAGNOSTIC',
      stagingSourceDecodeEvidence: [],
    },
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'STAGING_RUN_PRESENT',
      stagingRevisionEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
      stagingDurableRevisionEvidence: 'PARTIAL_CURRENT_RUN_ONLY',
      stagingRetirementEvidence: 'STALE_STAGING_CURRENT_STATE_EMPTY',
      stagingSourceDecodeEvidence: [
        { errorCode: 'INVALID_TEXT_CELL', field: 'synthetic_private_field' },
      ],
    },
  ];

  for (const payload of invalidPayloads) {
    const yc = await fakeYc(payload);
    await assert.rejects(
      execFileAsync(
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
      ),
      (error) => {
        assert.equal(error.code, 2);
        assert.deepEqual(JSON.parse(error.stdout), {
          status: 'FAIL',
          code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_OUTPUT_INVALID',
        });
        assert.equal(error.stderr, '');
        return true;
      },
    );
  }
});
