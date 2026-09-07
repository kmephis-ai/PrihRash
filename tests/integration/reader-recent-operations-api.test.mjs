import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  READER_API_VERSION,
  ReaderApiRequestError,
  executeReaderRecentOperationsApiRequest,
  parseReaderRecentOperationsApiRequest,
} from '../../dist/reader/recentOperationsApi.js';
import { encodeRecentOperationsCursor } from '../../dist/reader/recentOperations.js';

const ACCOUNT_ID = '00000000-0000-0000-0000-000000000201';
const CATEGORY_ID = '00000000-0000-0000-0000-000000000301';
const TX_ID = '00000000-0000-0000-0000-000000000501';

function adapterCapturing(capture) {
  return new YdbAdapter({
    async executeRead(statement) {
      capture.push(statement);
      return { rows: [] };
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

test('empty query uses stable API defaults', () => {
  const request = parseReaderRecentOperationsApiRequest({});
  assert.deepEqual(request, { limit: 50, filters: {} });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.filters), true);
});

test('known filters and cursor are normalized into existing Reader request shape', () => {
  const cursor = encodeRecentOperationsCursor({
    occurredOn: '2026-09-07',
    capturedAt: '2026-09-07T12:34:56.000Z',
    id: TX_ID,
  });
  const request = parseReaderRecentOperationsApiRequest({
    limit: '25',
    type: 'EXPENSE',
    status: 'VOIDED',
    accountId: ACCOUNT_ID.toUpperCase(),
    categoryId: CATEGORY_ID.toUpperCase(),
    cursor,
  });

  assert.equal(request.limit, 25);
  assert.deepEqual(request.filters, {
    type: 'EXPENSE',
    status: 'VOIDED',
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
  });
  assert.equal(request.cursor, cursor);
});

test('unknown, duplicate-like, blank and noncanonical values fail with safe request codes', () => {
  const cases = [
    [{ typo: 'x' }, 'UNKNOWN_QUERY_PARAMETER'],
    [{ limit: ['10', '20'] }, 'INVALID_QUERY_PARAMETER'],
    [{ type: ['EXPENSE'] }, 'INVALID_QUERY_PARAMETER'],
    [{ limit: '' }, 'INVALID_QUERY_PARAMETER'],
    [{ limit: '01' }, 'INVALID_QUERY_PARAMETER'],
    [{ limit: '101' }, 'INVALID_QUERY_PARAMETER'],
    [{ type: 'DELETE' }, 'INVALID_QUERY_PARAMETER'],
    [{ status: 'HIDDEN' }, 'INVALID_QUERY_PARAMETER'],
    [{ accountId: 'bad' }, 'INVALID_QUERY_PARAMETER'],
    [{ categoryId: 'bad' }, 'INVALID_QUERY_PARAMETER'],
    [{ cursor: '***' }, 'INVALID_QUERY_PARAMETER'],
  ];

  for (const [query, code] of cases) {
    assert.throws(
      () => parseReaderRecentOperationsApiRequest(query),
      (error) => error instanceof ReaderApiRequestError
        && error.code === code
        && error.message === code
        && !error.message.includes(String(Object.values(query)[0])),
    );
  }
});

test('execution delegates to paged Reader and returns versioned JSON-safe envelope', async () => {
  const capture = [];
  const response = await executeReaderRecentOperationsApiRequest(
    adapterCapturing(capture),
    { limit: '7', type: 'INCOME', accountId: ACCOUNT_ID },
  );

  assert.deepEqual(response, {
    apiVersion: READER_API_VERSION,
    items: [],
    pageSize: 7,
    nextCursor: null,
  });
  assert.equal(capture.length, 1);
  assert.equal(capture[0].parameters.limit.value, 8n);
  assert.equal(capture[0].parameters.type.value, 'INCOME');
  assert.equal(capture[0].parameters.account_id.value, ACCOUNT_ID);
  assert.doesNotThrow(() => JSON.stringify(response));
});

test('request validation fails before provider read', async () => {
  const capture = [];
  await assert.rejects(
    () => executeReaderRecentOperationsApiRequest(adapterCapturing(capture), { limit: '0' }),
    (error) => error instanceof ReaderApiRequestError && error.code === 'INVALID_QUERY_PARAMETER',
  );
  assert.equal(capture.length, 0);
});
