import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SourceSnapshotSemanticProjectionStructuralError,
  projectSourceSnapshotSemantics,
} from '../../dist/migration/sourceSnapshotSemanticProjection.js';
import { projectInitialSnapshot } from '../../dist/migration/initialSnapshotProjection.js';

const S = (value) => ({ kind: 'STRING', value });
const N = (value) => ({ kind: 'NUMBER', value });
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const refs = {
  vikaMemberId: id(900),
  resolveAccountId(label) {
    return new Map([
      ['Карта Visa', id(901)],
      ['Приход', id(902)],
    ]).get(label) ?? null;
  },
  resolveCategoryId(kind, label) {
    return new Map([
      ['EXPENSE\u0000Synthetic Expense', id(903)],
      ['INCOME\u0000Synthetic Income', id(904)],
    ]).get(`${kind}\u0000${label}`) ?? null;
  },
};

const context = {
  refs,
  granularityEvidence: {
    coarseExpenseOrdinalRange: { startInclusive: 100, endExclusive: 110 },
  },
};

function expense(amount = '12.34', overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Карта Visa'),
    expense_category: S('Synthetic Expense'),
    description: S('Synthetic expense'),
    expense_amount: N(amount),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  };
}

function closeMarker(description) {
  return expense('0', { expense_category: null, description: S(description) });
}

test('shared core preserves exact full-snapshot semantics without SourceRecord identity', () => {
  const rows = [
    { sourceOrdinal: 10, rawPayload: closeMarker('Плюсовые позиции'), aggregatePeriodMonth: null },
    { sourceOrdinal: 11, rawPayload: closeMarker('Минусовые позиции'), aggregatePeriodMonth: null },
    { sourceOrdinal: 12, rawPayload: closeMarker('Вика Красное'), aggregatePeriodMonth: null },
    { sourceOrdinal: 13, rawPayload: closeMarker('Текущий баланс'), aggregatePeriodMonth: null },
    { sourceOrdinal: 20, rawPayload: expense(), aggregatePeriodMonth: null },
    { sourceOrdinal: 21, rawPayload: expense('12.34', { date: S('2024-01-01') }), aggregatePeriodMonth: null },
  ];

  const shared = projectSourceSnapshotSemantics(rows, context);
  assert.equal(shared.outcomes.length, rows.length);
  assert.deepEqual(shared.outcomes.map((outcome) => outcome.sourceOrdinal), rows.map((row) => row.sourceOrdinal));
  assert.deepEqual(shared.outcomes.slice(0, 4).map((outcome) => outcome.classification), [
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
    'LEGACY_PERIOD_CLOSE',
  ]);
  assert.equal(shared.outcomes[4].transaction.type, 'EXPENSE');
  assert.deepEqual(shared.outcomes[5].projectionError, {
    stage: 'DECODE',
    errorCode: 'INVALID_DATE_CELL',
  });
  assert.equal(Object.isFrozen(shared), true);
  assert.equal(Object.isFrozen(shared.outcomes), true);
  assert.equal(Object.isFrozen(shared.counters), true);
});

test('initial adapter is semantically identical to shared core after attaching exact SourceRecord IDs', () => {
  const semanticRows = [
    { sourceOrdinal: 20, rawPayload: expense(), aggregatePeriodMonth: null },
    { sourceOrdinal: 21, rawPayload: expense('0', { description: S('Synthetic ordinary zero') }), aggregatePeriodMonth: null },
  ];
  const shared = projectSourceSnapshotSemantics(semanticRows, context);
  const initial = projectInitialSnapshot(
    semanticRows.map((row, index) => ({ sourceRecordId: id(index + 1), ...row })),
    context,
  );

  assert.deepEqual(initial.counters, shared.counters);
  assert.deepEqual(
    initial.outcomes.map(({ sourceRecordId: _sourceRecordId, ...rest }) => rest),
    shared.outcomes,
  );
});

for (const [name, rows, code] of [
  ['duplicate ordinal', [
    { sourceOrdinal: 1, rawPayload: expense(), aggregatePeriodMonth: null },
    { sourceOrdinal: 1, rawPayload: expense(), aggregatePeriodMonth: null },
  ], 'DUPLICATE_SOURCE_ORDINAL'],
  ['invalid ordinal', [
    { sourceOrdinal: -1, rawPayload: expense(), aggregatePeriodMonth: null },
  ], 'INVALID_SOURCE_ORDINAL'],
]) {
  test(`shared semantic projection fails closed for ${name}`, () => {
    assert.throws(
      () => projectSourceSnapshotSemantics(rows, context),
      (error) => error instanceof SourceSnapshotSemanticProjectionStructuralError && error.code === code,
    );
  });
}
