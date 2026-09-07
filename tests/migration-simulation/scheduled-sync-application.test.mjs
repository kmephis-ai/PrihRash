import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { runScheduledSyncApplication } from '../../dist/migration/scheduledSyncApplication.js';

const BASELINE_RUN = '00000000-0000-0000-0000-00000000b001';
const RUN_ID = '00000000-0000-0000-0000-00000000b002';
const ACCOUNT_ID = '00000000-0000-0000-0000-00000000b003';
const CATEGORY_ID = '00000000-0000-0000-0000-00000000b004';
const MEMBER_ID = '00000000-0000-0000-0000-00000000b005';
const BASELINE_DIGEST = 'baseline-snapshot-digest';
const CHANGED_DIGEST = 'changed-snapshot-digest';
const STARTED_AT = '2026-09-07T18:00:01.000Z';
const OBSERVED_AT = '2026-09-07T18:00:00.000Z';

function runRow(digest = BASELINE_DIGEST) {
  return {
    id: BASELINE_RUN,
    started_at: '2026-09-07T17:00:00.000Z',
    finished_at: '2026-09-07T17:01:00.000Z',
    source_snapshot_digest: digest,
    state: 'COMMITTED',
    rows_seen: 0n,
    rows_new: 0n,
    rows_changed: 0n,
    rows_missing: 0n,
    rows_ambiguous: 0n,
    error_code: null,
  };
}

function snapshotLease(snapshotDigest) {
  return Object.freeze({
    snapshotDigest,
    snapshot: Object.freeze({
      spreadsheetId: 'synthetic-spreadsheet',
      spreadsheetTitle: 'ПрихРасхOnline',
      sheetName: 'Ответы на форму (11)',
      locale: 'ru_RU',
      timeZone: 'Europe/Moscow',
      rows: Object.freeze([Object.freeze({
        rowHint: 2,
        values: Object.freeze([
          Object.freeze({ numberValue: 45500 }),
          Object.freeze({ stringValue: 'Расход' }),
          Object.freeze({ stringValue: 'Карта Visa' }),
          Object.freeze({ stringValue: 'Synthetic Category' }),
          Object.freeze({ stringValue: 'Synthetic Composition' }),
          Object.freeze({ numberValue: 50 }),
          null,
          null,
          null,
          null,
          null,
        ]),
      })]),
    }),
  });
}

function currentEvidence(statement) {
  if (statement.text.includes('FROM source_records WHERE')) return { rows: [] };
  if (statement.text.includes('FROM source_record_revisions AS r')) return { rows: [] };
  if (statement.text.includes('FROM transactions')) return { rows: [] };
  return null;
}

function resolver() {
  return Object.freeze({
    vikaMemberId: MEMBER_ID,
    resolveAccountId(label) {
      return label === 'Карта Visa' ? ACCOUNT_ID : null;
    },
    resolveCategoryId(kind, label) {
      return kind === 'EXPENSE' && label === 'Synthetic Category' ? CATEGORY_ID : null;
    },
  });
}

function noChangeAdapter() {
  return new YdbAdapter({
    async executeRead(statement) {
      assert.match(statement.text, /migration_runs/);
      return { rows: [runRow()] };
    },
    async serializableReadWrite() {
      throw new Error('INCREMENTAL_TRANSACTION_FORBIDDEN');
    },
  });
}

test('NO_CHANGE returns before runtime primitives, references, projection or observation clock', async () => {
  const calls = { source: 0, runtime: 0, refs: 0, digest: 0, clock: 0 };
  const lease = snapshotLease(BASELINE_DIGEST);

  const result = await runScheduledSyncApplication({
    source: Object.freeze({
      async readFullSnapshotObservation() {
        calls.source += 1;
        return lease;
      },
    }),
    adapter: noChangeAdapter(),
    rowDigest: Object.freeze({
      digestCanonicalRow() {
        calls.digest += 1;
        return 'row-digest';
      },
    }),
    observationClock: Object.freeze({
      now() {
        calls.clock += 1;
        return OBSERVED_AT;
      },
    }),
    createRuntimePrimitives() {
      calls.runtime += 1;
      throw new Error('RUNTIME_PRIMITIVES_MUST_NOT_BE_CREATED');
    },
    async readReferenceResolver() {
      calls.refs += 1;
      throw new Error('REFERENCES_MUST_NOT_BE_READ');
    },
  });

  assert.equal(result.decision, 'NO_CHANGE');
  assert.equal(result.incrementalStarted, false);
  assert.equal(result.observedSnapshotDigest, BASELINE_DIGEST);
  assert.deepEqual(calls, { source: 1, runtime: 0, refs: 0, digest: 0, clock: 0 });
});

