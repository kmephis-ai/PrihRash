import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ControlledRebuildEvidenceReaderError,
  readControlledRebuildStagingEvidence,
} from '../../dist/migration/initialControlledRebuildEvidenceReader.js';

const tables = Object.freeze({
  transactions: 'rebuild/r_00000000000000000000000000009001/transactions',
  sourceRecords: 'rebuild/r_00000000000000000000000000009001/source_records',
});

function rowSets() {
  return [
    [
      { classification: 'FINANCIAL_RECORD', state: null, row_count: 2n },
      { classification: 'AMBIGUOUS', state: null, row_count: 1n },
      { classification: 'LEGACY_PERIOD_CLOSE', state: null, row_count: 1n },
    ],
    [
      { type: 'EXPENSE', row_count: 1n, total_amount_minor: 10050n },
      { type: 'INCOME', row_count: 1n, total_amount_minor: 20000n },
    ],
    [
      { type: 'EXPENSE', dimension_id: '00000000-0000-0000-0000-000000009301', row_count: 1n, total_amount_minor: 10050n },
      { type: 'INCOME', dimension_id: '00000000-0000-0000-0000-000000009302', row_count: 1n, total_amount_minor: 20000n },
    ],
    [
      { type: 'EXPENSE', dimension_id: '00000000-0000-0000-0000-000000009201', row_count: 1n, total_amount_minor: 10050n },
    ],
    [
      { type: 'INCOME', dimension_id: '00000000-0000-0000-0000-000000009202', row_count: 1n, total_amount_minor: 20000n },
    ],
  ];
}

function fakeTransport(sets = rowSets()) {
  const events = [];
  let queryIndex = 0;
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            events.push(statement.text);
            const rows = sets[queryIndex] ?? [];
            queryIndex += 1;
            return { rows };
          },
        };
        try {
          const value = await work(transaction);
          events.push('commit');
          return value;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    },
  };
}

test('reads all staging reconciliation dimensions in one consistent transaction', async () => {
  const fake = fakeTransport();
  const snapshot = await readControlledRebuildStagingEvidence(new YdbAdapter(fake.transport), tables);

  assert.equal(snapshot.sourceRecordCount, 4);
  assert.equal(snapshot.transactionCount, 2);
  assert.deepEqual(snapshot.classificationCounts, {
    FINANCIAL_RECORD: 2,
    LEGACY_PERIOD_CLOSE: 1,
    NON_FINANCIAL: 0,
    INVALID: 0,
    AMBIGUOUS: 1,
  });
  assert.deepEqual(snapshot.typeAggregates, [
    { type: 'EXPENSE', count: 1, totalAmountMinor: 10050n },
    { type: 'INCOME', count: 1, totalAmountMinor: 20000n },
  ]);
  assert.deepEqual(snapshot.accountAggregates.map((entry) => [entry.type, entry.dimensionId]), [
    ['EXPENSE', '00000000-0000-0000-0000-000000009201'],
    ['INCOME', '00000000-0000-0000-0000-000000009202'],
  ]);
  assert.equal(snapshot.missingSourceRecordCount, 0);
  assert.deepEqual(fake.events.filter((event) => event === 'begin'), ['begin']);
  assert.deepEqual(fake.events.filter((event) => event === 'commit'), ['commit']);
  assert.equal(fake.events.filter((event) => typeof event === 'string' && event.startsWith('SELECT ')).length, 5);
  assert.equal(fake.events.every((event) => typeof event !== 'string' || !event.includes('`transactions`')), true);
});

test('all queries target only the exact run-scoped staging paths', async () => {
  const fake = fakeTransport();
  await readControlledRebuildStagingEvidence(new YdbAdapter(fake.transport), tables);
  const queries = fake.events.filter((event) => typeof event === 'string' && event.startsWith('SELECT '));

  assert.equal(queries[0].includes('`rebuild/r_00000000000000000000000000009001/source_records`'), true);
  assert.equal(queries.slice(1).every((query) => query.includes('`rebuild/r_00000000000000000000000000009001/transactions`')), true);
});

test('malformed provider classification/state evidence rolls back the read transaction', async () => {
  const sets = rowSets();
  sets[0] = [{ classification: null, state: null, row_count: 1n }];
  const fake = fakeTransport(sets);

  await assert.rejects(
    () => readControlledRebuildStagingEvidence(new YdbAdapter(fake.transport), tables),
    (error) => error instanceof ControlledRebuildEvidenceReaderError
      && error.code === 'MALFORMED_SOURCE_AGGREGATE_ROW',
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('lossy/negative counts and malformed dimension UUIDs fail closed', async () => {
  for (const [setIndex, replacement, code] of [
    [1, [{ type: 'EXPENSE', row_count: Number.MAX_SAFE_INTEGER + 1, total_amount_minor: 1n }], 'COUNT_OUT_OF_RANGE'],
    [2, [{ type: 'EXPENSE', dimension_id: 'not-a-uuid', row_count: 1n, total_amount_minor: 1n }], 'MALFORMED_DIMENSION_AGGREGATE_ROW'],
  ]) {
    const sets = rowSets();
    sets[setIndex] = replacement;
    await assert.rejects(
      () => readControlledRebuildStagingEvidence(new YdbAdapter(fakeTransport(sets).transport), tables),
      (error) => error instanceof ControlledRebuildEvidenceReaderError && error.code === code,
    );
  }
});

test('rejects arbitrary/non-paired staging table paths before opening transaction', async () => {
  const fake = fakeTransport();
  await assert.rejects(
    () => readControlledRebuildStagingEvidence(
      new YdbAdapter(fake.transport),
      { ...tables, transactions: 'transactions' },
    ),
    (error) => error instanceof ControlledRebuildEvidenceReaderError
      && error.code === 'INVALID_STAGING_TABLE_PATH',
  );
  assert.deepEqual(fake.events, ['begin', 'rollback']);
});
