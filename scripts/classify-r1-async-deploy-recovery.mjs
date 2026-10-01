import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const VERSION_METADATA_TYPE = 'type.googleapis.com/yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBindings(value) {
  if (Array.isArray(value)) return value;
  if (object(value) && Array.isArray(value.accessBindings)) return value.accessBindings;
  return null;
}

function hasRuntimeInvoker(bindings, runtimeServiceAccountId) {
  return bindings.some((binding) => object(binding)
    && (binding.role_id ?? binding.roleId) === 'functions.functionInvoker'
    && object(binding.subject)
    && binding.subject.type === 'serviceAccount'
    && binding.subject.id === runtimeServiceAccountId);
}

function versionIdFromMetadata(metadata) {
  if (!object(metadata) || metadata['@type'] !== VERSION_METADATA_TYPE) return null;
  const camel = metadata.functionVersionId;
  const snake = metadata.function_version_id;
  if (camel === undefined && snake === undefined) return null;
  if ((camel !== undefined && (typeof camel !== 'string' || camel.length === 0))
    || (snake !== undefined && (typeof snake !== 'string' || snake.length === 0))
    || (camel !== undefined && snake !== undefined && camel !== snake)
    || Object.keys(metadata).some((key) => !['@type', 'functionVersionId', 'function_version_id'].includes(key))) return null;
  return camel ?? snake;
}

function createFailureClass(error) {
  if (!object(error)) return 'OTHER';
  switch (error.code) {
    case 3:
    case 'INVALID_ARGUMENT': return 'INVALID_ARGUMENT';
    case 5:
    case 'NOT_FOUND': return 'NOT_FOUND';
    case 7:
    case 'PERMISSION_DENIED': return 'PERMISSION_DENIED';
    case 8:
    case 'RESOURCE_EXHAUSTED': return 'RESOURCE_EXHAUSTED';
    case 9:
    case 'FAILED_PRECONDITION': return 'FAILED_PRECONDITION';
    case 13:
    case 'INTERNAL': return 'INTERNAL';
    case 14:
    case 'UNAVAILABLE': return 'UNAVAILABLE';
    default: return 'OTHER';
  }
}

