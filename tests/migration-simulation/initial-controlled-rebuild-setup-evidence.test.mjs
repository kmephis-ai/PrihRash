import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { YdbSchemeAdapter } from '../../dist/integration/ydb/scheme.js';
import {
  InitialControlledRebuildSetupEvidenceError,
  readInitialControlledRebuildSetupEvidence,
} from '../../dist/migration/initialControlledRebuildSetupEvidence.js';

const RUN_ID = '00000000-0000-0000-0000-000000006301';
const DIRECTORY = 'rebuild/r_00000000000000000000000000006301';
const PLAN = Object.freeze({
  runId: RUN_ID,
  stagingTables: Object.freeze({
    transactions: `${DIRECTORY}/transactions`,
    sourceRecords: `${DIRECTORY}/source_records`,
  }),
  batches: Object.freeze([]),
  replacements: Object.freeze([]),
  expectedSourceRecordCount: 1,
  expectedTransactionCount: 1,
});

function data(counts = [0n, 0n]) {
  return new YdbAdapter({
    async executeRead() { throw new Error('standalone read not expected'); },
    async serializableReadWrite(work) {
      let query = 0;
      const rows = [
        [],
        [],
        [],
        [],
        [],
      ];
      // Current evidence reader derives counts from aggregate queries; empty aggregates mean zero current.
      if (counts[0] !== 0n || counts[1] !== 0n) {
        rows[0] = counts[1] === 0n ? [] : [{ classification: 'NON_FINANCIAL', state: null, row_count: counts[1] }];
        rows[1] = counts[0] === 0n ? [] : [{ type: 'EXPENSE', row_count: counts[0], total_amount_minor: 1n }];
      }
      return work({ async execute() { return { rows: rows[query++] ?? [] }; } });
    },
  });
}

function scheme(listings) {
  const reads = [];
  return {
    reads,
    adapter: new YdbSchemeAdapter({
      async ensureDirectory() { throw new Error('mutation forbidden'); },
      async copyTables() { throw new Error('mutation forbidden'); },
      async renameTables() { throw new Error('mutation forbidden'); },
      async listDirectory(path) {
        reads.push(path);
        const children = listings[path];
        if (children === undefined) throw new Error(`unexpected listing ${path}`);
        return Object.freeze({ selfKind: path === '' ? 'DATABASE' : 'DIRECTORY', children: Object.freeze(children) });
      },
    }),
  };
}

const rootCurrent = [
  Object.freeze({ name: 'transactions', kind: 'TABLE' }),
  Object.freeze({ name: 'source_records', kind: 'TABLE' }),
  Object.freeze({ name: 'migration_runs', kind: 'TABLE' }),
];

test('setup evidence proves absent rebuild tree without mutations', async () => {
  const s = scheme({ '': rootCurrent });
  const evidence = await readInitialControlledRebuildSetupEvidence(s.adapter, data(), PLAN);
  assert.deepEqual(evidence, {
    currentTransactionCount: 0,
    currentSourceRecordCount: 0,
    rebuildDirectoryExists: false,
    stagingDirectoryExists: false,
    stagingTransactionsExists: false,
    stagingSourceRecordsExists: false,
  });
  assert.deepEqual(s.reads, ['']);
});

test('setup evidence recognizes exact existing empty staging pair', async () => {
  const leaf = DIRECTORY.slice('rebuild/'.length);
  const s = scheme({
    '': [...rootCurrent, Object.freeze({ name: 'rebuild', kind: 'DIRECTORY' })],
    rebuild: [Object.freeze({ name: leaf, kind: 'DIRECTORY' })],
    [DIRECTORY]: [
      Object.freeze({ name: 'transactions', kind: 'TABLE' }),
      Object.freeze({ name: 'source_records', kind: 'TABLE' }),
    ],
  });
  const evidence = await readInitialControlledRebuildSetupEvidence(s.adapter, data(), PLAN);
  assert.equal(evidence.rebuildDirectoryExists, true);
  assert.equal(evidence.stagingDirectoryExists, true);
  assert.equal(evidence.stagingTransactionsExists, true);
  assert.equal(evidence.stagingSourceRecordsExists, true);
  assert.deepEqual(s.reads, ['', 'rebuild', DIRECTORY]);
});

test('setup evidence fails closed on foreign or wrong-kind run-scoped state', async () => {
  const leaf = DIRECTORY.slice('rebuild/'.length);
  for (const runChildren of [
    [{ name: 'transactions', kind: 'TABLE' }, { name: 'foreign', kind: 'TABLE' }],
    [{ name: 'transactions', kind: 'DIRECTORY' }, { name: 'source_records', kind: 'TABLE' }],
  ]) {
    const s = scheme({
      '': [...rootCurrent, { name: 'rebuild', kind: 'DIRECTORY' }],
      rebuild: [{ name: leaf, kind: 'DIRECTORY' }],
      [DIRECTORY]: runChildren,
    });
    await assert.rejects(
      () => readInitialControlledRebuildSetupEvidence(s.adapter, data(), PLAN),
      (error) => error instanceof InitialControlledRebuildSetupEvidenceError && error.code === 'RUN_DIRECTORY_INVALID',
    );
  }
});
