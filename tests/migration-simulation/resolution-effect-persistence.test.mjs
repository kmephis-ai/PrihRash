import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { markReviewRequired } from '../../dist/migration/resolution.js';
import { planResolutionEffect } from '../../dist/migration/resolutionEffectPlan.js';
import {
  ResolutionEffectPersistenceError,
  executeResolutionEffectWrite,
  prepareResolutionEffectWrite,
} from '../../dist/migration/resolutionEffectPersistence.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000001601';
const TX_ID = '00000000-0000-0000-0000-000000001602';
const TARGET_TX_ID = '00000000-0000-0000-0000-000000001603';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000001604';
const CATEGORY_ID = '00000000-0000-0000-0000-000000001605';
const AUDIT = { resolvedAt: '2026-09-07T04:50:00.000Z', resolvedBy: 'OWNER' };

function pending(state = 'MISSING', transactionId = TX_ID) {
  return markReviewRequired(SOURCE_ID, state, transactionId);
}

function expectation(state = 'MISSING', transactionId = TX_ID) {
  return {
    sourceRecordId: SOURCE_ID,
    sourceState: state === 'MISSING' ? 'MISSING' : null,
    classification: state === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'FINANCIAL_RECORD',
    transactionId,
    currentRevision: 3,
  };
}

function expense(overrides = {}) {
  return {
    type: 'EXPENSE',
    occurredOn: '2026-09-07',
    recordGranularity: 'TRANSACTION',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
    financialPeriodId: null,
    periodAssignmentQuality: 'UNASSIGNED',
    amountMinor: 12345,
    currency: 'RUB',
    fromAccountId: ACCOUNT_ID,
    toAccountId: null,
    categoryId: CATEGORY_ID,
    paidByMemberId: null,
    description: 'Synthetic corrected transaction',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
    ...overrides,
  };
}

function sourceRow(prepared, overrides = {}) {
  return {
    state: prepared.expectation.sourceState,
    classification: prepared.expectation.classification,
    transaction_id: prepared.finalTransactionId,
    current_revision: BigInt(prepared.expectation.currentRevision),
    resolution_code: prepared.resolved.resolutionCode,
    resolved_at: prepared.resolved.resolvedAt,
    resolved_by: prepared.resolved.resolvedBy,
    ...overrides,
  };
}

function replacementRow(candidate, version, overrides = {}) {
  return {
    type: candidate.type,
    occurred_on: candidate.occurredOn,
    record_granularity: candidate.recordGranularity,
    date_precision: candidate.datePrecision,
    aggregate_period_month: candidate.aggregatePeriodMonth,
    financial_period_id: candidate.financialPeriodId,
    period_assignment_quality: candidate.periodAssignmentQuality,
    amount_minor: BigInt(candidate.amountMinor),
    currency: candidate.currency,
    from_account_id: candidate.fromAccountId,
    to_account_id: candidate.toAccountId,
    category_id: candidate.categoryId,
    paid_by_member_id: candidate.paidByMemberId,
    description: candidate.description,
    note: candidate.note,
    status: candidate.status,
    analytics_state: candidate.analyticsState,
    flow_kind: candidate.flowKind,
    updated_at: AUDIT.resolvedAt,
    version: BigInt(version),
    ...overrides,
  };
}

function fakeTransport({ prepared, prerequisiteRows, transactionRows, sourceRows } = {}) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead() { throw new Error('standalone read not expected'); },
      async serializableReadWrite(work) {
        events.push('begin');
        const transaction = {
          async execute(statement) {
            if (statement.kind === 'WRITE') {
              if (/SET transaction_id = \$target_transaction_id/.test(statement.text)) {
                events.push('effect:relink');
              } else if (/UPDATE transactions SET status = \$status/.test(statement.text)) {
                events.push('effect:void');
              } else if (/UPDATE transactions SET type = \$type/.test(statement.text)) {
                events.push('effect:replace');
              } else if (/SET resolution_code = \$resolution_code/.test(statement.text)) {
                events.push('metadata');
              } else {
                events.push('write:unknown');
              }
              return { rows: [] };
            }

            if (/SELECT id FROM transactions/.test(statement.text)) {
              events.push('prerequisite');
              return { rows: prerequisiteRows ?? [{ id: TARGET_TX_ID }] };
            }
            if (/SELECT status, updated_at, version FROM transactions/.test(statement.text)) {
              events.push('tx-readback:void');
              return { rows: transactionRows ?? [{ status: 'VOIDED', updated_at: AUDIT.resolvedAt, version: 8n }] };
            }
            if (/SELECT type, occurred_on, record_granularity/.test(statement.text)) {
              events.push('tx-readback:replace');
              return { rows: transactionRows ?? [] };
            }
            if (/FROM source_records WHERE id = \$id/.test(statement.text)) {
              events.push('source-readback');
              return { rows: sourceRows ?? [sourceRow(prepared)] };
            }
            throw new Error(`unexpected statement: ${statement.text}`);
          },
        };
        try {
          const result = await work(transaction);
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    },
  };
}

function prepare(item, request, expected = expectation(item.state, item.transactionId)) {
  const plan = planResolutionEffect(item, request);
  return prepareResolutionEffectWrite(item, plan, AUDIT, expected);
}

test('KEEP_CANONICAL proves linked Transaction exists and commits only metadata', async () => {
  const item = pending();
  const prepared = prepare(item, { resolutionCode: 'KEEP_CANONICAL' });
  const fake = fakeTransport({
    prepared,
    prerequisiteRows: [{ id: TX_ID }],
  });

  const result = await executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared);

  assert.equal(result.transactionId, TX_ID);
  assert.equal(result.resolutionCode, 'KEEP_CANONICAL');
  assert.deepEqual(fake.events, ['begin', 'prerequisite', 'metadata', 'source-readback', 'commit']);
});

