import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ReferenceResolverSnapshotError,
  buildReferenceResolverSnapshot,
} from '../../dist/reference/resolver.js';

const ACCOUNT_A = '00000000-0000-0000-0000-000000005001';
const ACCOUNT_B = '00000000-0000-0000-0000-000000005002';
const CATEGORY_EXPENSE = '00000000-0000-0000-0000-000000005101';
const CATEGORY_INCOME = '00000000-0000-0000-0000-000000005102';
const MEMBER = '00000000-0000-0000-0000-000000005201';

function input() {
  return {
    accounts: [
      { sourceLabel: 'Карта Visa', currency: 'RUB', accountId: ACCOUNT_A },
      { sourceLabel: 'Наличка', currency: 'RUB', accountId: ACCOUNT_B },
    ],
    categories: [
      { kind: 'EXPENSE', sourceLabel: 'Synthetic Shared', categoryId: CATEGORY_EXPENSE },
      { kind: 'INCOME', sourceLabel: 'Synthetic Shared', categoryId: CATEGORY_INCOME },
    ],
    vikaMemberId: MEMBER,
  };
}

test('builds exact immutable resolver from explicit bootstrap mappings', () => {
  const resolver = buildReferenceResolverSnapshot(input());

  assert.equal(resolver.resolveAccountId('  Карта Visa  '), ACCOUNT_A);
  assert.equal(resolver.resolveAccountId('Карта Visa'), ACCOUNT_A);
  assert.equal(resolver.resolveAccountId('карта Visa'), null);
  assert.equal(resolver.resolveAccountId('Visa'), null);
  assert.equal(resolver.resolveCategoryId('EXPENSE', ' Synthetic Shared '), CATEGORY_EXPENSE);
  assert.equal(resolver.resolveCategoryId('INCOME', 'Synthetic Shared'), CATEGORY_INCOME);
  assert.equal(resolver.resolveCategoryId('EXPENSE', 'synthetic shared'), null);
  assert.equal(resolver.vikaMemberId, MEMBER);
  assert.equal(Object.isFrozen(resolver), true);
});

test('NFC-equivalent account labels collide instead of becoming aliases', () => {
  const broken = input();
  broken.accounts = [
    { sourceLabel: 'Cafe\u0301', currency: 'RUB', accountId: ACCOUNT_A },
    { sourceLabel: 'Café', currency: 'RUB', accountId: ACCOUNT_B },
  ];
  assert.throws(
    () => buildReferenceResolverSnapshot(broken),
    (error) => error instanceof ReferenceResolverSnapshotError
      && error.code === 'DUPLICATE_ACCOUNT_SOURCE_KEY',
  );
});

test('same category label remains valid across EXPENSE and INCOME kinds', () => {
  const resolver = buildReferenceResolverSnapshot(input());
  assert.notEqual(
    resolver.resolveCategoryId('EXPENSE', 'Synthetic Shared'),
    resolver.resolveCategoryId('INCOME', 'Synthetic Shared'),
  );
});

for (const [name, mutate, code] of [
  ['invalid account id', (value) => { value.accounts[0].accountId = 'bad'; }, 'INVALID_ACCOUNT_ID'],
  ['invalid category id', (value) => { value.categories[0].categoryId = 'bad'; }, 'INVALID_CATEGORY_ID'],
  ['invalid Vika member id', (value) => { value.vikaMemberId = 'bad'; }, 'INVALID_VIKA_MEMBER_ID'],
  ['invalid account currency', (value) => { value.accounts[0].currency = 'USD'; }, 'INVALID_ACCOUNT_CURRENCY'],
  ['duplicate account target', (value) => { value.accounts[1].accountId = ACCOUNT_A; }, 'DUPLICATE_ACCOUNT_TARGET_ID'],
  ['duplicate category target', (value) => { value.categories[1].categoryId = CATEGORY_EXPENSE; }, 'DUPLICATE_CATEGORY_TARGET_ID'],
  ['duplicate category key', (value) => {
    value.categories[1] = { kind: 'EXPENSE', sourceLabel: ' Synthetic Shared ', categoryId: CATEGORY_INCOME };
  }, 'DUPLICATE_CATEGORY_SOURCE_KEY'],
]) {
  test(`resolver fails closed for ${name}`, () => {
    const value = input();
    mutate(value);
    assert.throws(
      () => buildReferenceResolverSnapshot(value),
      (error) => error instanceof ReferenceResolverSnapshotError && error.code === code,
    );
  });
}
