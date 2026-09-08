import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  READER_FILTER_OPTIONS_API_VERSION,
  ReaderFilterOptionsError,
  executeReaderFilterOptionsApiRequest,
} from '../../dist/reader/filterOptionsApi.js';

const ACCOUNT_A = '00000000-0000-0000-0000-000000000201';
const ACCOUNT_B = '00000000-0000-0000-0000-000000000202';
const CATEGORY_EXPENSE = '00000000-0000-0000-0000-000000000301';
const CATEGORY_INCOME = '00000000-0000-0000-0000-000000000302';

const COMMITTED_RUN_ROW = Object.freeze({
  id: '00000000-0000-0000-0000-000000000901',
  started_at: '2026-09-08T07:00:00.000Z',
  finished_at: '2026-09-08T07:00:05.000Z',
  source_snapshot_digest: 'synthetic-filter-options-verified-shadow',
  state: 'COMMITTED',
  rows_seen: 2n,
  rows_new: 2n,
  rows_changed: 0n,
  rows_missing: 0n,
  rows_ambiguous: 0n,
  error_code: null,
});

function createAdapter(capture, {
  committed = true,
  accounts = [
    { id: ACCOUNT_B, name: 'Наличка', currency: 'RUB' },
    { id: ACCOUNT_A.toUpperCase(), name: 'Карта Visa', currency: 'RUB' },
  ],
  categories = [
    { id: CATEGORY_INCOME, name: 'Зарплата', kind: 'INCOME' },
    { id: CATEGORY_EXPENSE.toUpperCase(), name: 'Продукты', kind: 'EXPENSE' },
  ],
  failReferences = false,
} = {}) {
  return new YdbAdapter({
    async executeRead(statement) {
      capture.push(statement);
      if (statement.text.includes('FROM migration_runs WHERE state IN')) {
        return { rows: committed ? [COMMITTED_RUN_ROW] : [] };
      }
      if (failReferences) throw new Error('private provider failure');
      if (statement.text.includes('FROM accounts')) return { rows: accounts };
      if (statement.text.includes('FROM categories')) return { rows: categories };
      throw new Error('unexpected read');
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });
}

function expectCode(code) {
  return (error) => error instanceof ReaderFilterOptionsError
    && error.code === code
    && error.message === code;
}

test('filter options require verified shadow before reference reads and return deterministic canonical options', async () => {
  const capture = [];
  const response = await executeReaderFilterOptionsApiRequest(createAdapter(capture));

  assert.deepEqual(response, {
    apiVersion: READER_FILTER_OPTIONS_API_VERSION,
    accounts: [
      { id: ACCOUNT_A, label: 'Карта Visa' },
      { id: ACCOUNT_B, label: 'Наличка' },
    ],
    categories: [
      { id: CATEGORY_EXPENSE, label: 'Продукты', kind: 'EXPENSE' },
      { id: CATEGORY_INCOME, label: 'Зарплата', kind: 'INCOME' },
    ],
  });
  assert.equal(capture.length, 3);
  assert.match(capture[0].text, /FROM migration_runs WHERE state IN/u);
  assert.equal(capture[1].text, 'SELECT id, name, currency FROM accounts ORDER BY name ASC, id ASC');
  assert.equal(capture[2].text, 'SELECT id, name, kind FROM categories ORDER BY kind ASC, name ASC, id ASC');
  assert.equal(Object.isFrozen(response.accounts), true);
  assert.equal(Object.isFrozen(response.categories), true);
});

test('missing verified shadow blocks before account/category reads', async () => {
  const capture = [];
  await assert.rejects(
    () => executeReaderFilterOptionsApiRequest(createAdapter(capture, { committed: false })),
    expectCode('VERIFIED_SHADOW_UNAVAILABLE'),
  );
  assert.equal(capture.length, 1);
});

test('malformed account/category evidence fails closed with value-free codes', async () => {
  const cases = [
    [{ accounts: [{ id: 'bad', name: 'Synthetic', currency: 'RUB' }] }, 'MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE'],
    [{ accounts: [{ id: ACCOUNT_A, name: 'Synthetic', currency: 'USD' }] }, 'MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE'],
    [{ accounts: [{ id: ACCOUNT_A, name: ' Synthetic ', currency: 'RUB' }] }, 'MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE'],
    [{ categories: [{ id: CATEGORY_EXPENSE, name: 'Synthetic', kind: 'TRANSFER' }] }, 'MALFORMED_CATEGORY_FILTER_OPTION_EVIDENCE'],
    [{ categories: [{ id: CATEGORY_EXPENSE, name: '', kind: 'EXPENSE' }] }, 'MALFORMED_CATEGORY_FILTER_OPTION_EVIDENCE'],
  ];

  for (const [overrides, code] of cases) {
    await assert.rejects(
      () => executeReaderFilterOptionsApiRequest(createAdapter([], overrides)),
      expectCode(code),
    );
  }
});

test('duplicate human choices fail closed without merge or dedupe', async () => {
  await assert.rejects(
    () => executeReaderFilterOptionsApiRequest(createAdapter([], {
      accounts: [
        { id: ACCOUNT_A, name: 'Одинаково', currency: 'RUB' },
        { id: ACCOUNT_B, name: 'Одинаково', currency: 'RUB' },
      ],
    })),
    expectCode('AMBIGUOUS_ACCOUNT_FILTER_OPTION_EVIDENCE'),
  );

  await assert.rejects(
    () => executeReaderFilterOptionsApiRequest(createAdapter([], {
      categories: [
        { id: CATEGORY_EXPENSE, name: 'Одинаково', kind: 'EXPENSE' },
        { id: CATEGORY_INCOME, name: 'Одинаково', kind: 'EXPENSE' },
      ],
    })),
    expectCode('AMBIGUOUS_CATEGORY_FILTER_OPTION_EVIDENCE'),
  );
});

test('reference transport failure is safe and does not expose provider details', async () => {
  await assert.rejects(
    () => executeReaderFilterOptionsApiRequest(createAdapter([], { failReferences: true })),
    (error) => error instanceof ReaderFilterOptionsError
      && error.code === 'FILTER_OPTIONS_READ_FAILED'
      && error.message === 'FILTER_OPTIONS_READ_FAILED'
      && !error.message.includes('private provider failure'),
  );
});
