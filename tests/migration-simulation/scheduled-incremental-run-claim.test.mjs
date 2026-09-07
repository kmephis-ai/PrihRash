import assert from 'node:assert/strict';
import test from 'node:test';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import {
  ScheduledIncrementalRunClaimError,
  claimScheduledIncrementalRun,
} from '../../dist/migration/scheduledIncrementalRunClaim.js';

function run(overrides = {}) {
  return Object.freeze({
    id: '00000000-0000-0000-0000-000000000101',
    startedAt: '2026-09-07T10:00:00.000Z',
    finishedAt: '2026-09-07T10:00:05.000Z',
    sourceSnapshotDigest: 'digest-a',
    state: 'COMMITTED',
    rowsSeen: 10,
    rowsNew: 0,
    rowsChanged: 0,
    rowsMissing: 0,
    rowsAmbiguous: 0,
    errorCode: null,
    ...overrides,
  });
}

function evidenceRow(value) {
  return Object.freeze({
    id: value.id,
    started_at: value.startedAt,
    finished_at: value.finishedAt,
    source_snapshot_digest: value.sourceSnapshotDigest,
    state: value.state,
    rows_seen: BigInt(value.rowsSeen),
    rows_new: BigInt(value.rowsNew),
    rows_changed: BigInt(value.rowsChanged),
    rows_missing: BigInt(value.rowsMissing),
    rows_ambiguous: BigInt(value.rowsAmbiguous),
    error_code: value.errorCode,
  });
}

const baseline = run();
const candidate = run({
  id: '00000000-0000-0000-0000-000000000102',
  startedAt: '2026-09-07T11:00:00.000Z',
  finishedAt: null,
  sourceSnapshotDigest: 'digest-b',
  state: 'STAGING',
  rowsSeen: 11,
  rowsNew: 1,
  rowsChanged: 0,
});

function claimAdapter({ evidence = [evidenceRow(baseline)], readback = [evidenceRow(candidate)], onExecute } = {}) {
  const observed = { serializableCalls: 0, statements: [] };
  const adapter = new YdbAdapter({
    async executeRead() {
      throw new Error('OUTSIDE_TRANSACTION_READ_FORBIDDEN');
    },
    async serializableReadWrite(work) {
      observed.serializableCalls += 1;
      let call = 0;
      return work({
        async execute(statement) {
          observed.statements.push(statement);
          onExecute?.(statement, call);
          call += 1;
          if (call === 1) return { rows: evidence };
          if (call === 2) return { rows: [] };
          if (call === 3) return { rows: readback };
          throw new Error('UNEXPECTED_STATEMENT');
        },
      });
    },
  });
  return { adapter, observed };
}

test('atomically rechecks exact baseline, INSERTs one STAGING run, and reads it back', async () => {
  const { adapter, observed } = claimAdapter();

  const claimed = await claimScheduledIncrementalRun(adapter, baseline, candidate);

  assert.deepEqual(claimed, candidate);
  assert.equal(observed.serializableCalls, 1);
  assert.equal(observed.statements.length, 3);
  assert.equal(observed.statements[0].kind, 'READ');
  assert.match(observed.statements[0].text, /FROM migration_runs WHERE state IN/);
  assert.equal(observed.statements[1].kind, 'WRITE');
  assert.match(observed.statements[1].text, /^INSERT INTO migration_runs /);
  assert.doesNotMatch(observed.statements[1].text, /UPSERT/i);
  assert.equal(observed.statements[2].kind, 'READ');
  assert.match(observed.statements[2].text, /WHERE id = \$id/);
});

test('in-flight STAGING run blocks claim before INSERT', async () => {
  const competing = run({
    id: '00000000-0000-0000-0000-000000000103',
    startedAt: '2026-09-07T10:59:00.000Z',
    finishedAt: null,
    sourceSnapshotDigest: 'digest-other',
    state: 'STAGING',
  });
  const { adapter, observed } = claimAdapter({ evidence: [evidenceRow(baseline), evidenceRow(competing)] });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'IN_FLIGHT_RUN_EXISTS',
  );
  assert.equal(observed.statements.length, 1);
});

