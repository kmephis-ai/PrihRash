import assert from 'node:assert/strict';
import test from 'node:test';
import { StatusIds_StatusCode } from '@ydbjs/api/operation';

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

test('SDK transaction wrapper cannot leak provider body failure', async () => {
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

test('transaction query failure stays raw until SDK retry policy can retry the whole body', async () => {
  class YDBError extends Error {
    constructor(code) {
      super('synthetic private YDB issue text');
      this.code = code;
      this.issues = [{ message: 'synthetic private issue payload' }];
    }
  }

  const providerFailure = new YDBError(StatusIds_StatusCode.OVERLOADED);
  let attempts = 0;
  const sql = rejectingExecutor(new Error('unused'));
  sql.begin = async (options, work) => {
    assert.deepEqual(options, { isolation: 'serializableReadWrite', idempotent: false });
    attempts += 1;
    try {
      if (attempts === 1) return await work(rejectingExecutor(providerFailure));
      return await work(() => {
        const builder = {
          parameter() { return builder; },
          then(resolve, reject) { return Promise.resolve([[]]).then(resolve, reject); },
        };
        return builder;
      });
    } catch (error) {
      if (attempts === 1 && error === providerFailure) {
        return sql.begin(options, work);
      }
      throw error;
    }
  };
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(sql, ignoredParameterMapper));

  const result = await adapter.serializableReadWrite((transaction) => (
    transaction.execute(writeStatement('UPSERT INTO synthetic SELECT 1'))
  ));

  assert.deepEqual(result.rows, []);
  assert.equal(attempts, 2);
});

test('SDK transaction wrapper preserves application body failure identity', async () => {
  const bodyFailure = new Error('synthetic application body failure');
  const sql = rejectingExecutor(new Error('unused'));
  sql.begin = async (_options, work) => {
    try {
      return await work(rejectingExecutor(new Error('query not expected')));
    } catch (error) {
      throw new Error('Transaction failed.', { cause: error });
    }
  };
  const adapter = new YdbAdapter(createYdbJsV6DataTransport(sql, ignoredParameterMapper));

  await assert.rejects(
    () => adapter.serializableReadWrite(async () => { throw bodyFailure; }),
    (error) => error === bodyFailure,
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
