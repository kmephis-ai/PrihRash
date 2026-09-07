import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { buildReferenceResolverSnapshot, ReferenceResolverSnapshotError } from '../../dist/reference/resolver.js';
import {
  YdbReferenceEvidenceReaderError,
  readYdbReferenceMappingEvidence,
  readYdbReferenceResolverSnapshot,
} from '../../dist/reference/ydbReferenceEvidenceReader.js';

const ACCOUNT_A = '00000000-0000-0000-0000-000000006001';
const ACCOUNT_B = '00000000-0000-0000-0000-000000006002';
const CATEGORY_EXPENSE = '00000000-0000-0000-0000-000000006101';
const CATEGORY_INCOME = '00000000-0000-0000-0000-000000006102';
const MEMBER = '00000000-0000-0000-0000-000000006201';

function makeAdapter(accountRows, categoryRows) {
  const observed = { calls: [] };
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      observed.calls.push(statement);
      if (/FROM accounts/.test(statement.text)) return { rows: accountRows };
      if (/FROM categories/.test(statement.text)) return { rows: categoryRows };
      throw new Error('UNEXPECTED_READ');
    },
    async serializableReadWrite() {
      throw new Error('WRITE_PATH_FORBIDDEN');
    },
  });
  return { adapter, observed };
}

