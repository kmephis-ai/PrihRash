import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEPLOY_STEP_NAME = 'Create exactly one read-only recovery Function version without invoking it';

export function classifyRecoveryDeployAttemptHistory({
  runs,
  jobs,
  currentRunId,
  currentSha,
  failedRecoveryRunId,
}) {
  if (!runs || !Array.isArray(runs.workflow_runs)
    || !/^[1-9][0-9]*$/.test(String(currentRunId))
    || !/^[0-9a-f]{40}$/.test(String(currentSha))
    || !/^[1-9][0-9]*$/.test(String(failedRecoveryRunId))) {
    return 'ATTEMPT_HISTORY_INVALID';
  }
  if (runs.workflow_runs.length >= 100) return 'ATTEMPT_HISTORY_INCOMPLETE';

  const expectedTitle = `R1 recovery-only deploy attempt for failed run ${failedRecoveryRunId}`;
  const prior = runs.workflow_runs.filter((run) => run && run.id !== Number(currentRunId)
    && run.name === 'R1 initial bootstrap recovery deploy-only attempt'
    && run.head_branch === 'main'
    && run.event === 'workflow_dispatch'
    && run.display_title === expectedTitle);
  if (prior.length > 1) return 'ATTEMPT_HISTORY_AMBIGUOUS';
  if (prior.length === 0) return 'NO_PRIOR_ATTEMPT';
  const [previous] = prior;
  if (previous.head_sha === currentSha) return 'SAME_SHA_PREWRITE_STOP_FORBIDDEN';
  if (previous.status === 'queued' || previous.status === 'in_progress') return 'PRIOR_ATTEMPT_ACTIVE';
  if (previous.status !== 'completed' || !jobs || !Array.isArray(jobs.jobs)) {
    return 'ATTEMPT_HISTORY_UNCLASSIFIED';
  }

  const deployJobs = jobs.jobs.filter((job) => job && job.name === 'deploy-only-attempt');
  if (deployJobs.length !== 1 || !Array.isArray(deployJobs[0].steps)) return 'ATTEMPT_HISTORY_UNCLASSIFIED';
  const deploySteps = deployJobs[0].steps.filter((step) => step && step.name === DEPLOY_STEP_NAME);
  if (deploySteps.length !== 1) return 'ATTEMPT_HISTORY_UNCLASSIFIED';
  if (deploySteps[0].conclusion === 'skipped') return 'PRIOR_PREWRITE_STOP_ONLY';
  if (['success', 'failure', 'cancelled'].includes(deploySteps[0].conclusion)) {
    return 'PRIOR_ATTEMPT_CONSUMED';
  }
  return 'ATTEMPT_HISTORY_UNCLASSIFIED';
}

async function main(args) {
  const [runsPath, jobsPath, currentRunId, currentSha, failedRecoveryRunId] = args;
  if (!runsPath || !jobsPath || !currentRunId || !currentSha || !failedRecoveryRunId || args.length !== 5) {
    return 'ATTEMPT_HISTORY_INVALID';
  }
  try {
    const [runs, jobs] = await Promise.all([
      readFile(runsPath, 'utf8').then(JSON.parse),
      readFile(jobsPath, 'utf8').then(JSON.parse),
    ]);
    return classifyRecoveryDeployAttemptHistory({ runs, jobs, currentRunId, currentSha, failedRecoveryRunId });
  } catch {
    return 'ATTEMPT_HISTORY_INVALID';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${await main(process.argv.slice(2))}\n`);
}
