import test from 'node:test';
import assert from 'node:assert/strict';
import { YdbAdapter } from '../../dist/integration/ydb/adapter.js';
import { markReviewRequired } from '../../dist/migration/resolution.js';
import { planResolutionEffect } from '../../dist/migration/resolutionEffectPlan.js';
import { prepareResolutionEffectWrite } from '../../dist/migration/resolutionEffectPersistence.js';
import { recoverResolutionEffectCommit } from '../../dist/migration/resolutionEffectRecovery.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000001701';
const TX_ID = '00000000-0000-0000-0000-000000001702';
const TARGET_TX_ID = '00000000-0000-0000-0000-000000001703';
const ACCOUNT_ID = '00000000-0000-0000-0000-000000001704';
const CATEGORY_ID = '00000000-0000-0000-0000-000000001705';
const AUDIT = { resolvedAt: '2026-09-07T05:00:00.000Z', resolvedBy: 'OWNER' };

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
    amountMinor: 23456,
    currency: 'RUB',
    fromAccountId: ACCOUNT_ID,
    toAccountId: null,
    categoryId: CATEGORY_ID,
    paidByMemberId: null,
    description: 'Synthetic recovery candidate',
    note: null,
    status: 'POSTED',
    analyticsState: 'INCLUDED',
    flowKind: null,
    ...overrides,
  };
}

function prepare(item, request, expected = expectation(item.state, item.transactionId)) {
  return prepareResolutionEffectWrite(
    item,
    planResolutionEffect(item, request),
    AUDIT,
    expected,
  );
}

function sourcePre(prepared, overrides = {}) {
  return {
    state: prepared.expectation.sourceState,
    classification: prepared.expectation.classification,
    transaction_id: prepared.expectation.transactionId,
    current_revision: BigInt(prepared.expectation.currentRevision),
    resolution_code: null,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function sourceFinal(prepared, overrides = {}) {
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

function fakeReadTransport({ sourceRows, identityRows = [], transactionRows = [] }) {
  const events = [];
  return {
    events,
    transport: {
      async executeRead(statement) {
        if (/FROM source_records WHERE id/.test(statement.text)) {
          events.push('source');
          return { rows: sourceRows };
        }
        if (/SELECT id FROM transactions/.test(statement.text)) {
          events.push('identity');
          return { rows: identityRows };
        }
        if (/SELECT status, updated_at, version FROM transactions/.test(statement.text)) {
          events.push('void');
          return { rows: transactionRows };
        }
        if (/SELECT type, occurred_on, record_granularity/.test(statement.text)) {
          events.push('replace');
          return { rows: transactionRows };
        }
        throw new Error(`unexpected read: ${statement.text}`);
      },
      async serializableReadWrite() {
        throw new Error('recovery must never write');
      },
    },
  };
}

test('exact unresolved source pre-state classifies NOT_APPLIED without any additional read', async () => {
  const prepared = prepare(pending(), {
    resolutionCode: 'VOID_CANONICAL_CONFIRMED',
    expectedTransactionVersion: 7,
  });
  const fake = fakeReadTransport({ sourceRows: [sourcePre(prepared)] });

  const result = await recoverResolutionEffectCommit(new YdbAdapter(fake.transport), prepared);

  assert.deepEqual(result, { status: 'NOT_APPLIED' });
  assert.deepEqual(fake.events, ['source']);
  assert.equal(Object.isFrozen(result), true);
});

test('RESOLVED_NO_CHANGE exact final audit classifies APPLIED with source read only', async () => {
  const item = pending('AMBIGUOUS', null);
  const prepared = prepare(
    item,
    { resolutionCode: 'RESOLVED_NO_CHANGE' },
    expectation('AMBIGUOUS', null),
  );
  const fake = fakeReadTransport({ sourceRows: [sourceFinal(prepared)] });

  const result = await recoverResolutionEffectCommit(new YdbAdapter(fake.transport), prepared);

  assert.deepEqual(result, { status: 'APPLIED' });
  assert.deepEqual(fake.events, ['source']);
});

test('KEEP_CANONICAL final audit also requires linked Transaction existence', async () => {
  const prepared = prepare(pending(), { resolutionCode: 'KEEP_CANONICAL' });
  const good = fakeReadTransport({
    sourceRows: [sourceFinal(prepared)],
    identityRows: [{ id: TX_ID }],
  });
  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(good.transport), prepared),
    { status: 'APPLIED' },
  );
  assert.deepEqual(good.events, ['source', 'identity']);

  const missing = fakeReadTransport({ sourceRows: [sourceFinal(prepared)], identityRows: [] });
  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(missing.transport), prepared),
    { status: 'RECOVERY_REQUIRED' },
  );
});