function exactAsyncVersion(version, {
  functionId,
  runtimeServiceAccountId,
  invokerServiceAccountId,
  lockboxSecretId,
  lockboxVersionId,
}) {
  if (!object(version)
    || typeof version.id !== 'string' || version.id.length === 0
    || version.functionId !== functionId
    || version.status !== 'ACTIVE'
    || version.runtime !== 'nodejs22'
    || version.entrypoint !== 'index.initialBootstrapHandler'
    || version.serviceAccountId !== runtimeServiceAccountId
    || !Array.isArray(version.tags) || !version.tags.includes('r1-initial-bootstrap-async')
    || !object(version.resources) || version.resources.memory !== '1073741824'
    || version.executionTimeout !== '600s'
    || !object(version.logOptions) || version.logOptions.disabled !== true
    || !object(version.metadataOptions)
    || version.metadataOptions.gceHttpEndpoint !== 'ENABLED'
    || version.metadataOptions.awsV1HttpEndpoint !== 'DISABLED'
    || !object(version.asyncInvocationConfig)
    || version.asyncInvocationConfig.retriesCount !== 0
    || version.asyncInvocationConfig.serviceAccountId !== invokerServiceAccountId
    || !['successTarget', 'failureTarget'].every((key) => version.asyncInvocationConfig[key] === undefined
      || (object(version.asyncInvocationConfig[key]) && Object.keys(version.asyncInvocationConfig[key]).length === 0))
    || Object.keys(version.asyncInvocationConfig).some((key) => ![
      'retriesCount', 'serviceAccountId', 'successTarget', 'failureTarget',
    ].includes(key))
    || (version.environment !== undefined && (!object(version.environment) || Object.keys(version.environment).length !== 0))
    || !Array.isArray(version.secrets) || version.secrets.length !== 5) return false;

  const expectedSecrets = new Map([
    ['PRIHRASH_GOOGLE_SPREADSHEET_ID', 'google_spreadsheet_id'],
    ['PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL', 'google_service_account_email'],
    ['PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'google_service_account_private_key'],
    ['PRIHRASH_YDB_CONNECTION_STRING', 'ydb_connection_string'],
    ['PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE', 'initial_bootstrap_private_historical_evidence'],
  ]);
  const environments = new Set();
  for (const secret of version.secrets) {
    if (!object(secret)
      || secret.id !== lockboxSecretId
      || secret.versionId !== lockboxVersionId
      || expectedSecrets.get(secret.environmentVariable) !== secret.key
      || environments.has(secret.environmentVariable)) return false;
    environments.add(secret.environmentVariable);
  }
  return environments.size === expectedSecrets.size;
}

function deploymentWindowCandidate({ versions, taggedVersion, tagHistory, functionId, lower, upper }) {
  const listed = versions.some((version) => {
    if (!object(version)) return false;
    const createdAt = timestamp(version.created_at ?? version.createdAt);
    const tags = version.tags === undefined ? [] : version.tags;
    return Array.isArray(tags)
      && tags.includes('r1-initial-bootstrap-async')
      && (version.function_id ?? version.functionId) === functionId
      && createdAt !== null && createdAt >= lower && createdAt <= upper;
  });
  const byTag = object(taggedVersion)
    && Array.isArray(taggedVersion.tags)
    && taggedVersion.tags.includes('r1-initial-bootstrap-async')
    && timestamp(taggedVersion.createdAt) !== null
    && timestamp(taggedVersion.createdAt) >= lower
    && timestamp(taggedVersion.createdAt) <= upper;
  const tagHistoryRecords = object(tagHistory) && Array.isArray(tagHistory.functionTagHistoryRecord)
    ? tagHistory.functionTagHistoryRecord
    : [];
  const historical = tagHistoryRecords.some((record) => object(record)
    && record.functionId === functionId
    && record.tag === 'r1-initial-bootstrap-async'
    && timestamp(record.effectiveFrom) !== null
    && timestamp(record.effectiveFrom) >= lower
    && timestamp(record.effectiveFrom) <= upper);
  return listed || byTag || historical;
}

function result(verdict, previousWrite, runtimeInvoker, createFailureClassValue = 'NONE') {
  return Object.freeze({
    status: 'PASS',
    code: 'R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED',
    verdict,
    previousWrite,
    runtimeInvoker: runtimeInvoker ? 'PRESENT' : 'ABSENT',
    createFailureClass: createFailureClassValue,
  });
}

export function classifyAsyncDeployRecovery({
  versions,
  operations,
  functionBindings,
  taggedVersion,
  tagHistory,
  functionId,
  runtimeServiceAccountId,
  invokerServiceAccountId,
  lockboxSecretId,
  lockboxVersionId,
  deployStartedAt,
  deployFinishedAt,
  observedAt,
}) {
  const functionItems = asBindings(functionBindings);
  const start = timestamp(deployStartedAt);
  const finish = timestamp(deployFinishedAt);
  const observed = timestamp(observedAt);
  if (!Array.isArray(versions) || versions.length >= 1_000
    || !Array.isArray(operations) || operations.length >= 1_000
    || !Array.isArray(functionItems)
    || typeof functionId !== 'string' || functionId.length === 0
    || typeof runtimeServiceAccountId !== 'string' || runtimeServiceAccountId.length === 0
    || typeof invokerServiceAccountId !== 'string' || invokerServiceAccountId.length === 0
    || typeof lockboxSecretId !== 'string' || lockboxSecretId.length === 0
    || typeof lockboxVersionId !== 'string' || lockboxVersionId.length === 0
    || start === null || finish === null || observed === null || finish < start || observed < finish
    || !object(tagHistory)) {
    return result('EVIDENCE_INVALID', 'UNCLASSIFIED', false);
  }

  const lower = start - 5_000;
  const upper = finish + 5_000;
  const runtimeInvoker = hasRuntimeInvoker(functionItems, runtimeServiceAccountId);
  const ops = [];
  for (const operation of operations) {
    if (!object(operation)
      || typeof operation.id !== 'string' || operation.id.length === 0
      || typeof (operation.created_by ?? operation.createdBy) !== 'string'
      || timestamp(operation.created_at ?? operation.createdAt) === null) {
      return result('EVIDENCE_INVALID', 'UNCLASSIFIED', runtimeInvoker);
    }
    const createdBy = operation.created_by ?? operation.createdBy;
    const createdAt = timestamp(operation.created_at ?? operation.createdAt);
    if (createdBy === invokerServiceAccountId && createdAt >= lower && createdAt <= upper) ops.push(operation);
  }
  if (ops.length > 1) return result('PREVIOUS_WRITE_AMBIGUOUS', 'AMBIGUOUS', runtimeInvoker);

  const hasCandidate = deploymentWindowCandidate({ versions, taggedVersion, tagHistory, functionId, lower, upper });
  if (ops.length === 0) {
    return result(hasCandidate ? 'PREVIOUS_VERSION_UNPROVEN' : 'DEPLOYMENT_OUTCOME_UNCLASSIFIED',
      hasCandidate ? 'VERSION_CANDIDATE' : 'UNCLASSIFIED', runtimeInvoker);
  }

  const operation = ops[0];
  if (operation.done === false) return result('CREATE_OPERATION_IN_PROGRESS', 'AMBIGUOUS', runtimeInvoker);
  if (object(operation.error)) {
    if (hasCandidate) return result('PREVIOUS_WRITE_AMBIGUOUS', 'AMBIGUOUS', runtimeInvoker);
    const failure = createFailureClass(operation.error);
    if (failure === 'INVALID_ARGUMENT' || failure === 'FAILED_PRECONDITION') {
      return result('REQUEST_CONTRACT_INVALID', 'CREATE_OPERATION_FAILED', runtimeInvoker, failure);
    }
    if (failure === 'PERMISSION_DENIED') {
      return result('CREATE_PERMISSION_DENIED', 'CREATE_OPERATION_FAILED', runtimeInvoker, failure);
    }
    return result('CREATE_OPERATION_FAILED_UNCLASSIFIED', 'CREATE_OPERATION_FAILED', runtimeInvoker, failure);
  }
  if (operation.done !== true || !object(operation.response)) {
    return result('DEPLOYMENT_OUTCOME_UNCLASSIFIED', 'UNCLASSIFIED', runtimeInvoker);
  }

  const responseType = operation.response['@type'];
  const responseId = operation.response.id;
  const metadataId = operation.metadata === undefined ? undefined : versionIdFromMetadata(operation.metadata);
  if ((responseType !== undefined && responseType !== 'type.googleapis.com/yandex.cloud.serverless.functions.v1.Version')
    || (operation.metadata !== undefined && metadataId === null)
    || (responseId !== undefined && (typeof responseId !== 'string' || responseId.length === 0))
    || (responseId !== undefined && metadataId !== undefined && responseId !== metadataId)
    || (responseId === undefined && metadataId === undefined)) {
    return result('PREVIOUS_VERSION_UNPROVEN', hasCandidate ? 'VERSION_CANDIDATE' : 'UNCLASSIFIED', runtimeInvoker);
  }
  const createdId = responseId ?? metadataId;
  const matchingVersions = versions.filter((version) => object(version) && version.id === createdId);
  if (matchingVersions.length !== 1) {
    return result('PREVIOUS_VERSION_UNPROVEN', hasCandidate ? 'VERSION_CANDIDATE' : 'UNCLASSIFIED', runtimeInvoker);
  }
  const versionCreatedAt = timestamp(matchingVersions[0].created_at ?? matchingVersions[0].createdAt);
  if (versionCreatedAt === null || versionCreatedAt < lower || versionCreatedAt > upper
    || !object(taggedVersion) || taggedVersion.id !== createdId
    || !exactAsyncVersion(taggedVersion, {
      functionId,
      runtimeServiceAccountId,
      invokerServiceAccountId,
      lockboxSecretId,
      lockboxVersionId,
    })) {
    return result('PREVIOUS_VERSION_UNPROVEN', 'VERSION_CANDIDATE', runtimeInvoker);
  }

  const tags = matchingVersions[0].tags === undefined ? [] : matchingVersions[0].tags;
  if (!Array.isArray(tags) || !tags.includes('r1-initial-bootstrap-async')) {
    return result('PREVIOUS_VERSION_UNPROVEN', 'VERSION_CANDIDATE', runtimeInvoker);
  }
  const history = tagHistory.functionTagHistoryRecord === undefined ? [] : tagHistory.functionTagHistoryRecord;
  if (!Array.isArray(history)
    || (tagHistory.nextPageToken !== undefined
      && (typeof tagHistory.nextPageToken !== 'string' || tagHistory.nextPageToken.length > 0))
    || history.some((record) => !object(record)
      || typeof record.functionId !== 'string' || record.functionId.length === 0
      || typeof record.functionVersionId !== 'string' || record.functionVersionId.length === 0
      || typeof record.tag !== 'string' || record.tag.length === 0
      || timestamp(record.effectiveFrom) === null || timestamp(record.effectiveTo) === null)) {
    return result('PREVIOUS_VERSION_UNPROVEN', 'VERSION_CANDIDATE', runtimeInvoker);
  }
  const active = history.filter((record) => record.functionId === functionId
    && record.functionVersionId === createdId
    && record.tag === 'r1-initial-bootstrap-async'
    && timestamp(record.effectiveFrom) >= lower && timestamp(record.effectiveFrom) <= upper
    && timestamp(record.effectiveFrom) <= observed && timestamp(record.effectiveTo) > observed);
  if (active.length !== 1 || history.some((record) => record.functionId === functionId
    && record.tag === 'r1-initial-bootstrap-async'
    && timestamp(record.effectiveFrom) > timestamp(active[0].effectiveFrom))) {
    return result('PREVIOUS_VERSION_UNPROVEN', 'VERSION_CANDIDATE', runtimeInvoker);
  }
  if (!runtimeInvoker) return result('IAM_BOUNDARY_MISSING', 'VERSION_PROVEN', false);
  return result('INVOCATION_ONLY_READY', 'VERSION_PROVEN', true);
}

async function main(args) {
  if (args.length !== 13) throw new Error('INVALID_ARGUMENTS');
  const [versionsPath, operationsPath, functionBindingsPath, taggedVersionPath, tagHistoryPath,
    functionId, runtimeServiceAccountId, invokerServiceAccountId, lockboxSecretId, lockboxVersionId,
    deployStartedAt, deployFinishedAt, observedAt] = args;
  const [versions, operations, functionBindings, taggedVersion, tagHistory] = await Promise.all([
    versionsPath, operationsPath, functionBindingsPath, taggedVersionPath, tagHistoryPath,
  ].map(async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))));
  return classifyAsyncDeployRecovery({
    versions, operations, functionBindings, taggedVersion, tagHistory, functionId,
    runtimeServiceAccountId, invokerServiceAccountId, lockboxSecretId, lockboxVersionId,
    deployStartedAt, deployFinishedAt, observedAt,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch {
    process.stdout.write('{"status":"STOP","code":"R1_ASYNC_DEPLOY_RECOVERY_CLASSIFIED","verdict":"EVIDENCE_INVALID","previousWrite":"UNCLASSIFIED","runtimeInvoker":"ABSENT","createFailureClass":"NONE"}\n');
    process.exitCode = 2;
  }
}
