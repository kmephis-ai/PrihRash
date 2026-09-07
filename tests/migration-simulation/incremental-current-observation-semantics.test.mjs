import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalCurrentObservationSemanticError,
  buildIncrementalCurrentObservationSemanticPlan,
} from '../../dist/migration/incrementalCurrentObservationSemantics.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });
const ID_TOUCH = '00000000-0000-0000-0000-000000002001';
const ID_CREATE = '00000000-0000-0000-0000-000000002002';
const ID_REVISE = '00000000-0000-0000-0000-000000002003';
const ID_MISSING = '00000000-0000-0000-0000-000000002004';

const refs = {
  vikaMemberId: '00000000-0000-0000-0000-000000002101',
  resolveAccountId(label) {
    return label === 'Карта Visa' ? '00000000-0000-0000-0000-000000002102' : null;
  },
  resolveCategoryId(kind, label) {
    return kind === 'EXPENSE' && label === 'Synthetic Expense'
      ? '00000000-0000-0000-0000-000000002103'
      : null;
  },
};

function expense(description = 'Synthetic expense', overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Expense'),
    description: S(description),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  };
}

function noteOnly() {
  return {
    adapter_schema_version: 2,
    date: null,
    operation_type: null,
    expense_account: null,
    expense_category: null,
    description: null,
    expense_amount: null,
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: S('Synthetic note'),
  };
}

function deltaPlan() {
  return Object.freeze({
    intents: Object.freeze([
      Object.freeze({
        kind: 'TOUCH', sourceRecordId: ID_TOUCH, expectedRevision: 1,
        expectedDigest: 'touch', previousRowHint: 2, currentRowHint: 2, observedAt: '2026-09-07T06:20:00Z',
      }),
      Object.freeze({
        kind: 'CREATE', sourceRecordId: ID_CREATE, currentRevision: 1,
        currentDigest: 'create', currentRowHint: 3, observedAt: '2026-09-07T06:20:00Z',
      }),
      Object.freeze({
        kind: 'REVISE', sourceRecordId: ID_REVISE, expectedPreviousRevision: 4,
        expectedPreviousDigest: 'old', previousRowHint: 4, currentRevision: 5,
        currentDigest: 'new', currentRowHint: 4, observedAt: '2026-09-07T06:20:00Z',
      }),
      Object.freeze({
        kind: 'MARK_MISSING', sourceRecordId: ID_MISSING, expectedRevision: 2,
        expectedDigest: 'missing', previousRowHint: 7,
      }),
    ]),
    unresolvedBlocks: Object.freeze([
      Object.freeze({
        previousSourceRecordIds: Object.freeze([]),
        previousRowHints: Object.freeze([]),
        currentRowHints: Object.freeze([5, 6]),
      }),
    ]),
  });
}

function rows() {
  return [
    { currentRowHint: 2, sourceOrdinal: 0, rawPayload: expense('Touch') },
    { currentRowHint: 3, sourceOrdinal: 1, rawPayload: expense('Create') },
    { currentRowHint: 4, sourceOrdinal: 2, rawPayload: expense('Revise') },
    { currentRowHint: 5, sourceOrdinal: 3, rawPayload: noteOnly() },
    { currentRowHint: 6, sourceOrdinal: 4, rawPayload: expense('Invalid', { date: S('2024-01-01') }) },
  ];
}

const reviseQuality = [{
  sourceRecordId: ID_REVISE,
  recordGranularity: 'TRANSACTION',
  datePrecision: 'DAY',
  aggregatePeriodMonth: null,
}];