test('RELINK final audit requires exact target link and target Transaction existence', async () => {
  const item = pending('AMBIGUOUS', TX_ID);
  const prepared = prepare(item, {
    resolutionCode: 'RELINK_SOURCE',
    targetTransactionId: TARGET_TX_ID,
    expectedSourceRevision: 3,
  }, expectation('AMBIGUOUS', TX_ID));
  const fake = fakeReadTransport({
    sourceRows: [sourceFinal(prepared)],
    identityRows: [{ id: TARGET_TX_ID }],
  });

  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(fake.transport), prepared),
    { status: 'APPLIED' },
  );
  assert.deepEqual(fake.events, ['source', 'identity']);

  const mixed = fakeReadTransport({
    sourceRows: [sourceFinal(prepared, { transaction_id: TX_ID })],
    identityRows: [{ id: TARGET_TX_ID }],
  });
  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(mixed.transport), prepared),
    { status: 'RECOVERY_REQUIRED' },
  );
  assert.deepEqual(mixed.events, ['source']);
});

test('VOID exact final audit and exact versioned effect classify APPLIED', async () => {
  const prepared = prepare(pending(), {
    resolutionCode: 'VOID_CANONICAL_CONFIRMED',
    expectedTransactionVersion: 7,
  });
  const fake = fakeReadTransport({
    sourceRows: [sourceFinal(prepared)],
    transactionRows: [{ status: 'VOIDED', updated_at: AUDIT.resolvedAt, version: 8n }],
  });

  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(fake.transport), prepared),
    { status: 'APPLIED' },
  );
  assert.deepEqual(fake.events, ['source', 'void']);

  const stale = fakeReadTransport({
    sourceRows: [sourceFinal(prepared)],
    transactionRows: [{ status: 'POSTED', updated_at: AUDIT.resolvedAt, version: 7n }],
  });
  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(stale.transport), prepared),
    { status: 'RECOVERY_REQUIRED' },
  );
});

test('correction exact final audit and complete canonical replacement classify APPLIED', async () => {
  const item = pending('AMBIGUOUS', TX_ID);
  const candidate = expense();
  const prepared = prepare(item, {
    resolutionCode: 'ACCEPT_SOURCE_CORRECTION',
    expectedTransactionVersion: 4,
    canonicalTransaction: candidate,
    categoryKind: 'EXPENSE',
  }, expectation('AMBIGUOUS', TX_ID));
  const fake = fakeReadTransport({
    sourceRows: [sourceFinal(prepared)],
    transactionRows: [replacementRow(candidate, 5)],
  });

  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(fake.transport), prepared),
    { status: 'APPLIED' },
  );
  assert.deepEqual(fake.events, ['source', 'replace']);

  const mismatch = fakeReadTransport({
    sourceRows: [sourceFinal(prepared)],
    transactionRows: [replacementRow(candidate, 5, { amount_minor: 999n })],
  });
  assert.deepEqual(
    await recoverResolutionEffectCommit(new YdbAdapter(mismatch.transport), prepared),
    { status: 'RECOVERY_REQUIRED' },
  );
});

test('missing, duplicate, or mixed source evidence always requires recovery', async () => {
  const prepared = prepare(pending(), { resolutionCode: 'KEEP_CANONICAL' });

  for (const sourceRows of [
    [],
    [sourceFinal(prepared), sourceFinal(prepared)],
    [sourceFinal(prepared, { resolved_by: 'OTHER' })],
    [sourcePre(prepared, { current_revision: 4n })],
  ]) {
    const fake = fakeReadTransport({ sourceRows, identityRows: [{ id: TX_ID }] });
    assert.deepEqual(
      await recoverResolutionEffectCommit(new YdbAdapter(fake.transport), prepared),
      { status: 'RECOVERY_REQUIRED' },
    );
    assert.deepEqual(fake.events, ['source']);
  }
});
