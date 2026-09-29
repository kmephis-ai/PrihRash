import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRecoveryDeployAttemptHistory } from '../../scripts/classify-r1-recovery-deploy-attempt-history.mjs';

const failedRecoveryRunId = '36341844854';
const attemptTitle = `R1 recovery-only deploy attempt for failed run ${failedRecoveryRunId}`;
const currentSha = 'b'.repeat(40);

function run(overrides = {}) {
  return {
    id: 99,
    name: 'R1 initial bootstrap recovery deploy-only attempt',
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
