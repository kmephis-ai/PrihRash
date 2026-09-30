import { EventEmitter } from 'node:events';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';

const EXPECTED_ORIGIN = 'https://functions.yandexcloud.net';
const DEFAULT_EXPECTED_TAG = 'r1-initial-bootstrap';
const EXPECTED_TOKEN = 'synthetic-short-lived-iam-token';

function fail(message) {
  throw new Error(`mock fetch contract violation: ${message}`);
}

globalThis.fetch = async (input, init = {}) => {
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
  const headers = new Headers(init.headers);
  if (headers.get('authorization') !== `Bearer ${EXPECTED_TOKEN}`) fail('unexpected authorization');

  const mode = process.env.PRIHRASH_TEST_FETCH_MODE ?? 'response';
  if (mode === 'timeout') {
    const error = new Error('synthetic timeout');
    error.name = 'TimeoutError';
    throw error;
  }
  if (mode === 'failure') throw new Error('synthetic transport failure');
  if (mode !== 'response') fail('unexpected mode');

  const status = Number(process.env.PRIHRASH_TEST_FETCH_STATUS ?? '200');
  const responseHeaders = new Headers();
  if (process.env.PRIHRASH_TEST_FUNCTION_ERROR === 'true') {
    responseHeaders.set('x-function-error', 'true');
  }
  return new Response(process.env.PRIHRASH_TEST_FETCH_BODY ?? '', {
    status,
    headers: responseHeaders,
  });
};


function requestHeader(init, name) {
  const headers = init?.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value);
  }
  return null;
}

function mockHttpsResponse() {
  const response = Readable.from([Buffer.from(process.env.PRIHRASH_TEST_FETCH_BODY ?? '', 'utf8')]);
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
  if (requestHeader(init, 'authorization') !== `Bearer ${EXPECTED_TOKEN}`) {
    fail('unexpected authorization');
  }

  const request = new EventEmitter();
  let finished = false;
  request.end = () => {
    if (finished) return;
    finished = true;
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
      callback(mockHttpsResponse());
    });
  };
  request.destroy = (error) => {
    if (finished && error === undefined) return;
    finished = true;
    if (error !== undefined) queueMicrotask(() => request.emit('error', error));
  };
  return request;
};

syncBuiltinESMExports();
