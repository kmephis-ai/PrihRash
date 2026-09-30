import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  classifyRecoveryDeployAttemptHistory,
  classifyRecoveryReuseInterveningRun,
  classifyRecoveryVersionReuseSourceHistory,
} from '../../scripts/classify-r1-recovery-deploy-attempt-history.mjs';

const failedRecoveryRunId = '36341844854';
const attemptTitle = `R1 recovery-only deploy attempt for failed run ${failedRecoveryRunId}`;
const currentSha = 'b'.repeat(40);
const deployWorkflowId = 370292276;

function run(overrides = {}) {
  return {
    id: 99,
    name: attemptTitle,
    workflow_id: deployWorkflowId,
    head_branch: 'main',
    event: 'workflow_dispatch',
    display_title: attemptTitle,
    head_sha: 'a'.repeat(40),
    status: 'completed',
    ...overrides,
  };
}

function jobs(conclusion) {
  return { jobs: [{
    name: 'deploy-only-attempt',
    steps: [{
      name: 'Create exactly one read-only recovery Function version without invoking it',
      conclusion,
    }],
  }] };
}

function classify(runs, jobList = { jobs: [] }, overrides = {}) {
  return classifyRecoveryDeployAttemptHistory({
    runs,
    jobs: jobList,
    currentRunId: '100',
    currentSha,
    failedRecoveryRunId,
    ...overrides,
  });
}

test('no previous matching attempt leaves the owner one-shot available', () => {
  assert.equal(classify({ workflow_runs: [] }), 'NO_PRIOR_ATTEMPT');
});

test('a previous pre-provider stop is distinguishable from a consumed create attempt', () => {
  assert.equal(classify({ workflow_runs: [run()] }, jobs('skipped')), 'PRIOR_PREWRITE_STOP_ONLY');
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    assert.equal(classify({ workflow_runs: [run()] }, jobs(conclusion)), 'PRIOR_ATTEMPT_CONSUMED');
  }
});

test('reuse accepts only one exact intervening read-only verification failure with deploy and invoke skipped', () => {
  const runRecord = {
    id: 36643931461,
    name: 'R1 initial bootstrap recovery',
    workflow_id: 370292276,
    head_branch: 'main',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    head_sha: 'c'.repeat(40),
  };
  const jobRecord = (overrides = {}) => ({ jobs: [{
    name: 'initial-bootstrap-recovery',
    conclusion: 'failure',
    steps: [
      { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
      { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
      { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
    ],
    ...overrides,
  }] });
  const options = {
    run: runRecord,
    jobs: jobRecord(),
    currentSha: 'd'.repeat(40),
    sourceSha: 'a'.repeat(40),
    sourceWorkflowId: String(deployWorkflowId),
    expectedRunId: String(runRecord.id),
  };
  assert.equal(classifyRecoveryReuseInterveningRun(options), 'INTERVENING_RECOVERY_PREINVOKE_STOP_PROVEN');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, expectedRunId: '1' }), 'INTERVENING_RECOVERY_RUN_NOT_EXACT');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, run: { ...runRecord, head_sha: 'd'.repeat(40) } }),
    'INTERVENING_RECOVERY_RUN_NOT_EXACT');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, run: { ...runRecord, head_sha: 'a'.repeat(40) } }),
    'INTERVENING_RECOVERY_RUN_NOT_EXACT');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, run: { ...runRecord, status: 'in_progress' } }),
    'INTERVENING_RECOVERY_RUN_NOT_EXACT');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, run: { ...runRecord, event: 'push' } }),
    'INTERVENING_RECOVERY_RUN_NOT_EXACT');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, run: { ...runRecord, workflow_id: deployWorkflowId + 1 } }),
    'INTERVENING_RECOVERY_RUN_NOT_EXACT');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, jobs: jobRecord({ conclusion: 'success' }) }),
    'INTERVENING_RECOVERY_PHASE_NOT_PROVEN');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, jobs: { jobs: [...jobRecord().jobs, ...jobRecord().jobs] } }),
    'INTERVENING_RECOVERY_PHASE_NOT_PROVEN');
  assert.equal(classifyRecoveryReuseInterveningRun({
    ...options,
    jobs: jobRecord({ steps: [
      { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
      { name: 'Deploy recovery-only Function version', conclusion: 'success' },
      { name: 'Invoke exact read-only recovery tag once', conclusion: 'skipped' },
    ] }),
  }), 'INTERVENING_RECOVERY_PHASE_NOT_PROVEN');
  assert.equal(classifyRecoveryReuseInterveningRun({
    ...options,
    jobs: jobRecord({ steps: [
      { name: 'Verify exact accepted recovery Function version for reuse', conclusion: 'failure' },
      { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
      { name: 'Invoke exact read-only recovery tag once', conclusion: 'failure' },
    ] }),
  }), 'INTERVENING_RECOVERY_PHASE_NOT_PROVEN');
  assert.equal(classifyRecoveryReuseInterveningRun({ ...options, jobs: jobRecord({ steps: [] }) }),
    'INTERVENING_RECOVERY_PHASE_NOT_PROVEN');
  assert.equal(classifyRecoveryReuseInterveningRun({
    ...options,
    jobs: jobRecord({ steps: [
      ...jobRecord().jobs[0].steps,
      { name: 'Deploy recovery-only Function version', conclusion: 'skipped' },
    ] }),
  }), 'INTERVENING_RECOVERY_PHASE_NOT_PROVEN');
});

