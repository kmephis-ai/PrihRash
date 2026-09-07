import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncrementalCurrentObservationHandoffError,
  buildIncrementalCurrentObservationInputs,
} from '../../dist/migration/incrementalCurrentObservationHandoff.js';
import { buildIncrementalCurrentObservationSemanticPlan } from '../../dist/migration/incrementalCurrentObservationSemantics.js';

const ID_TOUCH = '00000000-0000-0000-0000-000000004001';
const ID_CREATE = '00000000-0000-0000-0000-000000004002';
const MEMBER = '00000000-0000-0000-0000-000000004101';
const OBSERVED_AT = '2026-09-07T14:25:00.000Z';

function noteOnly(note) {
  return Object.freeze({
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
    note: Object.freeze({ kind: 'STRING', value: note }),
  });
}

function row(rowHint, digest, rawPayload) {
  return Object.freeze({ rowHint, digest, rawPayload });
}

function projection(rows) {
  return Object.freeze({ rows: Object.freeze(rows) });
}

const refs = Object.freeze({
  resolveAccountId() { return null; },
  resolveCategoryId() { return null; },
  vikaMemberId: MEMBER,
});

test('derives zero-based source ordinals only from leased projection order', () => {
  const firstPayload = noteOnly('first synthetic note');
  const secondPayload = noteOnly('second synthetic note');
  const input = projection([
    row(2, 'digest-a', firstPayload),
    row(9, 'digest-b', secondPayload),
  ]);

  const result = buildIncrementalCurrentObservationInputs(input);

  assert.deepEqual(result.map((item) => [item.currentRowHint, item.sourceOrdinal]), [[2, 0], [9, 1]]);
  assert.equal(result[0].rawPayload, firstPayload);
  assert.equal(result[1].rawPayload, secondPayload);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.every((item) => Object.isFrozen(item)), true);
  assert.equal(result[1].sourceOrdinal === result[1].currentRowHint, false);
});

test('handoff satisfies semantic coverage without a second source read or row-hint ordinal inference', () => {
  const current = buildIncrementalCurrentObservationInputs(projection([
    row(2, 'touch', noteOnly('touch synthetic note')),
    row(9, 'create', noteOnly('create synthetic note')),
  ]));
  const delta = Object.freeze({
    intents: Object.freeze([
      Object.freeze({
        kind: 'TOUCH',
        sourceRecordId: ID_TOUCH,
        expectedRevision: 1,
        expectedDigest: 'touch',
        previousRowHint: 2,
        currentRowHint: 2,
        observedAt: OBSERVED_AT,
      }),
      Object.freeze({
        kind: 'CREATE',
        sourceRecordId: ID_CREATE,
        currentRevision: 1,
        currentDigest: 'create',
        currentRowHint: 9,
        observedAt: OBSERVED_AT,
      }),
    ]),
    unresolvedBlocks: Object.freeze([]),
  });

  const semantic = buildIncrementalCurrentObservationSemanticPlan(current, delta, [], refs);
  assert.deepEqual(semantic.outcomes.map((item) => [
    item.currentRowHint,
    item.sourceOrdinal,
    item.lineageKind,
    item.classification,
  ]), [
    [2, 0, 'TOUCH', 'NON_FINANCIAL'],
    [9, 1, 'CREATE', 'NON_FINANCIAL'],
  ]);
});

test('handoff fails closed for duplicate current row hints', () => {
  assert.throws(
    () => buildIncrementalCurrentObservationInputs(projection([
      row(2, 'a', noteOnly('a')),
      row(2, 'b', noteOnly('b')),
    ])),
    (error) => error instanceof IncrementalCurrentObservationHandoffError
      && error.code === 'DUPLICATE_CURRENT_ROW_HINT',
  );
});

for (const invalid of [1, 0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`handoff fails closed for invalid row hint ${String(invalid)}`, () => {
    assert.throws(
      () => buildIncrementalCurrentObservationInputs(projection([
        row(invalid, 'invalid', noteOnly('invalid')),
      ])),
      (error) => error instanceof IncrementalCurrentObservationHandoffError
        && error.code === 'INVALID_CURRENT_ROW_HINT',
    );
  });
}
