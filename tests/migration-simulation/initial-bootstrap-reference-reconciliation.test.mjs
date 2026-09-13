import assert from 'node:assert/strict';
import test from 'node:test';

import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  reconcileInitialBootstrapReferenceState,
  reconcileInitialBootstrapReferenceStateEvidence,
} from '../../dist/migration/initialBootstrapReferenceReconciliation.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function expensePayload() {
  return Object.freeze({
    adapter_schema_version: 3,
    date: N('45292'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Food'),
    description: S('Synthetic'),
    expense_amount: N('10'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  });
}

const observations = Object.freeze([{ sourceOrdinal: 0, rawPayload: expensePayload() }]);

function matchingEvidence(overrides = {}) {
  return Object.freeze({
    accounts: Object.freeze([Object.freeze({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Карта Visa',
      kind: 'DEBIT_CARD',
      balance_nature: 'ASSET',
      currency: 'RUB',
      status: 'ACTIVE',
      normalized_source_label: 'Карта Visa',
    })]),
    categories: Object.freeze([Object.freeze({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Synthetic Food',
      kind: 'EXPENSE',
      parent_id: null,
      status: 'ACTIVE',
      sort_order: null,
      normalized_source_label: 'Synthetic Food',
    })]),
    familyMembers: Object.freeze([Object.freeze({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Вика',
      status: 'ACTIVE',
    })]),
    ...overrides,
  });
}

test('reference reconciliation proves exact authoritative-compatible residual state without exposing values', () => {
  assert.deepEqual(
    reconcileInitialBootstrapReferenceStateEvidence(observations, matchingEvidence()),
    {
      verdict: 'RECOVERY_REQUIRED',
      reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
    },
  );
});

test('reference reconciliation fail-closes on semantic drift, extras, or malformed identity', () => {
  const cases = [
    matchingEvidence({
      accounts: [{ ...matchingEvidence().accounts[0], kind: 'UNKNOWN' }],
    }),
    matchingEvidence({
      categories: [
        ...matchingEvidence().categories,
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Synthetic Extra',
          kind: 'EXPENSE',
          parent_id: null,
          status: 'ACTIVE',
          sort_order: null,
          normalized_source_label: 'Synthetic Extra',
        },
      ],
    }),
    matchingEvidence({
      familyMembers: [{ id: 'not-a-uuid', name: 'Вика', status: 'ACTIVE' }],
    }),
  ];

  for (const evidence of cases) {
    assert.deepEqual(
      reconcileInitialBootstrapReferenceStateEvidence(observations, evidence),
      {
        verdict: 'RECOVERY_REQUIRED',
        reason: 'RESIDUAL_REFERENCE_STATE_MISMATCH',
      },
    );
  }
});

test('provider reference reconciliation uses read statements only', async () => {
  const evidence = matchingEvidence();
  const statements = [];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      statements.push(statement);
      assert.equal(statement.kind, 'READ');
      if (statement.text.includes('FROM accounts')) return { rows: evidence.accounts };
      if (statement.text.includes('FROM categories')) return { rows: evidence.categories };
      if (statement.text.includes('FROM family_members')) return { rows: evidence.familyMembers };
      throw new Error('unexpected query');
    },
    async serializableReadWrite() {
      throw new Error('read-write transaction must not be used by reference reconciliation');
    },
  });

  assert.deepEqual(await reconcileInitialBootstrapReferenceState(adapter, observations), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  });
  assert.equal(statements.length, 3);
  assert.equal(statements.every((statement) => statement.kind === 'READ'), true);
});

test('reference reconciliation converts provider read failure to enum-only fail-closed evidence', async () => {
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('synthetic private provider failure');
    },
    async serializableReadWrite() {
      throw new Error('unexpected transaction');
    },
  });

  assert.deepEqual(await reconcileInitialBootstrapReferenceState(adapter, observations), {
    verdict: 'RECOVERY_REQUIRED',
    reason: 'REFERENCE_RECONCILIATION_FAILED',
  });
});
