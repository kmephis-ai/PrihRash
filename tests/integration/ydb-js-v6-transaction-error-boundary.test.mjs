import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YdbAdapter,
  writeStatement,
} from '../../dist/integration/ydb/adapter.js';
import {
  YdbJsV6DataTransportError,
  createYdbJsV6DataTransport,
} from '../../dist/integration/ydb/ydbJsV6DataTransport.js';

function rejectingExecutor(error) {
  return function executor() {
    const builder = {
      parameter() {
        return builder;
      },
      then(resolve, reject) {
        return Promise.reject(error).then(resolve, reject);
      },
    };
    return builder;
  };
}

function ignoredParameterMapper() {
  throw new Error('test statement has no parameters');
}

test('SDK transaction wrapper cannot erase typed body failure', async () => {
  const providerFailure = new Error('synthetic private provider detail');
  const sql = rejectingExecutor(providerFailure);
  sql.begin = async (_options, work) => {
    try {
      return await work(rejectingExecutor(providerFailure));
    } catch (error) {
      throw new Error('Transaction failed.', { cause: error });
    }
  };
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(sql, ignoredParameterMapper));

  await assert.rejects(
    () => adapter.serializableReadWrite((transaction) => (
      transaction.execute(writeStatement('UPSERT INTO synthetic SELECT 1'))
    )),
    (error) => error instanceof YdbJsV6DataTransportError
      && error.code === 'QUERY_EXECUTION_FAILED'
      && error.message === 'QUERY_EXECUTION_FAILED'
      && !('cause' in error),
  );
});

test('pre-body transaction failure stays privacy-safe', async () => {
  const sql = rejectingExecutor(new Error('unused'));
  sql.begin = async () => {
    throw new Error('synthetic private session detail');
  };
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(sql, ignoredParameterMapper));

  await assert.rejects(
    () => adapter.serializableReadWrite(async () => 'not-started'),
    (error) => error instanceof YdbJsV6DataTransportError
      && error.code === 'QUERY_EXECUTION_FAILED'
      && error.message === 'QUERY_EXECUTION_FAILED'
      && !('cause' in error),
  );
});
