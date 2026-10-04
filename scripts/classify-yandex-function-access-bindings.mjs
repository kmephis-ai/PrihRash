import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OUTPUT_KEYS = ['code', 'publicInvoker', 'runtimeInvoker', 'status', 'wifEditor', 'wifInvoker'];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(code, bindings = null, expected = {}) {
  if (code !== 'FUNCTION_BINDINGS_CLASSIFIED') {
    return Object.freeze({
      status: 'STOP',
      code,
      publicInvoker: 'UNCLASSIFIED',
      runtimeInvoker: 'UNCLASSIFIED',
      wifEditor: 'UNCLASSIFIED',
      wifInvoker: 'UNCLASSIFIED',
    });
  }

  const entries = bindings ?? [];
  const has = (roleId, subjectId) => entries.some((entry) => entry.roleId === roleId
    && entry.subjectType === 'serviceAccount' && entry.subjectId === subjectId);
  const publicInvoker = entries.some((entry) => entry.roleId === 'functions.functionInvoker'
    && ['allUsers', 'allAuthenticatedUsers'].includes(entry.subjectId));

  return Object.freeze({
    status: 'PASS',
    code,
    publicInvoker: publicInvoker ? 'PRESENT' : 'ABSENT',
    runtimeInvoker: has('functions.functionInvoker', expected.runtimeServiceAccountId) ? 'PRESENT' : 'ABSENT',
    wifEditor: has('functions.editor', expected.wifServiceAccountId) ? 'PRESENT' : 'ABSENT',
    wifInvoker: has('functions.functionInvoker', expected.wifServiceAccountId) ? 'PRESENT' : 'ABSENT',
  });
}

function httpErrorCode(status) {
  if (status === 401) return 'FUNCTION_BINDINGS_AUTH_REQUIRED';
  if (status === 403) return 'FUNCTION_BINDINGS_PERMISSION_DENIED';
  if (status === 404) return 'FUNCTION_BINDINGS_FUNCTION_NOT_FOUND';
  return 'FUNCTION_BINDINGS_HTTP_STATUS_UNEXPECTED';
}

export function classifyFunctionAccessBindings({ curlExitCode, httpStatus, responseText, wifServiceAccountId, runtimeServiceAccountId }) {
  if (!Number.isInteger(curlExitCode) || typeof httpStatus !== 'string' || !/^\d{3}$/.test(httpStatus)) {
    return result('FUNCTION_BINDINGS_TRANSPORT_METADATA_INVALID');
  }
  if (curlExitCode !== 0) {
    return result(curlExitCode === 28
      ? 'FUNCTION_BINDINGS_TIMEOUT'
      : curlExitCode === 63 ? 'FUNCTION_BINDINGS_RESPONSE_TOO_LARGE' : 'FUNCTION_BINDINGS_TRANSPORT_FAILED');
  }

  const status = Number(httpStatus);
  if (status !== 200) return result(httpErrorCode(status));
  if (typeof responseText !== 'string') return result('FUNCTION_BINDINGS_RESPONSE_INVALID');
  if (Buffer.byteLength(responseText, 'utf8') > 1_048_576) return result('FUNCTION_BINDINGS_RESPONSE_TOO_LARGE');

  let response;
  try {
    response = JSON.parse(responseText);
  } catch {
    return result('FUNCTION_BINDINGS_JSON_INVALID');
  }
  if (!object(response)
    || Object.keys(response).some((key) => !['accessBindings', 'nextPageToken', '@type'].includes(key))
    || (response['@type'] !== undefined && typeof response['@type'] !== 'string')) {
    return result('FUNCTION_BINDINGS_RESPONSE_INVALID');
  }

  const bindings = response.accessBindings === undefined ? [] : response.accessBindings;
  if (!Array.isArray(bindings)) return result('FUNCTION_BINDINGS_RESPONSE_INVALID');
  if (bindings.length >= 1_000) return result('FUNCTION_BINDINGS_PAGINATION_INCOMPLETE');
  if (response.nextPageToken !== undefined) {
    if (typeof response.nextPageToken !== 'string') return result('FUNCTION_BINDINGS_RESPONSE_INVALID');
    if (response.nextPageToken.length > 0) return result('FUNCTION_BINDINGS_PAGINATION_INCOMPLETE');
  }
  if (typeof wifServiceAccountId !== 'string' || wifServiceAccountId.length === 0
    || typeof runtimeServiceAccountId !== 'string' || runtimeServiceAccountId.length === 0) {
    return result('FUNCTION_BINDINGS_INPUT_INVALID');
  }

  const pairs = new Set();
  const normalized = [];
  for (const binding of bindings) {
    if (!object(binding)
      || Object.keys(binding).some((key) => !['roleId', 'subject'].includes(key))
      || typeof binding.roleId !== 'string' || binding.roleId.length === 0
      || !object(binding.subject)
      || Object.keys(binding.subject).some((key) => !['id', 'type'].includes(key))
      || typeof binding.subject.id !== 'string' || binding.subject.id.length === 0
      || typeof binding.subject.type !== 'string' || binding.subject.type.length === 0) {
      return result('FUNCTION_BINDINGS_ENTRY_INVALID');
    }
    const key = `${binding.roleId}\u0000${binding.subject.type}\u0000${binding.subject.id}`;
    if (pairs.has(key)) return result('FUNCTION_BINDINGS_AMBIGUOUS');
    pairs.add(key);
    normalized.push({ roleId: binding.roleId, subjectId: binding.subject.id, subjectType: binding.subject.type });
  }

  return result('FUNCTION_BINDINGS_CLASSIFIED', normalized, { wifServiceAccountId, runtimeServiceAccountId });
}

async function main(args) {
  if (args.length !== 5) return result('FUNCTION_BINDINGS_INPUT_INVALID');
  const [curlExitText, httpStatus, responsePath, wifServiceAccountId, runtimeServiceAccountId] = args;
  if (!/^\d+$/.test(curlExitText)) return result('FUNCTION_BINDINGS_TRANSPORT_METADATA_INVALID');
  const curlExitCode = Number(curlExitText);
  let responseText = '';
  if (curlExitCode === 0) {
    try {
      responseText = await readFile(responsePath, 'utf8');
    } catch {
      return result('FUNCTION_BINDINGS_RESPONSE_READ_FAILED');
    }
  }
  return classifyFunctionAccessBindings({
    curlExitCode,
    httpStatus,
    responseText,
    wifServiceAccountId,
    runtimeServiceAccountId,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const classification = await main(process.argv.slice(2));
    if (Object.keys(classification).sort().join('|') !== [...OUTPUT_KEYS].sort().join('|')) {
      process.stdout.write(`${JSON.stringify(result('FUNCTION_BINDINGS_CLASSIFIER_FAILED'))}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(classification)}\n`);
      if (classification.status !== 'PASS') process.exitCode = 1;
    }
  } catch {
    process.stdout.write(`${JSON.stringify(result('FUNCTION_BINDINGS_CLASSIFIER_FAILED'))}\n`);
    process.exitCode = 1;
  }
}
