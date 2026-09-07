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

function lineage(outcome = {}) {
  return {
    outcomes: [{
      kind: 'REVISED', sourceRecordId: SOURCE_ID,
      previousRowHint: 5, currentRowHint: 5,
      previousDigest: 'digest-before', currentDigest: 'digest-after',
      ...outcome,
    }],
    counters: { rowsSeen: 1, rowsNew: 0, rowsChanged: 1, rowsMissing: 0, rowsAmbiguous: 0 },
  };
}

function previous(rawPayload = payload(), overrides = {}) {
  return {
    sourceRecordId: SOURCE_ID, revision: 2,
    migrationRunId: '00000000-0000-0000-0000-000000000101',
    observedAt: '2026-09-06T12:00:00.000Z', rowHint: 5, rowDigest: 'digest-before',
    changeClass: 'OWNER_CORRECTION', rawPayload, ...overrides,
  };
}
function current(rawPayload, overrides = {}) {
  return { rowHint: 5, digest: 'digest-after', rawPayload, ...overrides };
}
const FULL_CONTEXT = { preCloseObservationProven: true, inJustClosedWorkingSetProven: true, closeClusterDetected: true, observedAfterClose: true, batchCleanupPatternConfirmed: true };
const PARTIAL_CONTEXT = { ...FULL_CONTEXT, inJustClosedWorkingSetProven: false, closeClusterDetected: false, observedAfterClose: false, batchCleanupPatternConfirmed: false };

test('ordinary owner correction is lineage-first and context-independent', () => {
  const plan = buildIncrementalRevisionChangeEvidence(lineage(), [previous()], [current(payload({ description: { kind: 'STRING', value: 'after' } }))]);
  assert.deepEqual(plan.changeEvidence, [{ sourceRecordId: SOURCE_ID, changeClass: 'OWNER_CORRECTION' }]);
  assert.deepEqual(plan.contextDependentSourceRecordIds, []);
});

test('structural danger remains ambiguous without close context', () => {
  const plan = buildIncrementalRevisionChangeEvidence(lineage(), [previous()], [current(payload({ expense_amount: null }))]);
  assert.deepEqual(plan.changeEvidence, [{ sourceRecordId: SOURCE_ID, changeClass: 'AMBIGUOUS_CHANGE' }]);
});

test('known cleanup blocks without context and follows proven full/partial context', () => {
  const before = payload({ expense_account: { kind: 'STRING', value: 'Карта Credit' } });
  const after = payload({ expense_account: { kind: 'STRING', value: 'Карта Visa' } });
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous(before)], [current(after)]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'MISSING_CONTEXTUAL_CHANGE_EVIDENCE');
  assert.deepEqual(buildIncrementalRevisionChangeEvidence(lineage(), [previous(before)], [current(after)], [{ sourceRecordId: SOURCE_ID, context: FULL_CONTEXT }]).changeEvidence,
    [{ sourceRecordId: SOURCE_ID, changeClass: 'WORKFLOW_TRANSFORM' }]);
  assert.deepEqual(buildIncrementalRevisionChangeEvidence(lineage(), [previous(before)], [current(after)], [{ sourceRecordId: SOURCE_ID, context: PARTIAL_CONTEXT }]).changeEvidence,
    [{ sourceRecordId: SOURCE_ID, changeClass: 'AMBIGUOUS_CHANGE' }]);
});

test('stale previous/current evidence is rejected against lineage', () => {
  for (const overrides of [{ rowHint: 6 }, { rowDigest: 'other-before' }]) {
    assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous(payload(), overrides)], [current(payload({ description: { kind: 'STRING', value: 'after' } }))]),
      (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'PREVIOUS_REVISION_LINEAGE_MISMATCH');
  }
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous()], [current(payload({ description: { kind: 'STRING', value: 'after' } }), { digest: 'other-after' })]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'CURRENT_ROW_LINEAGE_MISMATCH');
});

test('missing/duplicate and extra evidence remains fail-closed', () => {
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [], [current(payload())]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'MISSING_PREVIOUS_REVISION_EVIDENCE');
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous()], []),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'MISSING_CURRENT_ROW_EVIDENCE');
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous(), previous()], [current(payload())]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'DUPLICATE_PREVIOUS_REVISION_SOURCE_ID');
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous()], [current(payload()), current(payload())]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'DUPLICATE_CURRENT_ROW_HINT');
});

test('extra context is forbidden and unchanged financial projection cannot satisfy REVISED lineage', () => {
  const changed = current(payload({ description: { kind: 'STRING', value: 'after' } }));
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous()], [changed], [{ sourceRecordId: SOURCE_ID, context: FULL_CONTEXT }]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'EXTRA_CONTEXTUAL_CHANGE_EVIDENCE');
  assert.throws(() => buildIncrementalRevisionChangeEvidence(lineage(), [previous()], [current(payload())]),
    (e) => e instanceof IncrementalRevisionChangeEvidenceError && e.code === 'REVISED_FINANCIAL_FIELDS_NO_CHANGE');
});

test('lineage without REVISED outcomes needs no revision payload evidence', () => {
  const plan = buildIncrementalRevisionChangeEvidence({ outcomes: [], counters: { rowsSeen: 0, rowsNew: 0, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 0 } }, [], []);
  assert.deepEqual(plan, { changeEvidence: [], contextDependentSourceRecordIds: [] });
});
