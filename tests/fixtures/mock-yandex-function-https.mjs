import { EventEmitter } from 'node:events';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';

const EXPECTED_ORIGIN = 'https://functions.yandexcloud.net';
const DEFAULT_EXPECTED_TAG = 'r1-initial-bootstrap';
const EXPECTED_TOKEN = 'synthetic-short-lived-iam-token';

function fail(message) {
  throw new Error(`mock https contract violation: ${message}`);
}

function headerValue(headers, name) {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value);
  }
  return null;
}

function syntheticResponse() {
  const response = Readable.from([
    Buffer.from(process.env.PRIHRASH_TEST_FETCH_BODY ?? '', 'utf8'),
  ]);
  response.statusCode = Number(process.env.PRIHRASH_TEST_FETCH_STATUS ?? '200');
  response.headers = process.env.PRIHRASH_TEST_FUNCTION_ERROR === 'true'
    ? { 'x-function-error': 'true' }
    : {};
  return response;
}

https.request = (input, init = {}, callback) => {
  const url = new URL(input);
  const expectedFunctionId = process.env.PRIHRASH_TEST_FUNCTION_ID;
  if (!expectedFunctionId) fail('missing expected function id');
  if (url.origin !== EXPECTED_ORIGIN) fail('unexpected origin');
  if (url.pathname !== `/${encodeURIComponent(expectedFunctionId)}`) fail('unexpected function path');
  const expectedTag = process.env.PRIHRASH_TEST_FUNCTION_TAG ?? DEFAULT_EXPECTED_TAG;
  if (url.searchParams.get('tag') !== expectedTag) fail('unexpected tag');
  const expectedIntegration = process.env.PRIHRASH_TEST_FUNCTION_INTEGRATION ?? 'raw';
  if (url.searchParams.get('integration') !== expectedIntegration) fail('unexpected integration mode');
  if (init.method !== 'POST') fail('POST is required');
  if (init.agent !== false) fail('one-shot transport must disable agent reuse');
  if (headerValue(init.headers, 'authorization') !== `Bearer ${EXPECTED_TOKEN}`) {
    fail('unexpected authorization');
  }

  const request = new EventEmitter();
  let ended = false;
  let destroyed = false;

  request.end = () => {
    if (ended || destroyed) return;
    ended = true;
    queueMicrotask(() => {
      const mode = process.env.PRIHRASH_TEST_FETCH_MODE ?? 'response';
      if (mode === 'timeout') {
        const error = new Error('synthetic timeout');
        error.name = 'TimeoutError';
        request.emit('error', error);
        return;
      }
      if (mode === 'failure') {
        request.emit('error', new Error('synthetic transport failure'));
        return;
      }
      if (mode !== 'response') {
        request.emit('error', new Error('mock request contract violation'));
        return;
      }
      callback(syntheticResponse());
    });
  };

  request.destroy = (error) => {
    if (destroyed) return;
    destroyed = true;
    if (error !== undefined) queueMicrotask(() => request.emit('error', error));
  };

  return request;
};

syncBuiltinESMExports();
