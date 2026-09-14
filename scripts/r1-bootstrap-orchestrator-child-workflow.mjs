const REPOSITORY = 'kmephis-ai/PrihRash';
const WORKFLOWS = Object.freeze({
  readiness: 'r1-yandex-readiness.yml',
  bootstrap: 'r1-initial-shadow-bootstrap.yml',
});
const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const POLL_MS = 3_000;
const DISCOVERY_TIMEOUT_MS = 60_000;
const COMPLETION_TIMEOUT_MS = 30 * 60_000;
const SAFE_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'R1_BOOTSTRAP_ORCHESTRATOR_CHILD_WORKFLOW_FAILED',
});

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function safeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubJson(path, token, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('GITHUB_API_REQUEST_FAILED');
  if (response.status === 204) return null;
  return response.json();
}

async function requireExactMain(token, expectedSha) {
  const branch = await githubJson('/branches/main', token);
  if (branch?.commit?.sha !== expectedSha || branch?.protected !== true) {
    throw new Error('EXACT_MAIN_REQUIRED');
  }
}

async function listDispatchRuns(token, workflow) {
  const value = await githubJson(
    `/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=main&event=workflow_dispatch&per_page=100`,
    token,
  );
  if (!Array.isArray(value?.workflow_runs)) throw new Error('WORKFLOW_RUNS_INVALID');
  return value.workflow_runs;
}

function exactRun(run, expectedSha) {
  return run?.head_sha === expectedSha
    && run?.head_branch === 'main'
    && run?.event === 'workflow_dispatch';
}

async function dispatchAndResolveRun(token, workflow, expectedSha) {
  await requireExactMain(token, expectedSha);
  const beforeRuns = await listDispatchRuns(token, workflow);
  if (beforeRuns.some((run) => exactRun(run, expectedSha) && ACTIVE_STATUSES.has(run.status))) {
    throw new Error('CHILD_WORKFLOW_ALREADY_ACTIVE');
  }
  const beforeIds = new Set(beforeRuns.map((run) => run.id));

  await githubJson(`/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });

  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const runs = await listDispatchRuns(token, workflow);
    const candidates = runs.filter((run) => exactRun(run, expectedSha) && !beforeIds.has(run.id));
    if (candidates.length > 1) throw new Error('CHILD_WORKFLOW_AMBIGUOUS');
    if (candidates.length === 1) return candidates[0].id;
    await sleep(POLL_MS);
  }
  throw new Error('CHILD_WORKFLOW_NOT_FOUND');
}

async function waitForCompletion(token, runId, expectedSha) {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = await githubJson(`/actions/runs/${runId}`, token);
    if (!exactRun(run, expectedSha)) throw new Error('CHILD_WORKFLOW_IDENTITY_MISMATCH');
    if (run.status === 'completed') {
      if (typeof run.conclusion !== 'string') throw new Error('CHILD_WORKFLOW_CONCLUSION_INVALID');
      return run;
    }
    await sleep(POLL_MS);
  }
  throw new Error('CHILD_WORKFLOW_TIMEOUT');
}

async function bootstrapInvokeConclusion(token, runId) {
  const value = await githubJson(`/actions/runs/${runId}/jobs?filter=latest&per_page=100`, token);
  if (!Array.isArray(value?.jobs)) throw new Error('CHILD_WORKFLOW_JOBS_INVALID');
  const matching = value.jobs.flatMap((job) => Array.isArray(job.steps)
    ? job.steps.filter((step) => step.name === 'Invoke exact initial bootstrap tag once')
    : []);
  if (matching.length > 1) throw new Error('BOOTSTRAP_INVOKE_STEP_AMBIGUOUS');
  if (matching.length === 0) return 'NOT_REACHED';
  const conclusion = matching[0].conclusion;
  return typeof conclusion === 'string' ? conclusion : 'UNKNOWN';
}

async function main() {
  const kind = process.argv[2];
  const workflow = WORKFLOWS[kind];
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const expectedSha = process.env.GITHUB_SHA;
  if (
    workflow === undefined
    || repository !== REPOSITORY
    || !nonBlank(token)
    || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')
  ) {
    safeJson(SAFE_FAILURE);
    process.exitCode = 2;
    return;
  }

  try {
    const runId = await dispatchAndResolveRun(token, workflow, expectedSha);
    const run = await waitForCompletion(token, runId, expectedSha);
    const result = {
      status: 'PASS',
      code: 'R1_BOOTSTRAP_ORCHESTRATOR_CHILD_WORKFLOW_COMPLETED',
      workflow: kind,
      runId,
      conclusion: run.conclusion,
    };
    if (kind === 'bootstrap') {
      result.invokeStepConclusion = await bootstrapInvokeConclusion(token, runId);
    }
    safeJson(result);
  } catch {
    safeJson(SAFE_FAILURE);
    process.exitCode = 2;
  }
}

await main();
