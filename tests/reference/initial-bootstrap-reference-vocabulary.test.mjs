import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InitialReferenceBootstrapVocabularyError,
  deriveInitialReferenceBootstrapVocabulary,
} from '../../dist/reference/initialBootstrapReferenceVocabulary.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });

function payload(overrides = {}) {
  return Object.freeze({
    adapter_schema_version: 3,
    date: N('45292'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S(' Synthetic Shared '),
    description: S('Synthetic'),
    expense_amount: N('10'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  });
}

test('derives exact accounts and kind-scoped categories only from financial rows', () => {
  const result = deriveInitialReferenceBootstrapVocabulary([
    { sourceOrdinal: 0, rawPayload: payload() },
    {
      sourceOrdinal: 1,
      rawPayload: payload({
        operation_type: S('Доход'),
        expense_account: null,
        expense_category: null,
        expense_amount: null,
        income_account: S('Карта Visa'),
        income_category: S('Synthetic Shared'),
        income_amount: N('20'),
      }),
    },
    {
      sourceOrdinal: 2,
      rawPayload: payload({
        expense_account: S('Наличка'),
        expense_category: S('Should not seed'),
        expense_amount: N('0'),
      }),
    },
  ]);

  assert.deepEqual(result.accounts, [
    { sourceLabel: 'Карта Visa' },
  ]);
  assert.deepEqual(result.categories, [
    { kind: 'EXPENSE', sourceLabel: 'Synthetic Shared' },
    { kind: 'INCOME', sourceLabel: 'Synthetic Shared' },
  ]);
  assert.equal(Object.isFrozen(result.accounts), true);
  assert.equal(Object.isFrozen(result.categories), true);
});

test('unknown financial account fails closed before reference writes', () => {
  assert.throws(
    () => deriveInitialReferenceBootstrapVocabulary([
      {
        sourceOrdinal: 0,
        rawPayload: payload({ expense_account: S('Synthetic Unknown Account') }),
      },
    ]),
    (error) => error instanceof InitialReferenceBootstrapVocabularyError
      && error.code === 'UNKNOWN_ACCOUNT_VOCABULARY',
  );
});
