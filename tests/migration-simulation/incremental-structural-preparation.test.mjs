import test from 'node:test';
import assert from 'node:assert/strict';
import { createMigrationRun } from '../../dist/migration/migrationRunState.js';
import { buildIncrementalStructuralPreparation } from '../../dist/migration/incrementalStructuralPreparation.js';
import { IncrementalRevisionChangeEvidenceError } from '../../dist/migration/incrementalRevisionChangeEvidence.js';

const A = '00000000-0000-0000-0000-000000002001';
const B = '00000000-0000-0000-0000-000000002002';
const C = '00000000-0000-0000-0000-000000002003';
const D = '00000000-0000-0000-0000-000000002004';
const NEW = '00000000-0000-0000-0000-000000002005';
const RUN_ID = '00000000-0000-0000-0000-000000002100';
const OBSERVED_AT = '2026-09-07T13:00:00.000Z';

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

function source(id, rowHint, digest, currentRevision = 1) {
  return Object.freeze({
    id,
    sourceType: 'GOOGLE_SHEETS',
    sourceSheet: 'Ответы на форму (11)',
    firstSeenAt: '2026-09-01T10:00:00.000Z',
    lastSeenAt: '2026-09-06T10:00:00.000Z',
    lastRowHint: rowHint,
    currentDigest: digest,
    state: null,
    classification: 'FINANCIAL_RECORD',
    normalizationStatus: 'NORMALIZED',
    transactionId: null,
    currentRevision,
    resolutionCode: null,
    resolvedAt: null,
    resolvedBy: null,
  });
}

function revision(sourceRecordId, rowHint, rowDigest, rawPayload, revisionNumber = 1) {
  return Object.freeze({
    sourceRecordId,
    revision: revisionNumber,
    migrationRunId: '00000000-0000-0000-0000-000000001999',
    observedAt: '2026-09-06T10:00:00.000Z',
    rowHint,
    rowDigest,
    changeClass: null,
    rawPayload,
  });
}

function current(rowHint, digest, rawPayload) {
  return Object.freeze({ rowHint, digest, rawPayload });
}

function baseInput(currentB = payload({ description: { kind: 'STRING', value: 'after' } })) {
  const previousSourceCurrent = Object.freeze([
    source(A, 2, 'a'),
    source(B, 3, 'b'),
    source(C, 5, 'c'),
    source(D, 6, 'd'),
  ]);
  return {
    run: createMigrationRun({
      id: RUN_ID,
      startedAt: '2026-09-07T12:59:00.000Z',
      sourceSnapshotDigest: 'synthetic-current-snapshot',
      counters: { rowsSeen: 4, rowsNew: 1, rowsChanged: 1, rowsMissing: 1, rowsAmbiguous: 0 },
    }),
    baseline: Object.freeze({
      previousSequence: Object.freeze([
        Object.freeze({ sourceRecordId: A, rowHint: 2, digest: 'a' }),
        Object.freeze({ sourceRecordId: B, rowHint: 3, digest: 'b' }),
        Object.freeze({ sourceRecordId: C, rowHint: 5, digest: 'c' }),
        Object.freeze({ sourceRecordId: D, rowHint: 6, digest: 'd' }),
      ]),
      reservedSourceRecordIds: Object.freeze([A, B, C, D]),
    }),
    currentRows: Object.freeze([
      current(2, 'a', payload({ description: { kind: 'STRING', value: 'unchanged-a' } })),
      current(3, 'b2', currentB),
      current(4, 'new', payload({ description: { kind: 'STRING', value: 'inserted' } })),
      current(5, 'c', payload({ description: { kind: 'STRING', value: 'unchanged-c' } })),
    ]),
    sourceAssignments: Object.freeze([{ currentRowHint: 4, sourceRecordId: NEW }]),
    previousSourceCurrent,
    previousRevisionPayloads: Object.freeze([
      revision(A, 2, 'a', payload({ description: { kind: 'STRING', value: 'unchanged-a' } })),
      revision(B, 3, 'b', payload()),
      revision(C, 5, 'c', payload({ description: { kind: 'STRING', value: 'unchanged-c' } })),
      revision(D, 6, 'd', payload({ description: { kind: 'STRING', value: 'missing-d' } })),
    ]),
    observedAt: OBSERVED_AT,
  };
}

test('composes unchanged, revised, inserted and missing structural flow from full verified snapshots', () => {
  const plan = buildIncrementalStructuralPreparation(baseInput());

  assert.deepEqual(plan.lineage.counters, {
    rowsSeen: 4,
    rowsNew: 1,
    rowsChanged: 1,
    rowsMissing: 1,
    rowsAmbiguous: 0,
  });
  assert.deepEqual(plan.lineage.outcomes.map((outcome) => outcome.kind), [
    'UNCHANGED', 'REVISED', 'INSERTED', 'UNCHANGED', 'MISSING',
  ]);
  assert.deepEqual(plan.changeEvidence.changeEvidence, [
    { sourceRecordId: B, changeClass: 'OWNER_CORRECTION' },
  ]);
  assert.deepEqual(plan.revisions.revisions.map((item) => [item.sourceRecordId, item.revision, item.changeClass]), [
    [B, 2, 'OWNER_CORRECTION'],
    [NEW, 1, null],
  ]);
  assert.deepEqual(plan.sourceDelta.intents.map((intent) => intent.kind), [
    'TOUCH', 'REVISE', 'CREATE', 'TOUCH', 'MARK_MISSING',
  ]);

  const revise = plan.sourceDelta.intents.find((intent) => intent.kind === 'REVISE');
  assert.equal(revise.sourceRecordId, B);
  assert.equal(revise.expectedPreviousRevision, 1);
  assert.equal(revise.currentRevision, 2);
  assert.equal(revise.currentDigest, 'b2');

  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.lineage), true);
  assert.equal(Object.isFrozen(plan.revisions), true);
  assert.equal(Object.isFrozen(plan.sourceDelta), true);
});

test('filters full revision snapshot down to exact revised evidence instead of producing false EXTRA evidence', () => {
  const plan = buildIncrementalStructuralPreparation(baseInput());
  assert.equal(plan.changeEvidence.changeEvidence.length, 1);
  assert.equal(plan.revisions.revisions.length, 2);
  assert.equal(plan.revisions.revisions.some((item) => item.sourceRecordId === A), false);
  assert.equal(plan.revisions.revisions.some((item) => item.sourceRecordId === C), false);
  assert.equal(plan.revisions.revisions.some((item) => item.sourceRecordId === D), false);
});

test('context-dependent legacy cleanup remains blocked without explicit proven context', () => {
  const input = baseInput(payload({
    expense_account: { kind: 'STRING', value: 'Карта Visa' },
  }));
  input.previousRevisionPayloads = Object.freeze(input.previousRevisionPayloads.map((item) => (
    item.sourceRecordId === B
      ? revision(B, 3, 'b', payload({ expense_account: { kind: 'STRING', value: 'Карта Credit' } }))
      : item
  )));

  assert.throws(
    () => buildIncrementalStructuralPreparation(input),
    (error) => error instanceof IncrementalRevisionChangeEvidenceError
      && error.code === 'MISSING_CONTEXTUAL_CHANGE_EVIDENCE',
  );
});
