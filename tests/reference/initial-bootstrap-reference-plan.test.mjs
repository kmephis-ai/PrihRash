import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { planInitialReferenceBootstrap } from '../../dist/reference/initialBootstrapReferencePlan.js';

const ACCOUNT = '00000000-0000-0000-0000-000000007001';
const CATEGORY = '00000000-0000-0000-0000-000000007002';
const MEMBER = '00000000-0000-0000-0000-000000007003';
const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function financialPayload() {
  return Object.freeze({
    adapter_schema_version: 3,
    date: N('45292'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Expense'),
    description: S('Synthetic'),
    expense_amount: N('10'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  });
}

function planningAdapter({ accounts = [], categories = [], members = [] } = {}) {
  return new YdbAdapter({
    async executeRead() {
      throw new Error('OUTSIDE_TRANSACTION_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          assert.equal(statement.kind, 'READ');
          if (/FROM accounts/.test(statement.text)) return { rows: accounts };
          if (/FROM categories/.test(statement.text)) return { rows: categories };
          if (/FROM family_members/.test(statement.text)) return { rows: members };
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });
}

test('empty YDB references produce deterministic missing-reference writes and in-memory resolver', async () => {
  const ids = [ACCOUNT, CATEGORY, MEMBER];
  let index = 0;
  const plan = await planInitialReferenceBootstrap(
    planningAdapter(),
    [{ sourceOrdinal: 0, rawPayload: financialPayload() }],
    { allocateReferenceId: () => ids[index++] },
  );

  assert.equal(index, 3);
  assert.equal(plan.writes.length, 3);
  assert.deepEqual(plan.writes.map((statement) => statement.kind), ['WRITE', 'WRITE', 'WRITE']);
  assert.match(plan.writes[0].text, /^INSERT INTO accounts/u);
  assert.match(plan.writes[1].text, /^INSERT INTO categories/u);
  assert.match(plan.writes[2].text, /^INSERT INTO family_members/u);
  assert.equal(plan.resolver.resolveAccountId('Карта Visa'), ACCOUNT);
  assert.equal(plan.resolver.resolveCategoryId('EXPENSE', 'Synthetic Expense'), CATEGORY);
  assert.equal(plan.resolver.vikaMemberId, MEMBER);
});

test('existing exact references are reused without rewrite or new identity allocation', async () => {
  let allocations = 0;
  const plan = await planInitialReferenceBootstrap(
    planningAdapter({
      accounts: [{ id: ACCOUNT, normalized_source_label: 'Карта Visa', currency: 'RUB' }],
      categories: [{ id: CATEGORY, kind: 'EXPENSE', normalized_source_label: 'Synthetic Expense' }],
      members: [{ id: MEMBER, name: 'Вика', status: 'ACTIVE' }],
    }),
    [{ sourceOrdinal: 0, rawPayload: financialPayload() }],
    { allocateReferenceId: () => { allocations += 1; return MEMBER; } },
  );

  assert.equal(allocations, 0);
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.resolver.resolveAccountId('Карта Visa'), ACCOUNT);
  assert.equal(plan.resolver.resolveCategoryId('EXPENSE', 'Synthetic Expense'), CATEGORY);
  assert.equal(plan.resolver.vikaMemberId, MEMBER);
});
