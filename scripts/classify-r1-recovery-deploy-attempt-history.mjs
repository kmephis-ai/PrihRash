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
    && run.head_branch === 'main'
    && run.event === 'workflow_dispatch'
    && run.display_title === expectedTitle);
  if (prior.length === 0) return 'NO_PRIOR_ATTEMPT';

  const priorIds = new Set();
  const priorShas = new Set();
  for (const previous of prior) {
    if (!previous || !Number.isSafeInteger(previous.id) || previous.id < 1 || priorIds.has(previous.id)) {
      return 'ATTEMPT_HISTORY_AMBIGUOUS';
    }
    priorIds.add(previous.id);
    if (!/^[0-9a-f]{40}$/.test(String(previous.head_sha))) return 'ATTEMPT_HISTORY_UNCLASSIFIED';
    if (priorShas.has(previous.head_sha)) return 'ATTEMPT_HISTORY_AMBIGUOUS';
    priorShas.add(previous.head_sha);
    if (previous.head_sha === currentSha) return 'SAME_SHA_PREWRITE_STOP_FORBIDDEN';
    if (previous.status === 'queued' || previous.status === 'in_progress') return 'PRIOR_ATTEMPT_ACTIVE';
    if (previous.status !== 'completed') return 'ATTEMPT_HISTORY_UNCLASSIFIED';
  }

  let jobsByRun;
  if (Array.isArray(jobs?.jobsByRun)) {
    jobsByRun = jobs.jobsByRun;
  } else if (prior.length === 1 && Array.isArray(jobs?.jobs)) {
    jobsByRun = [{ runId: prior[0].id, jobs }];
  } else {
    return 'ATTEMPT_HISTORY_UNCLASSIFIED';
  }

  for (const previous of prior) {
    const runJobs = jobsByRun.filter((entry) => entry && entry.runId === previous.id);
    if (runJobs.length !== 1 || !Array.isArray(runJobs[0].jobs?.jobs)) {
      return 'ATTEMPT_HISTORY_UNCLASSIFIED';
    }
    const deployJobs = runJobs[0].jobs.jobs.filter((job) => job && job.name === 'deploy-only-attempt');
    if (deployJobs.length !== 1 || !Array.isArray(deployJobs[0].steps)) return 'ATTEMPT_HISTORY_UNCLASSIFIED';
    const deploySteps = deployJobs[0].steps.filter((step) => step && step.name === DEPLOY_STEP_NAME);
    if (deploySteps.length !== 1) return 'ATTEMPT_HISTORY_UNCLASSIFIED';
    if (deploySteps[0].conclusion === 'skipped') continue;
    if (['success', 'failure', 'cancelled'].includes(deploySteps[0].conclusion)) {
      return 'PRIOR_ATTEMPT_CONSUMED';
    }
    return 'ATTEMPT_HISTORY_UNCLASSIFIED';
  }

  return 'PRIOR_PREWRITE_STOP_ONLY';
}

export function classifyRecoveryVersionReuseSourceHistory({
  runs,
  jobsByRun,
  currentSha,
  sourceRunId,
  failedRecoveryRunId,
  sourceWorkflowId,
}) {
  if (!runs || !Array.isArray(runs.workflow_runs) || runs.workflow_runs.length >= 100
    || !Array.isArray(jobsByRun)
    || !/^[0-9a-f]{40}$/.test(String(currentSha))
    || !/^[1-9][0-9]*$/.test(String(sourceRunId))
    || !/^[1-9][0-9]*$/.test(String(failedRecoveryRunId))
    || !/^[1-9][0-9]*$/.test(String(sourceWorkflowId))) {
    return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
  }
  const expectedTitle = `R1 recovery-only deploy attempt for failed run ${failedRecoveryRunId}`;
  const attempts = runs.workflow_runs.filter((run) => run
    && run.head_branch === 'main'
    && run.event === 'workflow_dispatch'
    && run.display_title === expectedTitle);
  if (attempts.length === 0 || attempts.length >= 100) return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';

  const sourceRecords = attempts.filter((attempt) => attempt.id === Number(sourceRunId));
  if (sourceRecords.length !== 1 || sourceRecords[0].workflow_id !== Number(sourceWorkflowId)) {
    return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
  }

  const ids = new Set();
  const shas = new Set();
  let sourceMatches = 0;
  for (const attempt of attempts) {
    if (!Number.isSafeInteger(attempt.id) || attempt.id < 1 || ids.has(attempt.id)
      || !/^[0-9a-f]{40}$/.test(String(attempt.head_sha)) || shas.has(attempt.head_sha)
      || attempt.head_sha === currentSha || attempt.status !== 'completed'
      || attempt.workflow_id !== Number(sourceWorkflowId)) {
      return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
    }
    ids.add(attempt.id);
    shas.add(attempt.head_sha);

    const records = jobsByRun.filter((record) => record && record.runId === attempt.id);
    if (records.length !== 1 || !Array.isArray(records[0].jobs?.jobs)) {
      return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
    }
    const deployJobs = records[0].jobs.jobs.filter((job) => job && job.name === 'deploy-only-attempt');
    if (deployJobs.length !== 1 || !Array.isArray(deployJobs[0].steps)
      || deployJobs[0].conclusion !== attempt.conclusion) {
      return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
    }
    const stepConclusion = (name) => {
      const matches = deployJobs[0].steps.filter((step) => step && step.name === name);
      return matches.length === 1 ? matches[0].conclusion : null;
    };
    const createConclusion = stepConclusion(DEPLOY_STEP_NAME);
    if (attempt.id === Number(sourceRunId)) {
      sourceMatches += 1;
      if (attempt.conclusion !== 'success' || createConclusion !== 'success') {
        return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
      }
      for (const stepName of [
        'Prove exact merged authorization, CI and failed deploy boundary',
        'Restore exact-main provider artifact',
        'Re-assert exact main before the one-shot recovery-only version create',
        'Re-assert exact main after the one-shot deploy-only result',
        'Publish enum-only recovery deploy attempt result',
      ]) {
        if (stepConclusion(stepName) !== 'success') return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
      }
      if (stepConclusion('Preserve failed create as the consumed terminal outcome') !== 'skipped') {
        return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
      }
    } else if (attempt.conclusion !== 'failure' || createConclusion !== 'skipped') {
      return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
    }
  }
  return sourceMatches === 1 ? 'RECOVERY_VERSION_REUSE_SOURCE_PROVEN' : 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
}

async function main(args) {
  if (args[0] === 'reuse-source' && args.length === 7) {
    try {
      const [runs, jobMap] = await Promise.all([
        readFile(args[1], 'utf8').then(JSON.parse),
        readFile(args[2], 'utf8').then(JSON.parse),
      ]);
      return classifyRecoveryVersionReuseSourceHistory({
        runs,
        jobsByRun: jobMap.jobsByRun,
        currentSha: args[3],
        sourceRunId: args[4],
        failedRecoveryRunId: args[5],
        sourceWorkflowId: args[6],
      });
    } catch {
      return 'RECOVERY_VERSION_REUSE_SOURCE_UNPROVEN';
    }
  }
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
