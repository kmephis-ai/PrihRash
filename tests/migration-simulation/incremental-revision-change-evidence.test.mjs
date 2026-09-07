import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IncrementalRevisionChangeEvidenceError,
  buildIncrementalRevisionChangeEvidence,
} from '../../dist/migration/incrementalRevisionChangeEvidence.js';

const SOURCE_ID = '00000000-0000-0000-0000-000000000201';

function payload(overrides = {}) {
  return {
    adapter_schema_version: 2,
    date: { kind: 'NUMBER', value: '45500' },
    operation_type: { kind: 'STRING', value: 'Расход' },
    expense_account: { kind: 'STRING', value: 'Synthetic Account' },
    expense_category: { kind: 'STRING', value: 'Synthetic Category' },
    description: { kind: 'STRING', value: 'before' },
    expense_amount: { kind: 'NUMBER', value: '100' },
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
    ...overrides,
  };
}

function reviseIntent(overrides = {}) {
  return {
    kind: 'REVISE',
    sourceRecordId: SOURCE_ID,
    expectedPreviousRevision: 2,
    expectedPreviousDigest: 'digest-before',
    previousRowHint: 5,
    currentRevision: 3,
    currentDigest: 'digest-after',
    currentRowHint: 5,
    observedAt: '2026-09-07T12:00:00.000Z',
    ...overrides,
  };
}

function delta(intent = reviseIntent()) {
  return { intents: [intent], unresolvedBlocks: [] };
}

function previous(rawPayload = payload(), overrides = {}) {
  return {
    sourceRecordId: SOURCE_ID,
    revision: 2,
    migrationRunId: '00000000-0000-0000-0000-000000000101',
    observedAt: '2026-09-06T12:00:00.000Z',
    rowHint: 5,
    rowDigest: 'digest-before',
    changeClass: 'OWNER_CORRECTION',
    rawPayload,
    ...overrides,
  };
}

function current(rawPayload, overrides = {}) {
  return {
    rowHint: 5,
    digest: 'digest-after',
    rawPayload,
    ...overrides,
  };
}

const FULL_CONTEXT = {
  preCloseObservationProven: true,
  inJustClosedWorkingSetProven: true,
  closeClusterDetected: true,
  observedAfterClose: true,
  batchCleanupPatternConfirmed: true,
};

const PARTIAL_CONTEXT = {
  preCloseObservationProven: true,
  inJustClosedWorkingSetProven: false,
  closeClusterDetected: false,
  observedAfterClose: false,
  batchCleanupPatternConfirmed: false,
};

test('ordinary owner correction is context-independent and classifies without close evidence', () => {
  const plan = buildIncrementalRevisionChangeEvidence(
    delta(),
    [previous()],
    [current(payload({ description: { kind: 'STRING', value: 'after' } }))],
  );

  assert.deepEqual(plan.changeEvidence, [{ sourceRecordId: SOURCE_ID, changeClass: 'OWNER_CORRECTION' }]);
  assert.deepEqual(plan.contextDependentSourceRecordIds, []);
  assert.equal(Object.isFrozen(plan), true);
});

test('structural danger remains AMBIGUOUS_CHANGE without close context', () => {
  const plan = buildIncrementalRevisionChangeEvidence(
    delta(),
    [previous()],
    [current(payload({ expense_amount: null }))],
  );
  assert.deepEqual(plan.changeEvidence, [{ sourceRecordId: SOURCE_ID, changeClass: 'AMBIGUOUS_CHANGE' }]);
  assert.deepEqual(plan.contextDependentSourceRecordIds, []);
});

test('known cleanup transition is blocked when close context is not proven', () => {
  const before = payload({ expense_account: { kind: 'STRING', value: 'Карта Credit' } });
  const after = payload({ expense_account: { kind: 'STRING', value: 'Карта Visa' } });

  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(delta(), [previous(before)], [current(after)]),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'MISSING_CONTEXTUAL_CHANGE_EVIDENCE',
  );
});

