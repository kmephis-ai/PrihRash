const MAX_CAPTURE_BYTES = 64 * 1024;
const originalFetch = globalThis.fetch;

let diagnosticPromise = Promise.resolve(null);

async function readLimitedUtf8(response) {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return null;
      total += value.byteLength;
      if (total > MAX_CAPTURE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function classifyFunctionErrorBody(body) {
  if (body === null) return 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_BODY_INVALID';
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_BODY_INVALID';
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_BODY_INVALID';
  }

  const errorType = typeof value.errorType === 'string' ? value.errorType : '';
  const errorMessage = typeof value.errorMessage === 'string' ? value.errorMessage : '';

  if (/heap out of memory|allocation failed|javascript heap/i.test(errorMessage)) {
    return 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_NODE_HEAP_OOM';
  }
  if (/cannot find module|err_module_not_found|module not found/i.test(errorMessage)) {
    return 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_MODULE_RESOLUTION';
  }
  if (errorType === 'ProxyIntegrationError') {
    return 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_PROXY_INTEGRATION';
  }

  const safeTypes = new Map([
    ['Error', 'ERROR'],
    ['TypeError', 'TYPE_ERROR'],
    ['RangeError', 'RANGE_ERROR'],
    ['ReferenceError', 'REFERENCE_ERROR'],
    ['SyntaxError', 'SYNTAX_ERROR'],
    ['EvalError', 'EVAL_ERROR'],
    ['URIError', 'URI_ERROR'],
    ['AggregateError', 'AGGREGATE_ERROR'],
  ]);
  const safeType = safeTypes.get(errorType);
  return safeType === undefined
    ? 'INITIAL_BOOTSTRAP_FUNCTION_ERROR_OTHER'
    : `INITIAL_BOOTSTRAP_FUNCTION_ERROR_NODE_${safeType}`;
}

if (typeof originalFetch === 'function') {
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (
      response.status === 502
      && response.headers.get('x-function-error')?.toLowerCase() === 'true'
    ) {
      const diagnosticResponse = response.clone();
      diagnosticPromise = readLimitedUtf8(diagnosticResponse).then(classifyFunctionErrorBody);
    }
    return response;
  };
}

await import('./invoke-yandex-initial-bootstrap.mjs');
const diagnostic = await diagnosticPromise;
if (diagnostic !== null) process.stderr.write(`${diagnostic}\n`);
