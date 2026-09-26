import assert from 'node:assert/strict';
import test from 'node:test';
import { readStatement, YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { YdbJsV6DataTransportError } from '../../dist/integration/ydb/ydbJsV6DataTransport.js';
import { utf8Parameter } from '../../dist/integration/ydb/parameters.js';
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
  const rows = [
    ...accountRows.map((row) => ({
      reference_type: 1,
      id: row.id,
      source_label: row.normalized_source_label,
      descriptor: row.currency,
    })),
    ...categoryRows.map((row) => ({
      reference_type: 2,
      id: row.id,
      source_label: row.normalized_source_label,
      descriptor: row.kind,
    })),
    ...memberRows.map((row) => ({
      reference_type: 3,
      id: row.id,
      source_label: row.name,
      descriptor: row.status,
    })),
  ];
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      observed.outsideReads += 1;
      observed.calls.push(statement);
      return { rows };
    },
    async serializableReadWrite(work) {
      observed.transactionCount += 1;
      return work({ async execute() { throw new Error('TRANSACTION_READ_FORBIDDEN'); } });
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

test('builds immutable resolver from one tagged YDB snapshot read including exact active Vika member', async () => {
  const { adapter, observed } = makeSnapshotAdapter(validAccounts(), validCategories(), validMember());
  const resolver = await readYdbReferenceResolverSnapshot(adapter);

  assert.equal(observed.outsideReads, 1);
  assert.equal(observed.transactionCount, 0);
  assert.equal(observed.calls.length, 1);
  assert.deepEqual(observed.calls.map((statement) => statement.kind), ['READ']);
  assert.match(observed.calls[0].text, /SELECT CAST\(1 AS Uint32\) AS reference_type/);
  assert.match(observed.calls[0].text, /FROM accounts WHERE normalized_source_label IS NOT NULL/);
  assert.match(observed.calls[0].text, /UNION ALL[\s\S]*SELECT CAST\(2 AS Uint32\) AS reference_type/);
  assert.match(observed.calls[0].text, /UNION ALL[\s\S]*SELECT CAST\(3 AS Uint32\) AS reference_type/);
  assert.match(observed.calls[0].text, /FROM family_members WHERE name = \$name AND status = \$status/);
  assert.deepEqual(observed.calls[0].parameters, {
    name: { type: 'Utf8', value: 'Вика' },
    status: { type: 'Utf8', value: 'ACTIVE' },
  });

  assert.equal(resolver.vikaMemberId, MEMBER);
  assert.equal(resolver.resolveAccountId('Карта Visa'), ACCOUNT_A);
  assert.equal(resolver.resolveCategoryId('EXPENSE', 'Synthetic Shared'), CATEGORY_EXPENSE);
  assert.equal(resolver.resolveCategoryId('INCOME', 'Synthetic Shared'), CATEGORY_INCOME);
  assert.equal(Object.isFrozen(resolver), true);
});

test('reference-read observer reports the single statement without extra requests', async () => {
  const { adapter, observed } = makeSnapshotAdapter(validAccounts(), validCategories(), validMember());
  const stages = [];
  await readYdbReferenceResolverSnapshot(adapter, (stage) => stages.push(stage));

  assert.deepEqual(stages, ['REFERENCE_SNAPSHOT_READ']);
  assert.equal(observed.outsideReads, 1);
  assert.equal(observed.transactionCount, 0);
  assert.equal(observed.calls.length, 1);
});

test('reference-read observer failure cannot alter resolver semantics or request count', async () => {
  const { adapter, observed } = makeSnapshotAdapter(validAccounts(), validCategories(), validMember());
  const seen = [];
  const resolver = await readYdbReferenceResolverSnapshot(adapter, (stage) => {
    seen.push(stage);
    throw new Error('diagnostic observer failure');
  });

  assert.deepEqual(seen, ['REFERENCE_SNAPSHOT_READ']);
  assert.equal(observed.calls.length, 1);
  assert.equal(resolver.vikaMemberId, MEMBER);
});

test('one tagged snapshot read avoids synthetic RESOURCE_EXHAUSTED at the third transaction query', async () => {
  let transactionReadCount = 0;
  const exhaustedAdapter = new YdbAdapter({
    async executeRead() { throw new Error('UNEXPECTED_OUTSIDE_READ'); },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          transactionReadCount += 1;
          if (transactionReadCount === 3) {
            throw new YdbJsV6DataTransportError('QUERY_EXECUTION_YDB_RESOURCE_EXHAUSTED');
          }
          if (/FROM accounts/.test(statement.text)) return { rows: validAccounts() };
          if (/FROM categories/.test(statement.text)) return { rows: validCategories() };
          throw new Error('UNEXPECTED_STATEMENT');
        },
      });
    },
  });

  await assert.rejects(
    () => exhaustedAdapter.serializableReadWrite(async (transaction) => {
      await readYdbReferenceMappingEvidence(transaction);
      return transaction.read(readStatement(
        'SELECT id, name, status FROM family_members WHERE name = $name AND status = $status',
        {
          name: utf8Parameter('Вика'),
          status: utf8Parameter('ACTIVE'),
        },
      ));
    }),
    (error) => error instanceof YdbJsV6DataTransportError
      && error.code === 'QUERY_EXECUTION_YDB_RESOURCE_EXHAUSTED',
  );
  assert.equal(transactionReadCount, 3);

  const { adapter, observed } = makeSnapshotAdapter(validAccounts(), validCategories(), validMember());
  const resolver = await readYdbReferenceResolverSnapshot(adapter);
  assert.equal(resolver.vikaMemberId, MEMBER);
  assert.equal(observed.calls.length, 1);
  assert.equal(observed.transactionCount, 0);
});

test('tagged snapshot reader distinguishes missing and unknown row-kind evidence', async () => {
  const adapterFor = (referenceRows) => new YdbAdapter({
    async executeRead() {
      return { rows: referenceRows };
    },
    async serializableReadWrite() { throw new Error('TRANSACTION_READ_FORBIDDEN'); },
  });

  await assert.rejects(
    () => readYdbReferenceResolverSnapshot(adapterFor([{ reference_type: 99 }])),
    (error) => error instanceof YdbReferenceEvidenceReaderError
      && error.code === 'REFERENCE_SNAPSHOT_KIND_UNKNOWN',
  );
  await assert.rejects(
    () => readYdbReferenceResolverSnapshot(adapterFor([{}])),
    (error) => error instanceof YdbReferenceEvidenceReaderError
      && error.code === 'REFERENCE_SNAPSHOT_KIND_MISSING',
  );
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