test('multiple distinct-SHA prior runs are accepted only when every exact create step was skipped', () => {
  const priorRuns = { workflow_runs: [run({ id: 101 }), run({ id: 102, head_sha: 'c'.repeat(40) })] };
  const allSkipped = {
    jobsByRun: [
      { runId: 101, jobs: jobs('skipped') },
      { runId: 102, jobs: jobs('skipped') },
    ],
  };
  assert.equal(classify(priorRuns, allSkipped), 'PRIOR_PREWRITE_STOP_ONLY');

  const consumed = {
    jobsByRun: [
      { runId: 101, jobs: jobs('skipped') },
      { runId: 102, jobs: jobs('failure') },
    ],
  };
  assert.equal(classify(priorRuns, consumed), 'PRIOR_ATTEMPT_CONSUMED');
  assert.equal(classify(priorRuns, { jobsByRun: allSkipped.jobsByRun.slice(0, 1) }), 'ATTEMPT_HISTORY_UNCLASSIFIED');
});

test('same-SHA stop, active, duplicate, incomplete and missing phase evidence fail closed', () => {
  assert.equal(classify({ workflow_runs: [run({ head_sha: currentSha })] }, jobs('skipped')),
    'SAME_SHA_PREWRITE_STOP_FORBIDDEN');
  assert.equal(classify({ workflow_runs: [run({ status: 'in_progress' })] }), 'PRIOR_ATTEMPT_ACTIVE');
  assert.equal(classify({ workflow_runs: [run({ id: 98 }), run({ head_sha: 'c'.repeat(40) })] }), 'ATTEMPT_HISTORY_UNCLASSIFIED');
  assert.equal(classify({ workflow_runs: [run({ id: 101 }), run({ id: 101, head_sha: 'c'.repeat(40) })] }, {
    jobsByRun: [{ runId: 101, jobs: jobs('skipped') }],
  }), 'ATTEMPT_HISTORY_AMBIGUOUS');
  assert.equal(classify({ workflow_runs: [run({ id: 101 }), run({ id: 102 })] }, {
    jobsByRun: [
      { runId: 101, jobs: jobs('skipped') },
      { runId: 102, jobs: jobs('skipped') },
    ],
  }), 'ATTEMPT_HISTORY_AMBIGUOUS');
  assert.equal(classify({ workflow_runs: new Array(100).fill(run()) }), 'ATTEMPT_HISTORY_INCOMPLETE');
  assert.equal(classify({ workflow_runs: [run()] }, { jobs: [{ name: 'deploy-only-attempt', steps: [] }] }),
    'ATTEMPT_HISTORY_UNCLASSIFIED');
});

function reuseRun(id, sha, conclusion) {
  return run({ id, head_sha: sha, status: 'completed', conclusion });
}

function reuseJobs(runConclusion, createConclusion) {
  return { jobs: [{
    name: 'deploy-only-attempt',
    conclusion: runConclusion,
    steps: [
      { name: 'Prove exact merged authorization, CI and failed deploy boundary', conclusion: 'success' },
      { name: 'Restore exact-main provider artifact', conclusion: 'success' },
      { name: 'Create exactly one read-only recovery Function version without invoking it', conclusion: createConclusion },
      { name: 'Re-assert exact main before the one-shot recovery-only version create', conclusion: 'success' },
      { name: 'Re-assert exact main after the one-shot deploy-only result', conclusion: 'success' },
      { name: 'Publish enum-only recovery deploy attempt result', conclusion: 'success' },
      { name: 'Preserve failed create as the consumed terminal outcome', conclusion: 'skipped' },
    ],
  }] };
}