test('attaches full-snapshot classification to deterministic lineage without guessing unresolved identity', () => {
  const plan = buildIncrementalCurrentObservationSemanticPlan(rows(), deltaPlan(), reviseQuality, refs);

  assert.equal(plan.outcomes.length, 5);
  const [touch, created, revised, unresolved, invalid] = plan.outcomes;

  assert.equal(touch.sourceRecordId, ID_TOUCH);
  assert.equal(touch.lineageKind, 'TOUCH');
  assert.deepEqual(touch.financialProjection, {
    status: 'NOT_EVALUATED',
    reason: 'TOUCH_NO_REVISION',
  });

  assert.equal(created.sourceRecordId, ID_CREATE);
  assert.equal(created.classification, 'FINANCIAL_RECORD');
  assert.equal(created.financialProjection.status, 'CANDIDATE');
  assert.equal(created.financialProjection.transaction.recordGranularity, 'UNKNOWN');
  assert.equal(created.financialProjection.transaction.datePrecision, 'UNKNOWN');
  assert.equal(created.financialProjection.transaction.aggregatePeriodMonth, null);

  assert.equal(revised.sourceRecordId, ID_REVISE);
  assert.equal(revised.financialProjection.status, 'CANDIDATE');
  assert.equal(revised.financialProjection.transaction.recordGranularity, 'TRANSACTION');
  assert.equal(revised.financialProjection.transaction.datePrecision, 'DAY');

  assert.equal(unresolved.sourceRecordId, null);
  assert.equal(unresolved.lineageKind, 'UNRESOLVED');
  assert.equal(unresolved.classification, 'NON_FINANCIAL');
  assert.deepEqual(unresolved.financialProjection, {
    status: 'NOT_EVALUATED',
    reason: 'UNRESOLVED_LINEAGE',
  });

  assert.equal(invalid.sourceRecordId, null);
  assert.equal(invalid.classification, 'INVALID');
  assert.equal(invalid.decodeErrorCode, 'INVALID_DATE_CELL');
  assert.deepEqual(invalid.financialProjection, {
    status: 'NOT_EVALUATED',
    reason: 'UNRESOLVED_LINEAGE',
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.outcomes), true);
});

test('financial REVISE without previous verified quality is explicitly blocked, not position-derived', () => {
  const plan = buildIncrementalCurrentObservationSemanticPlan(rows(), deltaPlan(), [], refs);
  const revised = plan.outcomes.find((outcome) => outcome.lineageKind === 'REVISE');
  assert.deepEqual(revised.financialProjection, {
    status: 'BLOCKED',
    reason: 'PREVIOUS_FINANCIAL_QUALITY_REQUIRED',
  });
});

test('non-financial REVISE may carry previous financial quality evidence without producing a new candidate', () => {
  const inputRows = rows();
  inputRows[2] = { currentRowHint: 4, sourceOrdinal: 2, rawPayload: noteOnly() };
  const plan = buildIncrementalCurrentObservationSemanticPlan(inputRows, deltaPlan(), reviseQuality, refs);
  const revised = plan.outcomes[2];
  assert.equal(revised.classification, 'NON_FINANCIAL');
  assert.deepEqual(revised.financialProjection, {
    status: 'NOT_EVALUATED',
    reason: 'NOT_FINANCIAL_RECORD',
  });
});

test('financial projection failure remains explicit candidate evidence', () => {
  const inputRows = rows();
  inputRows[1] = {
    currentRowHint: 3,
    sourceOrdinal: 1,
    rawPayload: expense('Create', { expense_account: S('Unknown synthetic account') }),
  };
  const plan = buildIncrementalCurrentObservationSemanticPlan(inputRows, deltaPlan(), reviseQuality, refs);
  assert.deepEqual(plan.outcomes[1].financialProjection, {
    status: 'FAILED',
    stage: 'NORMALIZATION',
    errorCode: 'UNKNOWN_ACCOUNT',
  });
});

for (const [name, mutateRows, mutateQuality, code] of [
  ['missing current row coverage', (items) => items.slice(0, -1), (items) => items, 'CURRENT_ROW_COVERAGE_MISMATCH'],
  ['duplicate current row hint', (items) => { items[1].currentRowHint = 2; return items; }, (items) => items, 'DUPLICATE_CURRENT_ROW_HINT'],
  ['invalid current row hint', (items) => { items[1].currentRowHint = 0; return items; }, (items) => items, 'INVALID_CURRENT_ROW_HINT'],
  ['duplicate quality source', (items) => items, (items) => [...items, { ...items[0] }], 'DUPLICATE_FINANCIAL_QUALITY_SOURCE_ID'],
  ['foreign quality source', (items) => items, (items) => [{ ...items[0], sourceRecordId: ID_TOUCH }], 'EXTRA_FINANCIAL_QUALITY_EVIDENCE'],
  ['invalid aggregate quality', (items) => items, (items) => [{
    sourceRecordId: ID_REVISE,
    recordGranularity: 'PERIOD_AGGREGATE',
    datePrecision: 'DAY',
    aggregatePeriodMonth: null,
  }], 'INVALID_FINANCIAL_QUALITY_EVIDENCE'],
]) {
  test(`observation plan fails closed for ${name}`, () => {
    const inputRows = mutateRows(rows());
    const quality = mutateQuality(reviseQuality.map((item) => ({ ...item })));
    assert.throws(
      () => buildIncrementalCurrentObservationSemanticPlan(inputRows, deltaPlan(), quality, refs),
      (error) => error instanceof IncrementalCurrentObservationSemanticError && error.code === code,
    );
  });
}