test('VOID applies exact optimistic status transition before audit metadata', async () => {
  const item = pending();
  const prepared = prepare(item, {
    resolutionCode: 'VOID_CANONICAL_CONFIRMED',
    expectedTransactionVersion: 7,
  });
  const fake = fakeTransport({ prepared });

  await executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared);

  assert.deepEqual(fake.events, [
    'begin',
    'effect:void',
    'tx-readback:void',
    'metadata',
    'source-readback',
    'commit',
  ]);
  assert.match(prepared.effectStatement.text, /status = \$expected_status/);
  assert.equal(prepared.effectStatement.parameters.expected_status.value, 'POSTED');
  assert.equal(prepared.effectStatement.parameters.next_version.value, 8n);
});

test('RELINK proves explicit target, updates source link, and returns the final link', async () => {
  const item = pending('AMBIGUOUS', TX_ID);
  const expected = expectation('AMBIGUOUS', TX_ID);
  const prepared = prepare(item, {
    resolutionCode: 'RELINK_SOURCE',
    targetTransactionId: TARGET_TX_ID,
    expectedSourceRevision: 3,
  }, expected);
  const fake = fakeTransport({
    prepared,
    prerequisiteRows: [{ id: TARGET_TX_ID }],
  });

  const result = await executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared);

  assert.equal(result.transactionId, TARGET_TX_ID);
  assert.deepEqual(fake.events, [
    'begin',
    'prerequisite',
    'effect:relink',
    'metadata',
    'source-readback',
    'commit',
  ]);
  assert.match(prepared.effectStatement.text, /current_revision = \$current_revision/);
  assert.match(prepared.effectStatement.text, /transaction_id = \$expected_transaction_id/);
});

test('ACCEPT_SOURCE_CORRECTION replaces exact canonical fields and verifies them before metadata', async () => {
  const item = pending('AMBIGUOUS', TX_ID);
  const candidate = expense();
  const prepared = prepare(item, {
    resolutionCode: 'ACCEPT_SOURCE_CORRECTION',
    expectedTransactionVersion: 4,
    canonicalTransaction: candidate,
    categoryKind: 'EXPENSE',
  }, expectation('AMBIGUOUS', TX_ID));
  const fake = fakeTransport({
    prepared,
    transactionRows: [replacementRow(candidate, 5)],
  });

  await executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared);

  assert.deepEqual(fake.events, [
    'begin',
    'effect:replace',
    'tx-readback:replace',
    'metadata',
    'source-readback',
    'commit',
  ]);
  assert.doesNotMatch(prepared.effectStatement.text, /created_at/);
  assert.doesNotMatch(prepared.effectStatement.text, /captured_at/);
  assert.equal(prepared.effectStatement.parameters.next_version.value, 5n);
});

test('missing RELINK target rolls back before any source or metadata write', async () => {
  const item = pending('AMBIGUOUS', TX_ID);
  const prepared = prepare(item, {
    resolutionCode: 'RELINK_SOURCE',
    targetTransactionId: TARGET_TX_ID,
    expectedSourceRevision: 3,
  }, expectation('AMBIGUOUS', TX_ID));
  const fake = fakeTransport({ prepared, prerequisiteRows: [] });

  await assert.rejects(
    () => executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared),
    (error) => error instanceof ResolutionEffectPersistenceError
      && error.code === 'PREREQUISITE_TRANSACTION_NOT_FOUND',
  );
  assert.deepEqual(fake.events, ['begin', 'prerequisite', 'rollback']);
});

test('stale VOID evidence rolls back effect and never commits resolution metadata', async () => {
  const item = pending();
  const prepared = prepare(item, {
    resolutionCode: 'VOID_CANONICAL_CONFIRMED',
    expectedTransactionVersion: 7,
  });
  const fake = fakeTransport({
    prepared,
    transactionRows: [{ status: 'POSTED', updated_at: AUDIT.resolvedAt, version: 7n }],
  });

  await assert.rejects(
    () => executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared),
    (error) => error instanceof ResolutionEffectPersistenceError
      && error.code === 'TRANSACTION_EFFECT_EVIDENCE_MISMATCH',
  );
  assert.deepEqual(fake.events, ['begin', 'effect:void', 'tx-readback:void', 'rollback']);
});

test('source lineage drift after metadata write rolls back the whole resolution transaction', async () => {
  const item = pending();
  const prepared = prepare(item, { resolutionCode: 'KEEP_CANONICAL' });
  const fake = fakeTransport({
    prepared,
    prerequisiteRows: [{ id: TX_ID }],
    sourceRows: [sourceRow(prepared, { current_revision: 4n })],
  });

  await assert.rejects(
    () => executeResolutionEffectWrite(new YdbAdapter(fake.transport), prepared),
    (error) => error instanceof ResolutionEffectPersistenceError
      && error.code === 'SOURCE_EFFECT_EVIDENCE_MISMATCH',
  );
  assert.equal(fake.events.at(-1), 'rollback');
});

test('forged RELINK source revision precondition is rejected during prepare', () => {
  const item = pending('AMBIGUOUS', TX_ID);
  const plan = planResolutionEffect(item, {
    resolutionCode: 'RELINK_SOURCE',
    targetTransactionId: TARGET_TX_ID,
    expectedSourceRevision: 4,
  });

  assert.throws(
    () => prepareResolutionEffectWrite(item, plan, AUDIT, expectation('AMBIGUOUS', TX_ID)),
    (error) => error instanceof ResolutionEffectPersistenceError
      && error.code === 'SOURCE_REVISION_PRECONDITION_MISMATCH',
  );
});