test('START_INCREMENTAL lazily uses the exact lease with fresh primitives and references before planning', async () => {
  const calls = {
    source: 0,
    runtime: 0,
    refs: 0,
    digest: 0,
    clock: 0,
    runContext: 0,
    sourceAllocate: 0,
    transactionAllocate: 0,
    writes: 0,
  };
  const lease = snapshotLease(CHANGED_DIGEST);
  const adapter = new YdbAdapter({
    async executeRead(statement) {
      assert.match(statement.text, /migration_runs/);
      return { rows: [runRow()] };
    },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          if (statement.kind === 'WRITE') calls.writes += 1;
          if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
            return { rows: [runRow()] };
          }
          const current = currentEvidence(statement);
          if (current !== null) return current;
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });

  await assert.rejects(
    () => runScheduledSyncApplication({
      source: Object.freeze({
        async readFullSnapshotObservation() {
          calls.source += 1;
          return lease;
        },
      }),
      adapter,
      rowDigest: Object.freeze({
        digestCanonicalRow(canonicalRow) {
          calls.digest += 1;
          assert.match(canonicalRow, /Synthetic Composition/);
          return 'synthetic-row-digest';
        },
      }),
      observationClock: Object.freeze({
        now() {
          calls.clock += 1;
          return OBSERVED_AT;
        },
      }),
      createRuntimePrimitives() {
        calls.runtime += 1;
        return Object.freeze({
          createRunContext() {
            calls.runContext += 1;
            return Object.freeze({ runId: RUN_ID, startedAt: STARTED_AT });
          },
          lifecycleClock: Object.freeze({
            now() {
              throw new Error('LIFECYCLE_CLOCK_MUST_NOT_BE_USED');
            },
          }),
          sourceIdentityAllocator: Object.freeze({
            async allocate() {
              calls.sourceAllocate += 1;
              throw new Error('CONTROLLED_STOP_AFTER_PROJECTION');
            },
          }),
          transactionIdentityAllocator: Object.freeze({
            async allocate() {
              calls.transactionAllocate += 1;
              throw new Error('TRANSACTION_ALLOCATOR_MUST_NOT_BE_USED');
            },
          }),
        });
      },
      async readReferenceResolver() {
        calls.refs += 1;
        return resolver();
      },
    }),
    /CONTROLLED_STOP_AFTER_PROJECTION/,
  );

  assert.equal(calls.source, 1);
  assert.equal(calls.runtime, 1);
  assert.equal(calls.refs, 1);
  assert.equal(calls.digest, 1);
  assert.equal(calls.clock, 1);
  assert.equal(calls.runContext, 1);
  assert.equal(calls.sourceAllocate, 1);
  assert.equal(calls.transactionAllocate, 0);
  assert.equal(calls.writes, 0);
});

test('each admitted invocation receives a fresh runtime-primitives binding', async () => {
  const calls = { runtime: 0, refs: 0 };
  const lease = snapshotLease(CHANGED_DIGEST);
  const adapter = new YdbAdapter({
    async executeRead() {
      return { rows: [runRow()] };
    },
    async serializableReadWrite(work) {
      return work({
        async execute(statement) {
          if (statement.text.includes("state IN ('COMMITTED', 'STAGING', 'VALIDATED')")) {
            return { rows: [runRow()] };
          }
          const current = currentEvidence(statement);
          if (current !== null) return current;
          throw new Error(`UNEXPECTED_STATEMENT: ${statement.text}`);
        },
      });
    },
  });

  const dependencies = {
    source: Object.freeze({ async readFullSnapshotObservation() { return lease; } }),
    adapter,
    rowDigest: Object.freeze({ digestCanonicalRow() { return 'row-digest'; } }),
    observationClock: Object.freeze({ now() { return OBSERVED_AT; } }),
    createRuntimePrimitives() {
      calls.runtime += 1;
      const sequence = calls.runtime;
      return Object.freeze({
        createRunContext() {
          return Object.freeze({ runId: RUN_ID, startedAt: STARTED_AT });
        },
        lifecycleClock: Object.freeze({ now() { return STARTED_AT; } }),
        sourceIdentityAllocator: Object.freeze({
          async allocate() { throw new Error(`CONTROLLED_STOP_${sequence}`); },
        }),
        transactionIdentityAllocator: Object.freeze({
          async allocate() { throw new Error('UNEXPECTED_TRANSACTION_ALLOCATION'); },
        }),
      });
    },
    async readReferenceResolver() {
      calls.refs += 1;
      return resolver();
    },
  };

  await assert.rejects(() => runScheduledSyncApplication(dependencies), /CONTROLLED_STOP_1/);
  await assert.rejects(() => runScheduledSyncApplication(dependencies), /CONTROLLED_STOP_2/);

  assert.equal(calls.runtime, 2);
  assert.equal(calls.refs, 2);
});

test('source failure propagates before YDB admission or runtime creation', async () => {
  let runtimeCalls = 0;
  let ydbReads = 0;
  const adapter = new YdbAdapter({
    async executeRead() {
      ydbReads += 1;
      throw new Error('YDB_MUST_NOT_BE_READ');
    },
    async serializableReadWrite() {
      throw new Error('YDB_TRANSACTION_MUST_NOT_RUN');
    },
  });

  await assert.rejects(
    () => runScheduledSyncApplication({
      source: Object.freeze({
        async readFullSnapshotObservation() {
          throw new Error('SYNTHETIC_SOURCE_FAILURE');
        },
      }),
      adapter,
      rowDigest: Object.freeze({ digestCanonicalRow() { return 'unused'; } }),
      observationClock: Object.freeze({ now() { return OBSERVED_AT; } }),
      createRuntimePrimitives() {
        runtimeCalls += 1;
        throw new Error('RUNTIME_MUST_NOT_BE_CREATED');
      },
    }),
    /SYNTHETIC_SOURCE_FAILURE/,
  );

  assert.equal(ydbReads, 0);
  assert.equal(runtimeCalls, 0);
});