test('in-flight VALIDATED run also blocks claim before INSERT', async () => {
  const competing = run({
    id: '00000000-0000-0000-0000-000000000104',
    startedAt: '2026-09-07T10:58:00.000Z',
    finishedAt: null,
    sourceSnapshotDigest: 'digest-other',
    state: 'VALIDATED',
  });
  const { adapter, observed } = claimAdapter({ evidence: [evidenceRow(baseline), evidenceRow(competing)] });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'IN_FLIGHT_RUN_EXISTS',
  );
  assert.equal(observed.statements.length, 1);
});

test('newer committed baseline makes the preflight baseline stale and blocks claim', async () => {
  const newer = run({
    id: '00000000-0000-0000-0000-000000000105',
    startedAt: '2026-09-07T10:30:00.000Z',
    finishedAt: '2026-09-07T10:30:05.000Z',
    sourceSnapshotDigest: 'digest-newer',
  });
  const { adapter, observed } = claimAdapter({ evidence: [evidenceRow(baseline), evidenceRow(newer)] });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'BASELINE_CHANGED',
  );
  assert.equal(observed.statements.length, 1);
});

test('same id with changed immutable baseline evidence blocks claim', async () => {
  const changed = run({ rowsSeen: 11 });
  const { adapter, observed } = claimAdapter({ evidence: [evidenceRow(changed)] });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'BASELINE_CHANGED',
  );
  assert.equal(observed.statements.length, 1);
});

test('missing baseline blocks claim before INSERT', async () => {
  const { adapter, observed } = claimAdapter({ evidence: [] });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'BASELINE_CHANGED',
  );
  assert.equal(observed.statements.length, 1);
});

test('malformed transactional evidence fails closed before INSERT', async () => {
  const malformed = { ...evidenceRow(baseline), state: 'BROKEN' };
  const { adapter, observed } = claimAdapter({ evidence: [malformed] });

  await assert.rejects(() => claimScheduledIncrementalRun(adapter, baseline, candidate));
  assert.equal(observed.statements.length, 1);
});

test('claim read-back mismatch fails the transaction', async () => {
  const mismatched = run({
    ...candidate,
    rowsChanged: candidate.rowsChanged + 1,
  });
  const { adapter, observed } = claimAdapter({ readback: [evidenceRow(mismatched)] });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'CLAIM_READBACK_MISMATCH',
  );
  assert.equal(observed.statements.length, 3);
});

test('candidate must be a changed-snapshot STAGING run before transaction starts', async () => {
  for (const invalid of [
    run({ ...candidate, state: 'VALIDATED' }),
    run({ ...candidate, finishedAt: '2026-09-07T11:00:01.000Z' }),
    run({ ...candidate, rowsSeen: -1 }),
  ]) {
    const { adapter, observed } = claimAdapter();
    await assert.rejects(
      () => claimScheduledIncrementalRun(adapter, baseline, invalid),
      (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'CANDIDATE_NOT_STAGING',
    );
    assert.equal(observed.serializableCalls, 0);
  }

  const sameDigest = run({ ...candidate, sourceSnapshotDigest: baseline.sourceSnapshotDigest });
  const { adapter, observed } = claimAdapter();
  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, sameDigest),
    (error) => error instanceof ScheduledIncrementalRunClaimError && error.code === 'CANDIDATE_NOT_INCREMENTAL',
  );
  assert.equal(observed.serializableCalls, 0);
});

test('transport serialization/commit errors propagate without being converted to success', async () => {
  const conflict = new Error('SERIALIZATION_CONFLICT');
  const adapter = new YdbAdapter({
    async executeRead() { throw new Error('must not run'); },
    async serializableReadWrite() { throw conflict; },
  });

  await assert.rejects(
    () => claimScheduledIncrementalRun(adapter, baseline, candidate),
    (error) => error === conflict,
  );
});