test('reuse selects the unique successful exact recovery create only after all other attempts prove prewrite stops', () => {
  const failedRecoveryRunId = '36341844854';
  const sourceRunId = 104;
  const currentSha = 'e'.repeat(40);
  const runs = { workflow_runs: [
    reuseRun(101, 'a'.repeat(40), 'failure'),
    reuseRun(102, 'b'.repeat(40), 'failure'),
    reuseRun(103, 'c'.repeat(40), 'failure'),
    reuseRun(sourceRunId, 'd'.repeat(40), 'success'),
  ] };
  const jobsByRun = [
    { runId: 101, jobs: reuseJobs('failure', 'skipped') },
    { runId: 102, jobs: reuseJobs('failure', 'skipped') },
    { runId: 103, jobs: reuseJobs('failure', 'skipped') },
    { runId: sourceRunId, jobs: reuseJobs('success', 'success') },
  ];

  assert.equal(classifyRecoveryVersionReuseSourceHistory({
    runs, jobsByRun, currentSha, sourceRunId: String(sourceRunId), failedRecoveryRunId,
    sourceWorkflowId: String(deployWorkflowId),
  }), 'RECOVERY_VERSION_REUSE_SOURCE_PROVEN');

  const workflowIdMismatch = {
    workflow_runs: runs.workflow_runs.map((entry) => entry.id === 102
      ? { ...entry, workflow_id: deployWorkflowId + 1 }
      : entry),
  };
  assert.equal(classifyRecoveryVersionReuseSourceHistory({
    runs: workflowIdMismatch, jobsByRun, currentSha, sourceRunId: String(sourceRunId), failedRecoveryRunId,
    sourceWorkflowId: String(deployWorkflowId),
  }), 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN');

  const createReachedBeforeSource = jobsByRun.map((entry) => entry.runId === 102
    ? { ...entry, jobs: reuseJobs('failure', 'failure') }
    : entry);
  assert.equal(classifyRecoveryVersionReuseSourceHistory({
    runs, jobsByRun: createReachedBeforeSource, currentSha, sourceRunId: String(sourceRunId), failedRecoveryRunId,
    sourceWorkflowId: String(deployWorkflowId),
  }), 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN');

  const duplicateSuccess = { workflow_runs: [...runs.workflow_runs, reuseRun(105, 'f'.repeat(40), 'success')] };
  assert.equal(classifyRecoveryVersionReuseSourceHistory({
    runs: duplicateSuccess,
    jobsByRun: [...jobsByRun, { runId: 105, jobs: reuseJobs('success', 'success') }],
    currentSha,
    sourceRunId: String(sourceRunId),
    failedRecoveryRunId,
    sourceWorkflowId: String(deployWorkflowId),
  }), 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN');

  assert.equal(classifyRecoveryVersionReuseSourceHistory({
    runs, jobsByRun, currentSha, sourceRunId: String(sourceRunId), failedRecoveryRunId,
    sourceWorkflowId: String(deployWorkflowId),
  }), 'RECOVERY_VERSION_REUSE_SOURCE_PROVEN');
});

test('reuse-source CLI consumes an exact run/job map and emits only its allowlisted classification', async () => {
  const sourceRunId = 104;
  const currentSha = 'e'.repeat(40);
  const runs = { workflow_runs: [
    reuseRun(101, 'a'.repeat(40), 'failure'),
    reuseRun(102, 'b'.repeat(40), 'failure'),
    reuseRun(103, 'c'.repeat(40), 'failure'),
    reuseRun(sourceRunId, 'd'.repeat(40), 'success'),
  ] };
  const jobsByRun = { jobsByRun: [
    { runId: 101, jobs: reuseJobs('failure', 'skipped') },
    { runId: 102, jobs: reuseJobs('failure', 'skipped') },
    { runId: 103, jobs: reuseJobs('failure', 'skipped') },
    { runId: sourceRunId, jobs: reuseJobs('success', 'success') },
  ] };
  const root = await mkdtemp(join(tmpdir(), 'prihrash-r1-reuse-history-'));
  try {
    const runsPath = join(root, 'runs.json');
    const jobsPath = join(root, 'jobs.json');
    await Promise.all([
      writeFile(runsPath, JSON.stringify(runs)),
      writeFile(jobsPath, JSON.stringify(jobsByRun)),
    ]);
    const result = spawnSync(process.execPath, [
      'scripts/classify-r1-recovery-deploy-attempt-history.mjs',
      'reuse-source',
      runsPath,
      jobsPath,
      currentSha,
      String(sourceRunId),
      failedRecoveryRunId,
      String(deployWorkflowId),
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'RECOVERY_VERSION_REUSE_SOURCE_PROVEN\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