test('known cleanup uses explicit full or partial proven context through the existing classifier', () => {
  const before = payload({ expense_account: { kind: 'STRING', value: 'Карта Credit' } });
  const after = payload({ expense_account: { kind: 'STRING', value: 'Карта Visa' } });

  const workflow = buildIncrementalRevisionChangeEvidence(
    delta(), [previous(before)], [current(after)], [{ sourceRecordId: SOURCE_ID, context: FULL_CONTEXT }],
  );
  assert.deepEqual(workflow.changeEvidence, [{ sourceRecordId: SOURCE_ID, changeClass: 'WORKFLOW_TRANSFORM' }]);
  assert.deepEqual(workflow.contextDependentSourceRecordIds, [SOURCE_ID]);

  const ambiguous = buildIncrementalRevisionChangeEvidence(
    delta(), [previous(before)], [current(after)], [{ sourceRecordId: SOURCE_ID, context: PARTIAL_CONTEXT }],
  );
  assert.deepEqual(ambiguous.changeEvidence, [{ sourceRecordId: SOURCE_ID, changeClass: 'AMBIGUOUS_CHANGE' }]);
});

test('stale previous revision or current row evidence is rejected', () => {
  for (const previousOverrides of [
    { revision: 1 },
    { rowHint: 6 },
    { rowDigest: 'other-before' },
  ]) {
    assert.throws(
      () => buildIncrementalRevisionChangeEvidence(
        delta(), [previous(payload(), previousOverrides)], [current(payload({ description: { kind: 'STRING', value: 'after' } }))],
      ),
      (error) => error instanceof IncrementalRevisionChangeEvidenceError
        && error.code === 'PREVIOUS_REVISION_INTENT_MISMATCH',
    );
  }

  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(
      delta(), [previous()], [current(payload({ description: { kind: 'STRING', value: 'after' } }), { digest: 'other-after' })],
    ),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'CURRENT_ROW_INTENT_MISMATCH',
  );
});

test('missing, extra and duplicate previous/current evidence fails closed', () => {
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(delta(), [], [current(payload())]),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'MISSING_PREVIOUS_REVISION_EVIDENCE',
  );
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(delta(), [previous()], []),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'MISSING_CURRENT_ROW_EVIDENCE',
  );
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(delta(), [previous(), previous()], [current(payload())]),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'DUPLICATE_PREVIOUS_REVISION_SOURCE_ID',
  );
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(delta(), [previous()], [current(payload()), current(payload())]),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'DUPLICATE_CURRENT_ROW_HINT',
  );
});

test('extra or duplicate contextual evidence is rejected', () => {
  const changed = current(payload({ description: { kind: 'STRING', value: 'after' } }));
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(
      delta(), [previous()], [changed], [{ sourceRecordId: SOURCE_ID, context: FULL_CONTEXT }],
    ),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'EXTRA_CONTEXTUAL_CHANGE_EVIDENCE',
  );

  const before = payload({ expense_account: { kind: 'STRING', value: 'Карта Credit' } });
  const after = payload({ expense_account: { kind: 'STRING', value: 'Карта Visa' } });
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(
      delta(), [previous(before)], [current(after)], [
        { sourceRecordId: SOURCE_ID, context: FULL_CONTEXT },
        { sourceRecordId: SOURCE_ID.toUpperCase(), context: FULL_CONTEXT },
      ],
    ),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'DUPLICATE_CONTEXT_SOURCE_ID',
  );
});

test('REVISE whose financial projection is unchanged is rejected rather than labeled NO_CHANGE', () => {
  assert.throws(
    () => buildIncrementalRevisionChangeEvidence(delta(), [previous()], [current(payload())]),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'REVISED_FINANCIAL_FIELDS_NO_CHANGE',
  );
});

test('no REVISE intents require no previous/current/context evidence', () => {
  const plan = buildIncrementalRevisionChangeEvidence({ intents: [], unresolvedBlocks: [] }, [], []);
  assert.deepEqual(plan, { changeEvidence: [], contextDependentSourceRecordIds: [] });
});
