import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const OUTPUT_KEYS = ['code', 'status', 'targetFunction'];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(code, targetFunction = 'UNCLASSIFIED') {
  return Object.freeze({
    status: code === 'TRIGGER_LIST_CLASSIFIED' ? 'PASS' : 'STOP',
    code,
    targetFunction,
  });
}

function httpErrorCode(status) {
  if (status === 401) return 'TRIGGER_LIST_AUTH_REQUIRED';
  if (status === 403) return 'TRIGGER_LIST_PERMISSION_DENIED';
  if (status === 404) return 'TRIGGER_LIST_NOT_FOUND';
  return 'TRIGGER_LIST_HTTP_STATUS_UNEXPECTED';
}

function containsExactString(value, expected) {
  if (typeof value === 'string') return value === expected;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected));
  if (object(value)) return Object.values(value).some((item) => containsExactString(item, expected));
  return false;
}

export function classifyTriggerList({ curlExitCode, httpStatus, responseText, targetFunctionId }) {
  if (!Number.isInteger(curlExitCode) || typeof httpStatus !== 'string' || !/^\d{3}$/.test(httpStatus)) {
    return result('TRIGGER_LIST_TRANSPORT_METADATA_INVALID');
  }
  if (curlExitCode !== 0) {
    return result(curlExitCode === 28
      ? 'TRIGGER_LIST_TIMEOUT'
      : curlExitCode === 63 ? 'TRIGGER_LIST_RESPONSE_TOO_LARGE' : 'TRIGGER_LIST_TRANSPORT_FAILED');
  }

  const status = Number(httpStatus);
  if (status !== 200) return result(httpErrorCode(status));
  if (typeof responseText !== 'string') return result('TRIGGER_LIST_RESPONSE_INVALID');
  if (Buffer.byteLength(responseText, 'utf8') > 1_048_576) return result('TRIGGER_LIST_RESPONSE_TOO_LARGE');
  if (typeof targetFunctionId !== 'string' || targetFunctionId.length === 0) return result('TRIGGER_LIST_INPUT_INVALID');

  let response;
  try {
    response = JSON.parse(responseText);
  } catch {
    return result('TRIGGER_LIST_JSON_INVALID');
  }

  if (!object(response)
    || Object.keys(response).some((key) => !['triggers', 'nextPageToken', '@type'].includes(key))
    || (response['@type'] !== undefined && typeof response['@type'] !== 'string')) {
    return result('TRIGGER_LIST_RESPONSE_INVALID');
  }

  const triggers = response.triggers === undefined ? [] : response.triggers;
  if (!Array.isArray(triggers)) return result('TRIGGER_LIST_RESPONSE_INVALID');
  if (triggers.length >= 1_000) return result('TRIGGER_LIST_PAGINATION_INCOMPLETE');
  if (response.nextPageToken !== undefined) {
    if (typeof response.nextPageToken !== 'string') return result('TRIGGER_LIST_RESPONSE_INVALID');
    if (response.nextPageToken.length > 0) return result('TRIGGER_LIST_PAGINATION_INCOMPLETE');
  }
  if (triggers.some((trigger) => !object(trigger))) return result('TRIGGER_LIST_ENTRY_INVALID');

  return result(
    'TRIGGER_LIST_CLASSIFIED',
    triggers.some((trigger) => containsExactString(trigger, targetFunctionId)) ? 'PRESENT' : 'ABSENT',
  );
}

async function main(args) {
  if (args.length !== 4) return result('TRIGGER_LIST_INPUT_INVALID');
  const [curlExitText, httpStatus, responsePath, targetFunctionId] = args;
  if (!/^\d+$/.test(curlExitText)) return result('TRIGGER_LIST_TRANSPORT_METADATA_INVALID');
  const curlExitCode = Number(curlExitText);
  let responseText = '';
  if (curlExitCode === 0) {
    try {
      responseText = await readFile(responsePath, 'utf8');
    } catch {
      return result('TRIGGER_LIST_RESPONSE_READ_FAILED');
    }
  }
  return classifyTriggerList({ curlExitCode, httpStatus, responseText, targetFunctionId });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const classification = await main(process.argv.slice(2));
    if (Object.keys(classification).sort().join('|') !== [...OUTPUT_KEYS].sort().join('|')) {
      process.stdout.write(`${JSON.stringify(result('TRIGGER_LIST_CLASSIFIER_FAILED'))}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(classification)}\n`);
      if (classification.status !== 'PASS') process.exitCode = 1;
    }
  } catch {
    process.stdout.write(`${JSON.stringify(result('TRIGGER_LIST_CLASSIFIER_FAILED'))}\n`);
    process.exitCode = 1;
  }
}
