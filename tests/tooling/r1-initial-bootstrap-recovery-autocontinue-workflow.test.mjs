import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile(
  new URL('../../.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');
const recoveryWorkflow = (await readFile(
  new URL('../../.github/workflows/r1-initial-bootstrap-recovery.yml', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');
const historyClassifier = (await readFile(
  new URL('../../scripts/classify-r1-recovery-deploy-attempt-history.mjs', import.meta.url),
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
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.match(workflow, /uses: actions\/checkout@v4\s+with:\s+ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\s+persist-credentials: false/);
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Recovery-Probe: READY/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_DURABLE_CLASSIFICATION/);
  assert.match(workflow, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(workflow, /Recovery-Version-Run-ID/);
  assert.match(workflow, /test\("\^R1 #\[1-9\]\[0-9\]\*:"\)/);
  assert.match(workflow, /capture\("\^R1 #\(\?<number>\[1-9\]\[0-9\]\*\):"\)\.number/);
  assert.match(workflow, /all\(\.\[\]; \.filename \| IN\(/);
  assert.match(workflow, /tests\/tooling\/initial-bootstrap-recovery-workflow\.test\.mjs/);
  assert.match(workflow, /scripts\/classify-yandex-initial-bootstrap-recovery-deploy\.mjs/);
  assert.match(workflow, /scripts\/classify-r1-recovery-deploy-attempt-history\.mjs/);
  assert.match(workflow, /tests\/tooling\/r1-recovery-deploy-attempt-history\.test\.mjs/);
  assert.match(workflow, /tests\/tooling\/initial-bootstrap-recovery-deploy-classifier\.test\.mjs/);
  assert.match(workflow, /reuse_deploy_attempt_run_id/);
  assert.match(workflow, /reuse_failed_recovery_run_id/);
  assert.match(workflow, /reuse_source_pr_number/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_REUSE_SOURCE_RUN_NOT_EXACT/);
  assert.match(workflow, /echo "R1_RECOVERY_AUTOCONTINUE_REUSE_\$\{intervening_result\}"/);
  assert.match(historyClassifier, /INTERVENING_RECOVERY_PREINVOKE_STOP_PROVEN/);
  assert.match(historyClassifier, /INTERVENING_RECOVERY_PHASE_NOT_PROVEN/);
  assert.match(workflow, /newer_recovery_count/);
  assert.match(workflow, /actions\/workflows\/r1-initial-bootstrap-recovery-deploy-attempt\.yml\/runs/);
  assert.match(workflow, /\.workflow_id\|type=="number"/);
  assert.doesNotMatch(workflow, /\.name=="R1 initial bootstrap recovery deploy-only attempt"/);
  assert.doesNotMatch(workflow, /\.name == "R1 initial bootstrap recovery deploy-only attempt"/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_REUSE_CHANGESET_INVALID/);
  assert.match(workflow, /Recovery-Version-Run-ID/);
  assert.match(workflow, /"surface_only":"true"/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_WRITER_ACTIVE/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml/);
  assert.match(recoveryWorkflow, /functions\/\$\{PRIHRASH_YC_FUNCTION_ID\}:tagHistory/);
  assert.match(recoveryWorkflow, /--audit-source-decision/);
  assert.match(recoveryWorkflow, /Publish enum-only accepted-version proof outcome/);
  assert.match(workflow, /"\$api\/actions\/workflows\/\$recovery_workflow\/dispatches"/);
  assert.doesNotMatch(workflow, /r1-yandex-readiness\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml\/dispatches/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('reuse source run selection follows the exact workflow endpoint and dynamic run-name response shape', (t) => {
  const filter = workflow.match(/--argjson id "\$source_reuse_run_id" --arg expected[\s\S]*?'\n([\s\S]*?)\n\s*' <<<"\$reuse_attempts"/)?.[1];
  assert.ok(filter, 'extract the live source-run selection filter');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }
  const expected = 'R1 recovery-only deploy attempt for failed run 36341844854';
  const validRun = {
    id: 36611387299,
    name: expected,
    display_title: expected,
    workflow_id: 370292276,
    head_branch: 'main',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  };
  const select = (workflowRuns) => {
    const result = spawnSync('jq', [
      '-e', '--argjson', 'id', '36611387299', '--arg', 'expected', expected,
      filter,
    ], { input: JSON.stringify({ workflow_runs: workflowRuns }), encoding: 'utf8' });
    if (result.status !== 0) return false;
    return result.stdout.trim() === 'true';
  };
  assert.equal(select([validRun]), true);
  assert.equal(select([{ ...validRun, name: 'R1 initial bootstrap recovery deploy-only attempt' }]), true);
  assert.equal(select([{ ...validRun, workflow_id: undefined }]), false);
  assert.equal(select([validRun, { ...validRun }]), false);
  assert.equal(select([{ ...validRun, conclusion: 'failure' }]), false);
});

test('reuse caller delegates intervening recovery classification to the shared exact-run fixture-tested classifier', () => {
  assert.match(workflow, /node scripts\/classify-r1-recovery-deploy-attempt-history\.mjs \\\s+intervening-recovery/);
  assert.match(workflow, /intervening_result" != 'INTERVENING_RECOVERY_PREINVOKE_STOP_PROVEN'/);
  assert.match(workflow, /"\$SOURCE_SHA" "\$source_failed_sha" "\$source_workflow_id"/);
  assert.match(workflow, /newer_recovery_count.*[\s\S]*?R1_RECOVERY_AUTOCONTINUE_REUSE_INTERVENING_RECOVERY_HISTORY_AMBIGUOUS/);
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
    recoveryFunctionDeployAttempt: false,
    recoveryVersionReuse: false,
    recoveryRunId: null,
    recoveryVersionRunId: null,
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
    recoveryFunctionDeployAttempt: false,
    recoveryVersionReuse: false,
    recoveryRunId: null,
    recoveryVersionRunId: null,
    regressionTest: 'tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
  });
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_RESUMABLE',
  }), {
    valid: true,
    surfaceOnly: false,
    functionDeployRecovery: false,
    recoveryVersionReuse: false,
    recoveryFunctionDeployAttempt: false,
    recoveryRunId: null,
    recoveryVersionRunId: null,
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
    recoveryVersionReuse: false,
    recoveryFunctionDeployAttempt: false,
    recoveryRunId: '36341844854',
    recoveryVersionRunId: null,
    regressionTest: 'tests/tooling/initial-bootstrap-recovery-deploy-recovery-workflow.test.mjs',
  });
  assert.equal(parse({ 'Recovery-Run-ID': '0' }).valid, false);
  assert.equal(parse({ 'Recovery-Run-ID': '36341844854\nRecovery-Run-ID: 36341844854' }).valid, false);
  assert.equal(parse({ 'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION' }).valid, false);
  assert.equal(parse({ 'Provider-Attempt': 'READY' }).valid, false);
});

test('Owner-authorized recovery Function create marker arms exactly one deploy-only run for the proven failed run', (t) => {
  const filter = workflow.match(/marker="\$\(jq -Rn --arg body "\$source_pr_body" '\n([\s\S]*?)\n          '\)"/)?.[1];
  assert.ok(filter, 'extract the live jq marker filter from the workflow');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }

  const parse = (overrides = {}) => {
    const lines = {
      'Provider-Attempt': 'READY',
      'Observed-Signature': 'INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED',
      'Expected-Transition': 'RECOVERY_ONLY_FUNCTION_VERSION_CREATE_CLASSIFIED',
      'Recovery-State': 'DEPLOYMENT_OUTCOME_UNCLASSIFIED',
      'Circuit-Rearm': 'OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY',
      'Recovery-Run-ID': '36341844854',
      'Regression-Test': 'tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs',
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
    functionDeployRecovery: false,
    recoveryFunctionDeployAttempt: true,
    recoveryVersionReuse: false,
    recoveryRunId: '36341844854',
    recoveryVersionRunId: null,
    regressionTest: 'tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs',
  });
  assert.equal(parse({ 'Provider-Attempt': 'NOT_AUTHORIZED' }).valid, false);
  assert.equal(parse({ 'Recovery-Run-ID': '36341844855' }).valid, false);
  assert.equal(parse({ 'Circuit-Rearm': 'ROOT_CAUSE_FIX' }).valid, false);
  assert.equal(parse({ 'Recovery-Probe': 'READY' }).valid, false);
  assert.equal(parse({ 'Recovery-Run-ID': '36341844854\nRecovery-Run-ID: 36341844854' }).valid, false);
});

test('accepted-version recovery marker arms only reuse of its exact deploy run, not another create', (t) => {
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
      'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
      'Recovery-State': 'STAGING_PRESENT_UNCLASSIFIED',
      'Recovery-Run-ID': '36341844854',
      'Recovery-Version-Run-ID': '36611387299',
      'Regression-Test': 'tests/tooling/initial-bootstrap-recovery-workflow.test.mjs',
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
    functionDeployRecovery: false,
    recoveryVersionReuse: true,
    recoveryFunctionDeployAttempt: false,
    recoveryRunId: '36341844854',
    recoveryVersionRunId: '36611387299',
    regressionTest: 'tests/tooling/initial-bootstrap-recovery-workflow.test.mjs',
  });
  assert.equal(parse({ 'Recovery-Version-Run-ID': '0' }).valid, false);
  assert.equal(parse({ 'Recovery-Version-Run-ID': '36611387299\nRecovery-Version-Run-ID: 36611387299' }).valid, false);
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

test('PR-841 records the exact regression-path pre-dispatch stop without provider activity', () => {
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

test('PR-842 changeset pre-dispatch stop identifies only the unrelated AGENTS requirement', () => {
  const evidence = runbook.match(
    /### Second read-only deploy-classification dispatch was gated before provider on `d284ee221602f80e528a510d3f1d45272f987997`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the second pre-provider autocontinue stop must be documented');
  assert.match(evidence, /`R1_RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID`/);
  assert.match(evidence, /guard's additional requirement\s+that `AGENTS\.md` also change was unrelated/);
  assert.match(evidence, /No deploy-recovery workflow run was created/);
  assert.match(evidence, /neither prior autocontinue reached the provider/);
});

test('consumed deploy classification remains unknown and classifier enum refinement does not re-arm provider work', () => {
  const evidence = runbook.match(
    /#### Read-only deploy classifier result was not sufficiently discriminating([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the consumed read-only provider evidence and limit must remain explicit');
  assert.match(evidence, /`CREATE_OPERATION_NOT_UNIQUE`/);
  assert.match(evidence, /does not prove which condition occurred/);
  assert.match(evidence, /Do not replay the consumed provider query/);
  assert.match(evidence, /`CREATE_OPERATION_NOT_OBSERVED` and\s+`CREATE_OPERATION_AMBIGUOUS`/);
  assert.match(evidence, /consumes no\s+additional provider classification for run `36341844854`/);
});

test('owner probe authority permits only one new-SHA metadata reclassification after the parser correction', () => {
  const evidence = runbook.match(
    /Owner subsequently authorized read-only probes across R1([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the explicit R1 read-only probe authorization must be documented');
  assert.match(evidence, /one additional full provider\s+metadata classification for the same failed run on a new exact-main SHA/);
  assert.match(evidence, /`Provider-Attempt: NOT_AUTHORIZED`/);
  assert.match(evidence, /does not\s+re-run the failed deploy and does not invoke Function, Google or\s+YDB/);
  assert.match(evidence, /Each subsequent refinement must follow the standing delegation/);
  assert.match(evidence, /Same-query blind replay remains prohibited/);
});

test('owner-delegated follow-up distinguishes recovery-tagged version candidates without inferring application', () => {
  const evidence = runbook.match(
    /Owner's standing R1 probe delegation permits one next exact-main diagnostic([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the bounded post-parser read-only probe must be documented');
  assert.match(evidence, /`CREATE_OPERATION_NOT_OBSERVED`/);
  assert.match(evidence, /`RECOVERY_TAGGED_VERSION_CANDIDATE_PRESENT`/);
  assert.match(evidence, /`RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`/);
  assert.match(evidence, /none of these declare `APPLIED`\/`NOT_APPLIED`/);
  assert.match(evidence, /does not invoke Function,\s+read Google or access YDB/);
  assert.match(evidence, /Regression-Test: tests\/tooling\/initial-bootstrap-recovery-deploy-classifier\.test\.mjs/);
});

test('PR-847 changeset gate stop preserves Owner authority and permits only a classifier refinement successor', () => {
  const evidence = runbook.match(
    /### PR #847 read-only version-window probe remained pre-dispatch gated on `0b07238c0d152c803fa04019e1e899422cd58eb1`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the PR-847 pre-dispatch result and no-provider boundary must be retained');
  assert.match(evidence, /`R1_RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID`/);
  assert.match(evidence, /no provider state was read/);
  assert.match(evidence, /successor changeset guard accepts either a marker-only caller correction/);
  assert.match(evidence, /classifier\/root-cause correction/);
  assert.match(evidence, /Owner-authorized\s+version\/tag-window\s+classification remained unconsumed/);
});

test('PR-848 read-only diagnostic failure is recorded as consumed and arms only classifier refinement', () => {
  const evidence = runbook.match(
    /### PR #848 exact-run read-only classifier completed with diagnostic failure on `2052041417e58ac7d183a2eaca0b63d3ec0b815f`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact provider read-only result must be recorded');
  assert.match(evidence, /published only\s+`DIAGNOSTIC_FAILED`/);
  assert.match(evidence, /probe is consumed/);
  assert.match(evidence, /No Function version\s+was created or invoked/);
  assert.match(evidence, /does not infer which condition occurred/);
});

test('PR-849 classifier refinement records malformed version-list evidence without inferring deployment outcome', () => {
  const evidence = runbook.match(
    /### PR #849 read-only refinement isolated version-list entry metadata on `853413ce3cff72923e4d76476a2ad6953e176d04`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact read-only classifier refinement result must be retained');
  assert.match(evidence, /published only `RECOVERY_VERSION_LIST_ENTRY_INVALID`/);
  assert.match(evidence, /does not determine which record field was malformed/);
  assert.match(evidence, /does not classify deploy application state/);
  assert.match(evidence, /The next repository-only discriminator splits/);
});

test('PR-850 read-only result and Yandex repeated-tag schema proof arm only the omitted-tags correction', () => {
  const evidence = runbook.match(
    /### PR #850 metadata-only refinement classified the invalid version-list field as tags on `adbbcc0fb1ff06bc12db7e3b31feae082569c8c1`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact read-only tags result and schema contract must be recorded');
  assert.match(evidence, /published only `RECOVERY_VERSION_TAGS_INVALID`/);
  assert.match(evidence, /`Version\.tags` is declared `repeated string`/);
  assert.match(evidence, /omitted `tags` property means the known empty repeated field/);
  assert.match(evidence, /explicit null or a wrong type remains invalid/);
});

test('PR-851 no-current-tag result stays unknown and arms only bounded tag-history classification', () => {
  const evidence = runbook.match(
    /### PR #851 read-only current-version classification found no tagged candidate in the failed-run window on `a18d67c6b44b6c2e7da5cc67aa4f1c9957c30f72`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the current-tag absence result and next diagnostic boundary must be retained');
  assert.match(evidence, /published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`/);
  assert.match(evidence, /does not prove `NOT_APPLIED`/);
  assert.match(evidence, /`ListTagHistory` API/);
  assert.match(evidence, /`next_page_token` is empty/);
});

test('PR-852 tag-history absence remains unclassified and records the distinct runtime/deployer identity fix', () => {
  const evidence = runbook.match(
    /### PR #852 schema-backed tag-history read returned no in-window recovery candidate on `efea1dc6e3f76e7136c14026b9ba8f402cb34b15`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact tag-history result and newly found classifier mismatch must be recorded');
  assert.match(evidence, /published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`/);
  assert.match(evidence, /failed deployment remains unclassified/);
  assert.match(evidence, /runtime service account to the WIF deployment caller ID/);
  assert.match(evidence, /different roles/);
});

test('PR-855 exact-run metadata completion retains the unknown deploy stop boundary', () => {
  const evidence = runbook.match(
    /### PR #855 bounded metadata lists completed the exact failed-run classification on `78c9f162c5c9ec172ab39b2d99f7f488002d3cc3`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the final bounded metadata classification and stop state must be documented');
  assert.match(evidence, /published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`/);
  assert.match(evidence, /Both Function version and operation lists were below the 1000-entry incomplete boundary/);
  assert.match(evidence, /No `APPLIED`\/`NOT_APPLIED` outcome is inferred/);
  assert.match(evidence, /Do not redeploy\/invoke, replay or clean up/);
});

test('Owner audit-source authorization remains read-only and keeps IAM changes separate', () => {
  assert.match(runbook, /Owner-authorized read-only audit source opening for exact recovery run `36341844854`/);
  assert.match(runbook, /TrailService\.List/);
  assert.match(runbook, /`audit-trails\.viewer`/);
  assert.match(runbook, /`logging\.reader`/);
  assert.match(runbook, /This PR does not add or remove IAM bindings/);
  assert.match(runbook, /Permission-denied, missing trail, unsupported destination, ambiguous source/);
});

test('PR-857 permission denial records the exact audit source blocker and preserves its no-IAM-mutation result', () => {
  const evidence = runbook.match(
    /### PR #857 audit source read stopped at existing WIF permission boundary on `3c89bf799e4765822df583af6c846dc40680074e`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact audit read permission denial and no-IAM-mutation boundary must be retained');
  assert.match(evidence, /`AUDIT_TRAIL_LIST_PERMISSION_DENIED`/);
  assert.match(evidence, /audit log read was not attempted/);
  assert.match(evidence, /No IAM binding changed/);
  assert.match(evidence, /`audit-trails\.auditor` on the Function folder/);
  assert.match(evidence, /`logging\.reader` only on its exact Cloud Logging group/);
});

test('Owner-authorized temporary viewer binding was exact-scope and read-only before the new-SHA probe', () => {
  const evidence = runbook.match(
    /### Owner-authorized temporary Audit Trails viewer and HTTP failure refinement([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the authorized temporary role and its classification stop boundary must be recorded');
  assert.match(evidence, /latest failed recovery/);
  assert.match(evidence, /`audit-trails\.viewer` binding was added only to that WIF identity at the Function folder/);
  assert.match(evidence, /Before PR #859's new-SHA probe, no provider source query had run since the grant/);
  assert.match(evidence, /`AUDIT_TRAIL_AUTHENTICATION_REQUIRED` for 401/);
  assert.match(evidence, /`AUDIT_TRAIL_LIST_PERMISSION_DENIED` for 403/);
  assert.match(evidence, /all temporary bindings must be removed with independent after-read verification/);
});

test('PR-859 Audit Trails classification records the missing source and verified temporary-role removal', () => {
  const evidence = runbook.match(
    /### PR #859 exact-main Audit Trails query found no Function-folder source; temporary viewer was removed([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact-main audit-source result and role-revocation proof must be retained');
  assert.match(evidence, /Workflow `36442125610`/);
  assert.match(evidence, /`AUDIT_TRAIL_SOURCE_NOT_CONFIGURED`/);
  assert.match(evidence, /`AUDIT_EVENT_READ_NOT_ATTEMPTED`/);
  assert.match(evidence, /No Cloud Logging event read was attempted/);
  assert.match(evidence, /an independent folder binding read confirms it is absent/);
  assert.match(evidence, /No `logging\.reader` role was added/);
  assert.match(evidence, /does not classify the Function-version deployment as `APPLIED` or `NOT_APPLIED`/);
});

test('PR-861 cloud refinement records pre-list Folder Get denial and arms only the new Cloud-ID path', () => {
  const evidence = runbook.match(
    /### PR #861 recovery stopped at Folder Get before Audit Trails List; Cloud viewer was not yet bound([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the consumed Folder Get failure and new diagnostic discriminator must be recorded');
  assert.match(evidence, /recovery `36452570754`/);
  assert.match(evidence, /`AUDIT_TRAIL_FOLDER_METADATA_PERMISSION_DENIED`/);
  assert.match(evidence, /Audit Trails List was not attempted/);
  assert.match(evidence, /`AUDIT_EVENT_READ_NOT_ATTEMPTED`/);
  assert.match(evidence, /no WIF viewer/);
  assert.match(evidence, /dedicated masked `YC_R1_CLOUD_ID` GitHub secret/);
  assert.match(evidence, /removes the denied Folder Get dependency/);
  assert.match(evidence, /before merge, so the one post-merge exact-main autocontinue does not race the authorization/);
});

test('PR-862 Cloud metadata enum remains stage-ambiguous and records verified Cloud-role removal', () => {
  const evidence = runbook.match(
    /### PR #862 cloud inventory\/trail classifier returned one ambiguous metadata enum; event read did not run([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact cloud-inventory result and stop condition must be retained');
  assert.match(evidence, /workflow `36457545606`/);
  assert.match(evidence, /`AUDIT_TRAIL_METADATA_INVALID`/);
  assert.match(evidence, /available evidence does not establish whether per-folder TrailService\.List ran/);
  assert.match(evidence, /`AUDIT_EVENT_READ_NOT_ATTEMPTED`/);
  assert.match(evidence, /temporary Cloud `audit-trails\.viewer` binding was removed/);
  assert.match(evidence, /emits distinct enums for these conditions/);
  assert.match(evidence, /No same-SHA replay or event query is authorized/);
});

test('PR-863 Folder-status refinement records stage-ambiguous metadata and Cloud-viewer revocation', () => {
  const evidence = runbook.match(
    /### PR #863 refined Folder statuses; Cloud source classifier still returned ambiguous metadata([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the exact Cloud inventory result and permission cleanup must be retained');
  assert.match(evidence, /recovery `36460606358`/);
  assert.match(evidence, /`AUDIT_TRAIL_METADATA_INVALID`/);
  assert.match(evidence, /`AUDIT_EVENT_READ_NOT_ATTEMPTED`/);
  assert.match(evidence, /shared enum does not establish whether per-folder TrailService\.List ran/);
  assert.match(evidence, /temporary Cloud `audit-trails\.viewer` binding was removed/);
  assert.match(evidence, /next new-SHA synthetic refinement splits response\/entry\/ID\/cloudId\/status failures/);
});

test('PR-864 cloud Trail metadata failure remains unknown and records temporary-role revocation', () => {
  const evidence = runbook.match(
    /### PR #864 Cloud source classifier still returned the generic enum; temporary Cloud viewer revoked([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the trail-metadata validation result and Cloud-role cleanup must be retained');
  assert.match(evidence, /Recovery autocontinue `36462701288`/);
  assert.match(evidence, /recovery `36462743638`/);
  assert.match(evidence, /`AUDIT_TRAIL_METADATA_INVALID`/);
  assert.match(evidence, /`AUDIT_EVENT_READ_NOT_ATTEMPTED`/);
  assert.match(evidence, /shared enum does not distinguish inventory, TrailService\.List response, or trail-entry validation/);
  assert.match(evidence, /temporary Cloud `audit-trails\.viewer` binding was removed/);
  assert.match(evidence, /No same-SHA replay is allowed/);
});

test('PR-865 Cloud trail list response remains unclassified and records viewer removal', () => {
  const evidence = runbook.match(
    /### PR #865 TrailService\.List response-shape refinement still stopped before event reads([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the latest list-response classification and binding cleanup must be retained');
  assert.match(evidence, /recovery `36469918792`/);
  assert.match(evidence, /`AUDIT_TRAIL_TRAIL_LIST_RESPONSE_INVALID`/);
  assert.match(evidence, /`AUDIT_EVENT_READ_NOT_ATTEMPTED`/);
  assert.match(evidence, /Cloud viewer was removed after this run and independently verified absent/);
  assert.match(evidence, /splits those cases/);
  assert.match(evidence, /no same-SHA replay/);
});

test('PR-867 recovery result is the current Audit Trails source decision boundary', () => {
  const evidence = runbook.match(
    /### PR #867 Audit Trails source decision after omitted protobuf repeated field on `e4121479ac3d0c5360af4a7ca8037be4cd6a8a3e`([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the latest exact-main source decision and provider stop condition must be recorded');
  assert.match(evidence, /recovery `36476636505`/);
  assert.match(evidence, /`AUDIT_TRAIL_TRAILS_FIELD_INVALID`/);
  assert.match(evidence, /`TrailService\.List`/);
  assert.match(evidence, /Cloud `audit-trails\.viewer` binding was absent/);
  assert.match(evidence, /protobuf JSON omitting an empty repeated field/);
  assert.match(evidence, /NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE/);
  assert.match(evidence, /SOURCE_EVIDENCE_UNUSABLE/);
});

test('PR-866 exact CI list lookup failure is recorded before any Yandex authentication', () => {
  const evidence = runbook.match(
    /### PR #866 recovery stopped at the GitHub exact-CI lookup before Yandex authentication([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(evidence, 'the pre-provider exact-CI failure and no-provider boundary must be retained');
  assert.match(evidence, /recovery child `36473228760`/);
  assert.match(evidence, /`RECOVERY_DEPLOY_EXACT_SHA_CI_MISSING`/);
  assert.match(evidence, /Yandex CLI installation and OIDC token exchange were skipped/);
  assert.match(evidence, /no Yandex metadata\/list query/);
  assert.match(evidence, /Cloud viewer remained absent/);
  assert.match(evidence, /exact successful triggering CI run ID/);
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
