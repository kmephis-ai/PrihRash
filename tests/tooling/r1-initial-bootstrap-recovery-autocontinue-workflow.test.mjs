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
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml/);
  assert.match(workflow, /"\$api\/actions\/workflows\/\$recovery_workflow\/dispatches"/);
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

  assert.deepEqual(valid(), {
    valid: true,
    surfaceOnly: true,
    functionDeployRecovery: false,
    recoveryRunId: null,
    regressionTest: 'tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
  });
  assert.equal(valid({ 'Provider-Attempt': 'READY' }).valid, false);
  assert.equal(valid({ 'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION' }).valid, false);
  assert.equal(valid({ 'Recovery-State': 'UNKNOWN_AFTER_NON_SUCCESS\nRecovery-State: UNKNOWN_AFTER_NON_SUCCESS' }).valid, false);
  assert.equal(valid({ 'Recovery-State': 'STAGING_RESUMABLE' }).valid, false);
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_PRESENT_UNCLASSIFIED',
  }), {
    valid: true,
    surfaceOnly: false,
    functionDeployRecovery: false,
    recoveryRunId: null,
    regressionTest: 'tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
  });
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_RESUMABLE',
  }), {
    valid: true,
    surfaceOnly: false,
    functionDeployRecovery: false,
    recoveryRunId: null,
    regressionTest: 'tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
  });
});

