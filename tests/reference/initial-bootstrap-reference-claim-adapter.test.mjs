import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YdbAdapter,
  readStatement,
  writeStatement,
} from '../../dist/integration/ydb/adapter.js';
import {
  prepareAccountReferenceInsert,
  prepareCategoryReferenceInsert,
  prepareVikaReferenceInsert,
} from '../../dist/reference/initialBootstrapReferencePersistence.js';
import {
  createInitialBootstrapReferenceClaimAdapter,
} from '../../dist/runtime/initialBootstrapReferenceClaimAdapter.js';

const ACCOUNT = '00000000-0000-0000-0000-000000008001';
const CATEGORY = '00000000-0000-0000-0000-000000008002';
const MEMBER = '00000000-0000-0000-0000-000000008003';

function referencePlan() {
  return Object.freeze({
    resolver: Object.freeze({}),
    expectedAccounts: Object.freeze([Object.freeze({
      sourceLabel: 'Карта Visa',
      currency: 'RUB',
      accountId: ACCOUNT,
    })]),
    expectedCategories: Object.freeze([Object.freeze({
      kind: 'EXPENSE',
      sourceLabel: 'Synthetic Expense',
      categoryId: CATEGORY,
    })]),
    vikaMemberId: MEMBER,
    writes: Object.freeze([
      prepareAccountReferenceInsert(ACCOUNT, 'Карта Visa'),
      prepareCategoryReferenceInsert(CATEGORY, 'EXPENSE', 'Synthetic Expense'),
      prepareVikaReferenceInsert(MEMBER),
    ]),
  });
}

function recordingAdapter() {
  const outsideReads = [];
  const transactions = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      outsideReads.push(statement.text);
      return { rows: [] };
    },
    async serializableReadWrite(work) {
      const operations = [];
      const local = {
        accountInserted: false,
        categoryInserted: false,
        memberInserted: false,
      };
      const result = await work({
        async execute(statement) {
          operations.push(Object.freeze({ kind: statement.kind, text: statement.text }));
          if (statement.kind === 'WRITE') {
            if (/^INSERT INTO accounts/u.test(statement.text)) local.accountInserted = true;
            if (/^INSERT INTO categories/u.test(statement.text)) local.categoryInserted = true;
            if (/^INSERT INTO family_members/u.test(statement.text)) local.memberInserted = true;
            return { rows: [] };
          }
          if (/FROM accounts/u.test(statement.text)) {
            return {
              rows: local.accountInserted
                ? [{ id: ACCOUNT, normalized_source_label: 'Карта Visa', currency: 'RUB' }]
                : [],
            };
          }
          if (/FROM categories/u.test(statement.text)) {
            return {
              rows: local.categoryInserted
                ? [{ id: CATEGORY, kind: 'EXPENSE', normalized_source_label: 'Synthetic Expense' }]
                : [],
            };
          }
          if (/FROM family_members/u.test(statement.text)) {
            return {
              rows: local.memberInserted
                ? [{ id: MEMBER, name: 'Вика', status: 'ACTIVE' }]
                : [],
            };
          }
          return { rows: [] };
        },
      });
      transactions.push(Object.freeze(operations));
      return result;
    },
  });
  return { adapter, outsideReads, transactions };
}

test('reference writes are claimed only inside the first delegated serializable transaction', async () => {
  const recording = recordingAdapter();
  const adapter = createInitialBootstrapReferenceClaimAdapter(
    recording.adapter,
    referencePlan(),
  );

  await adapter.read(readStatement('SELECT read_only_preflight'));
  assert.deepEqual(recording.outsideReads, ['SELECT read_only_preflight']);
  assert.equal(recording.transactions.length, 0);

  await adapter.serializableReadWrite(async (transaction) => {
    await transaction.execute(writeStatement('DELEGATED_INITIAL_CLAIM_WRITE'));
  });

  assert.equal(recording.transactions.length, 1);
  const firstWrites = recording.transactions[0]
    .filter((operation) => operation.kind === 'WRITE')
    .map((operation) => operation.text);
  assert.equal(firstWrites.length, 4);
  assert.match(firstWrites[0], /^INSERT INTO accounts/u);
  assert.match(firstWrites[1], /^INSERT INTO categories/u);
  assert.match(firstWrites[2], /^INSERT INTO family_members/u);
  assert.equal(firstWrites[3], 'DELEGATED_INITIAL_CLAIM_WRITE');

  await adapter.serializableReadWrite(async (transaction) => {
    await transaction.execute(writeStatement('DELEGATED_LATER_WRITE'));
  });

  assert.equal(recording.transactions.length, 2);
  const secondWrites = recording.transactions[1]
    .filter((operation) => operation.kind === 'WRITE')
    .map((operation) => operation.text);
  assert.deepEqual(secondWrites, ['DELEGATED_LATER_WRITE']);
});
