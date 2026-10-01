import { request as httpsRequest } from 'node:https';

const BOOTSTRAP_TAG_PATTERN = /^[a-z][-_0-9a-z]*$/;
const FUNCTIONS_ORIGIN = 'https://functions.yandexcloud.net';
const ACCEPT_TIMEOUT_MS = 30_000;

const SAFE_CONFIG_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_ASYNC_CONFIG_INVALID',
});
const SAFE_TRANSPORT_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_ASYNC_INVOKE_FAILED',
});
const SAFE_ACCEPT_TIMEOUT = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_ASYNC_ACCEPTANCE_TIMEOUT',
});

const SAFE_HTTP_STATUS = new Map([
  [400, 'HTTP_400'],
  [401, 'HTTP_401'],
  [403, 'HTTP_403'],
  [404, 'HTTP_404'],
  [413, 'HTTP_413'],
  [429, 'HTTP_429'],
  [500, 'HTTP_500'],
  [502, 'HTTP_502'],
  [503, 'HTTP_503'],
  [504, 'HTTP_504'],
]);

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function safeHttpStatus(status) {
  const exact = SAFE_HTTP_STATUS.get(status);
  if (exact !== undefined) return exact;
  if (status >= 200 && status < 300) return 'HTTP_2XX_OTHER';
  if (status >= 400 && status < 500) return 'HTTP_4XX_OTHER';
  if (status >= 500 && status < 600) return 'HTTP_5XX_OTHER';
  return 'HTTP_OTHER';
}

function timeoutError() {
  const error = new Error('async bootstrap acceptance timeout');
  error.name = 'TimeoutError';
  return error;
}

function isTimeout(error) {
  return error !== null
    && (typeof error === 'object' || typeof error === 'function')
    && Reflect.get(error, 'name') === 'TimeoutError';
}

function invokeAsync(url, iamToken) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    let timeout;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve(result);
    };

    const fail = (error) => {
      finish(isTimeout(error) ? SAFE_ACCEPT_TIMEOUT : SAFE_TRANSPORT_FAILURE);
    };

    try {
      request = httpsRequest(url, {
        method: 'POST',
        headers: Object.freeze({ Authorization: `Bearer ${iamToken}` }),
      }, (response) => {
        const statusCode = Number.isInteger(response.statusCode) ? response.statusCode : 0;
        response.resume();
        if (statusCode === 202) {
          finish(Object.freeze({
            status: 'PASS',
            code: 'INITIAL_BOOTSTRAP_ASYNC_ACCEPTED',
          }));
          return;
        }
        finish(Object.freeze({
          status: 'FAIL',
          code: 'INITIAL_BOOTSTRAP_ASYNC_ACCEPTANCE_HTTP_FAILED',
          httpStatus: safeHttpStatus(statusCode),
        }));
      });
    } catch (error) {
      fail(error);
      return;
    }

    request.once('error', fail);
    timeout = setTimeout(() => request.destroy(timeoutError()), ACCEPT_TIMEOUT_MS);
    request.end();
  });
}

async function invokeInitialBootstrapAsync(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID;
  const functionTag = environment.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_TAG;
  const iamToken = environment.YC_IAM_TOKEN;
  if (!nonBlank(functionId)
    || !nonBlank(functionTag)
    || !BOOTSTRAP_TAG_PATTERN.test(functionTag)
    || !nonBlank(iamToken)) return SAFE_CONFIG_FAILURE;

  const url = new URL(`${FUNCTIONS_ORIGIN}/${encodeURIComponent(functionId)}`);
  url.searchParams.set('tag', functionTag);
  url.searchParams.set('integration', 'async');

  return invokeAsync(url, iamToken);
}

const result = await invokeInitialBootstrapAsync();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'PASS') process.exitCode = 2;
