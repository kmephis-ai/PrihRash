import { readFile } from 'node:fs/promises';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTime(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function bindings(value) {
  if (Array.isArray(value)) return value;
  if (object(value) && Array.isArray(value.accessBindings)) return value.accessBindings;
  return null;
}

function roleId(binding) {
  return object(binding) ? (binding.role_id ?? binding.roleId) : null;
}

function subject(binding) {
  return object(binding) && object(binding.subject) ? binding.subject : null;
}

function hasBinding(items, role, subjectId) {
  return items.some((binding) => {
    const candidate = subject(binding);
    return roleId(binding) === role
      && candidate?.type === 'serviceAccount'
      && candidate?.id === subjectId;
  });
}

export function classifyAsyncDeployRecovery({
  versions,
  functionBindings,
  runtimeServiceAccountBindings,
  functionId,
  runtimeServiceAccountId,
  wifServiceAccountId,
  deployStartedAt,
  deployFinishedAt,
}) {
  if (
    !Array.isArray(versions)
    || versions.length >= 1_000
    || !Array.isArray(bindings(functionBindings))
    || !Array.isArray(bindings(runtimeServiceAccountBindings))
    || typeof functionId !== 'string'
    || functionId.length === 0
    || typeof runtimeServiceAccountId !== 'string'
    || runtimeServiceAccountId.length === 0
    || typeof wifServiceAccountId !== 'string'
    || wifServiceAccountId.length === 0
  ) {
    return Object.freeze({
      status: 'STOP',
      code: 'R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED',
      verdict: 'EVIDENCE_INVALID',
    });
  }

  const start = parseTime(deployStartedAt);
  const finish = parseTime(deployFinishedAt);
  if (start === null || finish === null || finish < start) {
    return Object.freeze({
      status: 'STOP',
      code: 'R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED',
      verdict: 'EVIDENCE_INVALID',
    });
  }

  const lower = start - 5_000;
  const upper = finish + 5_000;
  const tagged = versions.filter((version) => (
    object(version)
    && version.function_id === functionId
    && Array.isArray(version.tags)
    && version.tags.includes('r1-initial-bootstrap-async')
  ));
  const candidates = versions.filter((version) => {
    if (!object(version)) return false;
    const created = parseTime(version.created_at);
    return version.function_id === functionId
      && version.runtime === 'nodejs22'
      && version.entrypoint === 'index.initialBootstrapHandler'
      && version.service_account_id === runtimeServiceAccountId
      && created !== null
      && created >= lower
      && created <= upper;
  });

  const functionItems = bindings(functionBindings);
  const runtimeItems = bindings(runtimeServiceAccountBindings);
  const runtimeInvoker = hasBinding(
    functionItems,
    'functions.functionInvoker',
    runtimeServiceAccountId,
  );
  const wifCanUseRuntime = hasBinding(
    runtimeItems,
    'iam.serviceAccounts.user',
    wifServiceAccountId,
  );

  let previousWrite;
  if (tagged.length > 1 || candidates.length > 1) {
    previousWrite = 'AMBIGUOUS';
  } else if (tagged.length === 1 || candidates.length === 1) {
    previousWrite = 'VERSION_PRESENT';
  } else {
    previousWrite = 'NOT_APPLIED';
  }

  let verdict = 'BLOCKED';
  if (previousWrite === 'NOT_APPLIED' && runtimeInvoker && wifCanUseRuntime) {
    verdict = 'SAFE_TO_CORRECT_CONFIG';
  } else if (previousWrite === 'AMBIGUOUS') {
    verdict = 'PREVIOUS_WRITE_AMBIGUOUS';
  } else if (previousWrite === 'VERSION_PRESENT') {
    verdict = 'PREVIOUS_VERSION_PRESENT';
  } else if (!runtimeInvoker || !wifCanUseRuntime) {
    verdict = 'IAM_BOUNDARY_MISSING';
  }

  return Object.freeze({
    status: 'PASS',
    code: 'R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED',
    verdict,
    previousWrite,
    runtimeInvoker: runtimeInvoker ? 'PRESENT' : 'ABSENT',
    wifRuntimeServiceAccountUser: wifCanUseRuntime ? 'PRESENT' : 'ABSENT',
  });
}

async function main(args) {
  if (args.length !== 8) throw new Error('INVALID_ARGUMENTS');
  const [
    versionsPath,
    functionBindingsPath,
    runtimeBindingsPath,
    functionId,
    runtimeServiceAccountId,
    wifServiceAccountId,
    deployStartedAt,
    deployFinishedAt,
  ] = args;
  const [versions, functionBindings, runtimeServiceAccountBindings] = await Promise.all(
    [versionsPath, functionBindingsPath, runtimeBindingsPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  );
  return classifyAsyncDeployRecovery({
    versions,
    functionBindings,
    runtimeServiceAccountBindings,
    functionId,
    runtimeServiceAccountId,
    wifServiceAccountId,
    deployStartedAt,
    deployFinishedAt,
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch {
    process.stdout.write('{"status":"STOP","code":"R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED","verdict":"EVIDENCE_INVALID"}\n');
    process.exitCode = 2;
  }
}