test('unknown recovery Function deploy accepts only one exact-run read-only classification marker', (t) => {
  const filter = workflow.match(/marker="\$\(jq -Rn --arg body "\$source_pr_body" '\n([\s\S]*?)\n          '\)"/)?.[1];
  assert.ok(filter, 'extract the live jq marker filter from the workflow');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }

  const parse = (overrides = {}) => {
    const lines = {
      'Provider-Attempt': 'NOT_AUTHORIZED',
      'Recovery-Probe': 'READY',
      'Expected-Transition': 'READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION',
      'Recovery-State': 'DEPLOYMENT_OUTCOME_UNCLASSIFIED',
      'Recovery-Run-ID': '36341844854',
      'Regression-Test': 'tests/tooling/initial-bootstrap-recovery-deploy-recovery-workflow.test.mjs',
      ...overrides,
    };
    const body = Object.entries(lines).map(([key, value]) => `${key}: ${value}`).join('\n');
    const result = spawnSync('jq', ['-Rn', '--arg', 'body', body, filter], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  assert.deepEqual(parse(), {
    valid: true,
    surfaceOnly: false,
    functionDeployRecovery: true,
    recoveryRunId: '36341844854',
    regressionTest: 'tests/tooling/initial-bootstrap-recovery-deploy-recovery-workflow.test.mjs',
  });
  assert.equal(parse({ 'Recovery-Run-ID': '0' }).valid, false);
  assert.equal(parse({ 'Recovery-Run-ID': '36341844854\nRecovery-Run-ID: 36341844854' }).valid, false);
  assert.equal(parse({ 'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION' }).valid, false);
  assert.equal(parse({ 'Provider-Attempt': 'READY' }).valid, false);
});

test('post-PR-840 deployment failure remains unclassified and disarms deployment/invocation', () => {
  const evidence = runbook.match(
    /### Recovery Function deploy outcome remains unknown after exact-main run `36341844854`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the failed recovery Function-version create needs a fresh exact-run read-only path');
  assert.match(evidence, /`Deploy recovery-only Function version`/);
  assert.match(evidence, /`Invoke exact read-only recovery tag once` step was `skipped`/);
  assert.match(evidence, /`INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED`/);
  assert.match(evidence, /outcome of the Yandex Function-version create operation is unknown/);
  assert.match(evidence, /Do not repeat the Function-version create or invoke its tag/);
  assert.match(evidence, /Expected-Transition: READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION/);
  assert.match(evidence, /Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED/);
  assert.match(evidence, /Recovery-Run-ID: 36341844854/);
  assert.match(evidence, /no Function-version create, Function invoke, Google read, or YDB read\/write/);
});

test('PR-841 autocontinue changeset guard uses the real recovery-deploy regression path', () => {
  const evidence = runbook.match(
    /### Read-only deploy-classification autocontinue stopped before provider dispatch on `2b6658171b01d5a99f4373e6be8b6152eb2edd29`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact pre-dispatch stop and safe retry boundary must be recorded');
  assert.match(evidence, /`R1_RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID`/);
  assert.match(evidence, /`R1 initial bootstrap recovery deploy recovery` run was created/);
  assert.match(evidence, /no Yandex provider query, deploy,/);
  assert.match(evidence, /read-only classification did not reach the provider,\s+exactly one retry/);
  assert.match(evidence, /Regression-Test: tests\/tooling\/initial-bootstrap-recovery-deploy-recovery-workflow\.test\.mjs/);
  assert.doesNotMatch(evidence, /Regression-Test: tests\/tooling\/r1-initial-bootstrap-recovery-deploy-recovery\.test\.mjs/);
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
  assert.match(evidence, /RESOURCE_EXHAUSTED/);
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

test('tagged reference row-kind split remains privacy-safe and read-only', () => {
  const evidence = runbook.match(
    /#### Reference row-kind diagnostic split on `8f99d2fb2657abbeab5138a0b827730560745c56`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the latest reference parser result and successor boundary must be recorded');
  assert.match(evidence, /probe `36227316895`/);
  assert.match(evidence, /`REFERENCE_READER_MALFORMED_REFERENCE_SNAPSHOT_EVIDENCE`/);
  assert.match(evidence, /`REFERENCE_SNAPSHOT_KIND_MISSING`/);
  assert.match(evidence, /`REFERENCE_SNAPSHOT_KIND_UNKNOWN`/);
  assert.match(evidence, /never emits the tag value, row data, or provider text/);
  assert.match(evidence, /No writer\/WU7 path is permitted/);
});

test('numeric reference tags follow the exact unknown-kind evidence and stay read-only', () => {
  const evidence = runbook.match(
    /#### Numeric reference-row tags after `REFERENCE_SNAPSHOT_KIND_UNKNOWN` on `0e67ba079ff2d259c1054fd772d0b201065e595b`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the latest exact-main unknown-tag result and hypothesis must be recorded');
  assert.match(evidence, /probe `36228428540`/);
  assert.match(evidence, /`REFERENCE_READER_REFERENCE_SNAPSHOT_KIND_UNKNOWN`/);
  assert.match(evidence, /`CAST\(1\|2\|3 AS Uint32\)`/);
  assert.match(evidence, /one new\s+controlled-preparation-only read-only probe/);
  assert.match(evidence, /All other results stay read-only STOP/);
});

test('metadata pagination candidate follows the latest exact-stage RESOURCE_EXHAUSTED evidence', () => {
  const evidence = runbook.match(
    /#### Metadata-scan RESOURCE_EXHAUSTED after numeric reference tags on `0b810880d3e5dea4db1ccd52b66cf0d4de1cde68`([\s\S]*?)(?=\n### |\n## )/,
  )?.[1];

  assert.ok(evidence, 'the latest revision metadata scan failure must drive the next bounded fix');
  assert.match(evidence, /probe `36230537420`/);
  assert.match(evidence, /`REFERENCE_SNAPSHOT_VALIDATED`/);
  assert.match(evidence, /`REVISION_METADATA_SCAN`/);
  assert.match(evidence, /RESOURCE_EXHAUSTED/);
  assert.match(evidence, /128-row \*\*per-query\*\* limit/);
  assert.match(evidence, /does not cap total reconciliation\s+coverage/);
});

test('historical revision timeout candidate switches from sparse PK ranges to exact key reads', () => {
  const evidence = runbook.match(
    /### Exact-key historical revision reads после recovery `36272896579`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];

  assert.ok(evidence, 'the latest read-only historical reconstruction failure must remain documented');
  assert.match(evidence, /`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`/);
  assert.match(evidence, /Enum artifact отсутствует/);
  assert.match(evidence, /не запуска[лн] bootstrap\/write path/);
  assert.match(evidence, /широким primary-key диапазоном/);
  assert.match(evidence, /exact source ids/);
  assert.match(evidence, /cardinality, identity, immutable metadata, canonical\s+payload digest/);
  assert.match(evidence, /ровно один новый exact-main controlled-preparation-only read-only probe/);
  assert.match(evidence, /controlled rebuild, bootstrap replay,\s+retirement и cleanup остаются disarmed/);
});

test('revision-cardinality successor is metadata-only, coarse-bucketed and read-only', () => {
  const evidence = runbook.match(
    /### Диагностика грубой cardinality STAGING revisions после `36275268952`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];

  assert.ok(evidence, 'the repeated bounded invoke failure must lead to a privacy-safe cardinality probe');
  assert.match(evidence, /`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`/);
  assert.match(evidence, /`LT_3000_ROWS`/);
  assert.match(evidence, /`GE_3000_LT_5000_ROWS`/);
  assert.match(evidence, /`GE_5000_ROWS`/);
  assert.match(evidence, /не читает Google, revision payloads, source identifiers и не изменяет YDB/);
  assert.match(evidence, /должны совпасть manifest `rows_seen`, `binding_count` и snapshot `row_count`/);
  assert.match(evidence, /разрешена ровно одна свежая exact-main read-only диагностика cardinality/);
  assert.match(evidence, /он не разрешает controlled preparation,\s+WU7, retirement, cleanup/);
});

test('large revision bucket leads to one-pass paged exact-manifest reconstruction only', () => {
  const evidence = runbook.match(
    /### Однопроходное восстановление revisions после `GE_5000_ROWS`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];

  assert.ok(evidence, 'the GE_5000_ROWS result must drive the next bounded runtime fix');
  assert.match(evidence, /Read-only cardinality diagnostic `36279266156`/);
  assert.match(evidence, /600 s при текущем 10 RU\/s budget/);
  assert.match(evidence, /keyset pages/);
  assert.match(evidence, /не более 9 rows/);
  assert.match(evidence, /Manifest остаётся точным expected source-ID set/);
  assert.match(evidence, /лишний или повторный revision/);
  assert.match(evidence, /ровно один свежий exact-main controlled-preparation-only read-only probe/);
  assert.match(evidence, /controlled rebuild\/WU7, bootstrap replay и cleanup не armed/);
});

test('single-pass timeout leads to a coarse paced-RU estimate rather than a raw row count', () => {
  const evidence = runbook.match(
    /### RU-budget estimate buckets после timeout `36281170917`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];

  assert.ok(evidence, 'the latest exact-main single-pass timeout must drive a bounded diagnostic refinement');
  assert.match(evidence, /`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`/);
  assert.match(evidence, /`GE_5000_ROWS`\s+не позволял отличить budget/);
  assert.match(evidence, /`LT_5000_RU`, `GE_5000_LT_5500_RU`, `GE_5500_LT_6000_RU`, `GE_6000_RU`/);
  assert.match(evidence, /rows \+ число ≤9-row pages \+ pacing\/query margins/);
  assert.match(evidence, /Exact row count, IDs и payload не публикуются/);
  assert.match(evidence, /разрешена ровно одна свежая exact-main `staging_revision_cardinality_only` read-only/);
  assert.match(evidence, /не разрешает controlled-preparation replay,\s+WU7, bootstrap/);
});

test('repeated single-pass timeout leads to a bounded paced-RU bucket before another application probe', () => {
  const evidence = runbook.match(
    /### RU-budget bucket после controlled-preparation timeout `36281170917`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];

  assert.ok(evidence, 'the latest exact-main timeout must select a new read-only cardinality refinement');
  assert.match(evidence, /`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`/);
  assert.match(evidence, /`GE_5000_ROWS` с предыдущей версии оказался слишком широким/);
  assert.match(evidence, /`LT_5000_RU`,\s+`GE_5000_LT_5500_RU`, `GE_5500_LT_6000_RU`, `GE_6000_RU`/);
  assert.match(evidence, /9 rows\/page/);
  assert.match(evidence, /На одном metadata-only\s+manifest read/);
  assert.match(evidence, /GE_6000_RU.*600 s × 10 RU\/s/s);
  assert.match(evidence, /ровно одна свежая exact-main cardinality-only read-only probe/);
  assert.match(evidence, /не разрешает повтор controlled preparation, WU7, quota change/);
});