function makeSnapshotAdapter(accountRows, categoryRows, memberRows) {
  const observed = { outsideReads: 0, transactionCount: 0, calls: [] };
  const adapter = new YdbAdapter({
    async executeRead() {
      observed.outsideReads += 1;
      throw new Error('OUTSIDE_TRANSACTION_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      observed.transactionCount += 1;
      return work({
        async execute(statement) {
          observed.calls.push(statement);
          if (/FROM accounts/.test(statement.text)) return { rows: accountRows };
          if (/FROM categories/.test(statement.text)) return { rows: categoryRows };
          if (/FROM family_members/.test(statement.text)) return { rows: memberRows };
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });
  return { adapter, observed };
}

function validAccounts() {
  return [
    { id: ACCOUNT_B.toUpperCase(), normalized_source_label: 'Наличка', currency: 'RUB' },
    { id: ACCOUNT_A, normalized_source_label: 'Карта Visa', currency: 'RUB' },
  ];
}

function validCategories() {
  return [
    { id: CATEGORY_INCOME, kind: 'INCOME', normalized_source_label: 'Synthetic Shared' },
    { id: CATEGORY_EXPENSE, kind: 'EXPENSE', normalized_source_label: 'Synthetic Shared' },
  ];
}

function validMember() {
  return [{ id: MEMBER.toUpperCase(), name: 'Вика', status: 'ACTIVE' }];
}

test('reads exactly two dedicated source-label projections and feeds exact resolver snapshot', async () => {
  const { adapter, observed } = makeAdapter(validAccounts(), validCategories());
  const evidence = await readYdbReferenceMappingEvidence(adapter);

  assert.equal(observed.calls.length, 2);
  for (const statement of observed.calls) {
    assert.equal(statement.kind, 'READ');
    assert.deepEqual(statement.parameters, {});
    assert.doesNotMatch(statement.text, /\bname\b/i);
  }
  assert.match(observed.calls[0].text, /SELECT id, normalized_source_label, currency FROM accounts/);
  assert.match(observed.calls[0].text, /normalized_source_label IS NOT NULL/);
  assert.match(observed.calls[1].text, /SELECT id, kind, normalized_source_label FROM categories/);
  assert.match(observed.calls[1].text, /normalized_source_label IS NOT NULL/);

  assert.deepEqual(evidence.accounts.map((item) => [item.sourceLabel, item.accountId]), [
    ['Карта Visa', ACCOUNT_A],
    ['Наличка', ACCOUNT_B],
  ]);
  assert.deepEqual(evidence.categories.map((item) => [item.kind, item.sourceLabel, item.categoryId]), [
    ['EXPENSE', 'Synthetic Shared', CATEGORY_EXPENSE],
    ['INCOME', 'Synthetic Shared', CATEGORY_INCOME],
  ]);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.accounts), true);
  assert.equal(Object.isFrozen(evidence.categories), true);

  const resolver = buildReferenceResolverSnapshot({ ...evidence, vikaMemberId: MEMBER });
  assert.equal(resolver.resolveAccountId('Карта Visa'), ACCOUNT_A);
  assert.equal(resolver.resolveCategoryId('EXPENSE', 'Synthetic Shared'), CATEGORY_EXPENSE);
  assert.equal(resolver.resolveCategoryId('INCOME', 'Synthetic Shared'), CATEGORY_INCOME);
});

test('builds immutable resolver from one consistent YDB transaction including exact active Vika member', async () => {
  const { adapter, observed } = makeSnapshotAdapter(validAccounts(), validCategories(), validMember());
  const resolver = await readYdbReferenceResolverSnapshot(adapter);

  assert.equal(observed.outsideReads, 0);
  assert.equal(observed.transactionCount, 1);
  assert.equal(observed.calls.length, 3);
  assert.deepEqual(observed.calls.map((statement) => statement.kind), ['READ', 'READ', 'READ']);
  assert.match(observed.calls[2].text, /FROM family_members WHERE name = \$name AND status = \$status/);
  assert.deepEqual(observed.calls[2].parameters, {
    name: { type: 'Utf8', value: 'Вика' },
    status: { type: 'Utf8', value: 'ACTIVE' },
  });

  assert.equal(resolver.vikaMemberId, MEMBER);
  assert.equal(resolver.resolveAccountId('Карта Visa'), ACCOUNT_A);
  assert.equal(resolver.resolveCategoryId('EXPENSE', 'Synthetic Shared'), CATEGORY_EXPENSE);
  assert.equal(resolver.resolveCategoryId('INCOME', 'Synthetic Shared'), CATEGORY_INCOME);
  assert.equal(Object.isFrozen(resolver), true);
});

for (const [name, memberRows, code] of [
  ['missing active Vika member', [], 'VIKA_MEMBER_NOT_FOUND'],
  ['duplicate active Vika member', [
    { id: MEMBER, name: 'Вика', status: 'ACTIVE' },
    { id: '00000000-0000-0000-0000-000000006202', name: 'Вика', status: 'ACTIVE' },
  ], 'DUPLICATE_VIKA_MEMBER_EVIDENCE'],
  ['malformed Vika UUID', [{ id: 'bad', name: 'Вика', status: 'ACTIVE' }], 'MALFORMED_VIKA_MEMBER_EVIDENCE'],
  ['unexpected Vika name', [{ id: MEMBER, name: 'Synthetic Other', status: 'ACTIVE' }], 'MALFORMED_VIKA_MEMBER_EVIDENCE'],
  ['unexpected Vika status', [{ id: MEMBER, name: 'Вика', status: 'ARCHIVED' }], 'MALFORMED_VIKA_MEMBER_EVIDENCE'],
]) {
  test(`consistent resolver fails closed for ${name}`, async () => {
    const { adapter } = makeSnapshotAdapter(validAccounts(), validCategories(), memberRows);
    await assert.rejects(
      () => readYdbReferenceResolverSnapshot(adapter),
      (error) => error instanceof YdbReferenceEvidenceReaderError && error.code === code,
    );
  });
}

for (const [name, accountRows, categoryRows, code] of [
  ['invalid account UUID', [{ id: 'bad', normalized_source_label: 'Карта Visa', currency: 'RUB' }], validCategories(), 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'],
  ['non-RUB account', [{ id: ACCOUNT_A, normalized_source_label: 'Карта Visa', currency: 'USD' }], validCategories(), 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'],
  ['noncanonical account label', [{ id: ACCOUNT_A, normalized_source_label: ' Карта Visa ', currency: 'RUB' }], validCategories(), 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'],
  ['decomposed account label', [{ id: ACCOUNT_A, normalized_source_label: 'Cafe\u0301', currency: 'RUB' }], validCategories(), 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'],
  ['invalid category UUID', validAccounts(), [{ id: 'bad', kind: 'EXPENSE', normalized_source_label: 'Synthetic' }], 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE'],
  ['invalid category kind', validAccounts(), [{ id: CATEGORY_EXPENSE, kind: 'TRANSFER', normalized_source_label: 'Synthetic' }], 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE'],
  ['blank category label', validAccounts(), [{ id: CATEGORY_EXPENSE, kind: 'EXPENSE', normalized_source_label: '' }], 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE'],
]) {
  test(`reader fails closed for ${name}`, async () => {
    const { adapter } = makeAdapter(accountRows, categoryRows);
    await assert.rejects(
      () => readYdbReferenceMappingEvidence(adapter),
      (error) => error instanceof YdbReferenceEvidenceReaderError && error.code === code,
    );
  });
}

test('duplicate normalized source key remains fail-closed in resolver layer', async () => {
  const { adapter } = makeAdapter([
    { id: ACCOUNT_A, normalized_source_label: 'Карта Visa', currency: 'RUB' },
    { id: ACCOUNT_B, normalized_source_label: 'Карта Visa', currency: 'RUB' },
  ], validCategories());
  const evidence = await readYdbReferenceMappingEvidence(adapter);

  assert.throws(
    () => buildReferenceResolverSnapshot({ ...evidence, vikaMemberId: MEMBER }),
    (error) => error instanceof ReferenceResolverSnapshotError
      && error.code === 'DUPLICATE_ACCOUNT_SOURCE_KEY',
  );
});
