import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile(
  new URL('../../.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');
const runbook = (await readFile(
  new URL('../../docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

test('recovery autocontinue is a bounded exact-main read-only dispatch surface', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\n\s*- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /actions:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Recovery-Probe: READY/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_DURABLE_CLASSIFICATION/);
  assert.match(workflow, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(workflow, /"surface_only":"true"/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_WRITER_ACTIVE/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-yandex-readiness\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml\/dispatches/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('unknown durable outcome accepts only the read-only classification marker pair', (t) => {
  const filter = workflow.match(/marker="\$\(jq -Rn --arg body "\$source_pr_body" '\n([\s\S]*?)\n          '\)"/)?.[1];
  assert.ok(filter, 'extract the live jq marker filter from the workflow');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }

  const valid = (overrides = {}) => {
    const lines = {
      'Provider-Attempt': 'NOT_AUTHORIZED',
      'Recovery-Probe': 'READY',
      'Expected-Transition': 'READ_ONLY_DURABLE_CLASSIFICATION',
      'Recovery-State': 'UNKNOWN_AFTER_NON_SUCCESS',
      'Regression-Test': 'tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
      ...overrides,
    };
    const body = Object.entries(lines).map(([key, value]) => `${key}: ${value}`).join('\n');
    const result = spawnSync('jq', ['-Rn', '--arg', 'body', body, filter], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  assert.deepEqual(valid(), { valid: true, surfaceOnly: true });
  assert.equal(valid({ 'Provider-Attempt': 'READY' }).valid, false);
  assert.equal(valid({ 'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION' }).valid, false);
  assert.equal(valid({ 'Recovery-State': 'UNKNOWN_AFTER_NON_SUCCESS\nRecovery-State: UNKNOWN_AFTER_NON_SUCCESS' }).valid, false);
  assert.equal(valid({ 'Recovery-State': 'STAGING_RESUMABLE' }).valid, false);
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_PRESENT_UNCLASSIFIED',
  }), { valid: true, surfaceOnly: false });
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_RESUMABLE',
  }), { valid: true, surfaceOnly: false });
});

test('post-invoke STAGING_RUN_PRESENT evidence permits only one full read-only recovery probe', () => {
  const evidence = runbook.match(
    /### Post-invoke recovery leaves staging unclassified on `7a5c54dc5027cb9790ee4b0973287cbdf0b4c6f0`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the latest privacy-safe post-invoke classification must be recorded');
  assert.match(evidence, /orchestrator `36141234938`/);
  assert.match(evidence, /bootstrap child `36141543533` reached the write-capable invoke and failed/);
  assert.match(evidence, /`RECOVERY_REQUIRED \/ STAGING_RUN_PRESENT`/);
  assert.match(evidence, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(evidence, /Recovery-Probe: READY/);
  assert.match(evidence, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(evidence, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(evidence, /does not\nauthorize readiness, orchestrator, bootstrap, resume, cleanup, or authority change/);
});

test('the latest repeated HTTP 502 post-invoke state remains unclassified and read-only', () => {
  const evidence = runbook.match(
    /### Full classification required after repeated HTTP 502 on `ab1708c427ee9bad8b43dc6841c87afd7cff32df`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the current exact-SHA post-invoke recovery boundary must be recorded');
  assert.match(evidence, /orchestrator\s+`36154418182`/);
  assert.match(evidence, /bootstrap child\s+`36154779191`/);
  assert.match(evidence, /`INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED \/ HTTP_502 \/ functionError=PRESENT`/);
  assert.match(evidence, /`RECOVERY_REQUIRED \/ STAGING_RUN_PRESENT`/);
  assert.match(evidence, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(evidence, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(evidence, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(evidence, /may dispatch only the recovery workflow/);
});

test('the full recovery after the repeated HTTP 502 remains privacy-safe and preserves the root-cause circuit', () => {
  const evidence = runbook.match(
    /### Full recovery confirms unchanged durable diagnostics on `9ac9e55b64ab71f9fd75134080982b69024714db`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the exact full-recovery diagnostics must be retained');
  assert.match(evidence, /Full read-only recovery `36156171335`/);
  assert.match(evidence, /`AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`/);
  assert.match(evidence, /`COMPLETE_CURRENT_RUN_ONLY`/);
  assert.match(evidence, /`STALE_STAGING_CURRENT_STATE_EMPTY`/);
  assert.match(evidence, /`EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`/);
  assert.match(evidence, /signature\nsurvived the source-lifetime correction/);
  assert.match(evidence, /`BLOCKED_NEEDS_ROOT_CAUSE`/);
  assert.match(evidence, /does not authorize another bootstrap/);
});

test('the 1g memory-envelope attempt authorizes only full read-only revision classification next', () => {
  const evidence = runbook.match(
    /### Full read-only classification required after memory-envelope attempt on `388c13db5d55bb7ea97d1ba965c8d5ef5e05384e`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the exact post-memory-change failure must be recorded');
  assert.match(evidence, /orchestrator `36159628640`/);
  assert.match(evidence, /bootstrap child `36159946320`/);
  assert.match(evidence, /`INITIAL_BOOTSTRAP_RUNTIME_FAILED \/ REFERENCE_APPLICATION_SEMANTIC_FAILED \/\s+REVISION_EVIDENCE_PREPARATION`/);
  assert.match(evidence, /`RECOVERY_REQUIRED \/ STAGING_RUN_PRESENT`/);
  assert.match(evidence, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(evidence, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(evidence, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(evidence, /No bootstrap or resume follows/);
});

test('CONTROLLED_REBUILD_REQUIRED post-invoke state requires fresh read-only classification', () => {
  const evidence = runbook.match(
    /### Full classification required after `CONTROLLED_REBUILD_REQUIRED` on `79fdc6e669c16e8fb363eac4f28edc679f72f113`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the controlled-rebuild boundary must be classified on the current SHA');
  assert.match(evidence, /orchestrator `36168126324`/);
  assert.match(evidence, /bootstrap child `36168468708`/);
  assert.match(evidence, /STOP \/ INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED/);
  assert.match(evidence, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(evidence, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(evidence, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(evidence, /open #630 authority/);
});

test('revision payload resource exhaustion fix arms only a read-only recovery successor', () => {
  const evidence = runbook.match(
    /### RESOURCE_EXHAUSTED in application revision payload batch on `b729820a10890707e3bc5b0116ca9d4d4af6c253`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the controlled-preparation resource-exhaustion evidence must be retained');
  assert.match(evidence, /controlled-preparation probe `36171271614`/);
  assert.match(evidence, /RESOURCE_EXHAUSTED.*REVISION_PAYLOAD_BATCH/s);
  assert.match(evidence, /`REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT` to 64 KiB/);
  assert.match(evidence, /PR authorizes no bootstrap invoke/);
  assert.match(evidence, /fresh full recovery runs on exact main/);
  assert.match(evidence, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(evidence, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
});

test('64 KiB batch diagnostic records exact read-only evidence and cannot arm a write path', () => {
  const evidence = runbook.match(
    /### 64 KiB revision-batch diagnostic after repeated `RESOURCE_EXHAUSTED` on `05c5578d5c409f4268fe7dd321f6ccaf96f597c0`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the latest exact-main controlled-preparation evidence must be recorded');
  assert.match(evidence, /Full read-only recovery `36177432399`/);
  assert.match(evidence, /Controlled-preparation-only recovery `36177689818`/);
  assert.match(evidence, /REVISION_PAYLOAD_BATCH/);
  assert.match(evidence, /`SINGLE_REVISION_EXCEEDS_64_KIB`/);
  assert.match(evidence, /no row\s+values, payload sizes, source identifiers, or provider exception text/);
  assert.match(evidence, /does not arm\s+controlled preparation, readiness, orchestrator, bootstrap, or controlled rebuild/);
  assert.match(evidence, /tests\/tooling\/r1-initial-bootstrap-recovery-autocontinue-workflow\.test\.mjs/);
});

test('the latest controlled-preparation failure stops before revision payload planning', () => {
  const evidence = runbook.match(
    /#### Controlled-preparation probe on `991bcd61f24afc510e3d3c8b1e07221fe5ddc958`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the latest exact-SHA controlled-preparation result must be retained');
  assert.match(evidence, /recovery `36221325448` completed/);
  assert.match(evidence, /`APPLICATION_BOOTSTRAP_OBSERVATION_INVALID`/);
  assert.match(evidence, /`RESUME_CONTEXT_READ`/);
  assert.match(evidence, /`VIKA_MEMBER_READ`/);
  assert.match(evidence, /`RESOURCE_EXHAUSTED`/);
  assert.match(evidence, /revision payload batch: `UNOBSERVED`/);
  assert.match(evidence, /Do not repeat controlled preparation, dispatch WU7/);
});

test('reference-read correction remains one read-only candidate tied to the observed third-query failure', () => {
  const evidence = runbook.match(
    /#### Bounded reference-read correction candidate on `73b7ce18eb5b50c033289d3bbf8c89233a8ae5d9`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the reference-read failure hypothesis must be bounded and evidenced');
  assert.match(evidence, /third sequential `READ` \(`family_members`\)/);
  assert.match(evidence, /one read-only tagged `UNION ALL` statement/);
  assert.match(evidence, /synthetic adapter fixture reproduces `RESOURCE_EXHAUSTED`/);
  assert.match(evidence, /not a claim that the provider quota or gRPC cause is proven/);
  assert.match(evidence, /one fresh full read-only recovery and one controlled-preparation-only read-only probe/);
  assert.match(evidence, /does not\nauthorize WU7, bootstrap replay, or cap increase/);
});

test('reference validation taxonomy follows the latest unclassified read-only result', () => {
  const evidence = runbook.match(
    /#### Reference snapshot validation classification gap on `450b6761bf59383c644c918223b5274542ae119d`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the post-correction read-only result must remain in the runbook');
  assert.match(evidence, /full read-only recovery `36225185084`/);
  assert.match(evidence, /controlled-preparation-only read-only probe `36225371541`/);
  assert.match(evidence, /`REFERENCE_SNAPSHOT_READ`/);
  assert.match(evidence, /query-error, gRPC status and revision batch `UNOBSERVED`/);
  assert.match(evidence, /allowlisted\s+reference-validation enum/);
  assert.match(evidence, /only `REFERENCE_SNAPSHOT_VALIDATED` plus `READY`/);
});
