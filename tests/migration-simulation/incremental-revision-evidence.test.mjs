import test from 'node:test';
import assert from 'node:assert/strict';
import { createMigrationRun, markMigrationRunValidated } from '../../dist/migration/migrationRunState.js';
import { buildIncrementalLineagePlan } from '../../dist/migration/incrementalLineagePlan.js';
import {
  IncrementalRevisionEvidenceError,
  buildIncrementalRevisionEvidencePlan,
} from '../../dist/migration/incrementalRevisionEvidence.js';
import { RawPayloadProvenanceError } from '../../dist/migration/rawPayloadProvenance.js';

const RUN_ID = '00000000-0000-0000-0000-000000001901';
const ID_A = '00000000-0000-0000-0000-000000001902';
const ID_B = '00000000-0000-0000-0000-000000001903';
const ID_NEW = '00000000-0000-0000-0000-000000001904';
const OBSERVED_AT = '2026-09-07T05:10:00.000Z';

function payload(description) {
  const S = (value) => ({ kind: 'STRING', value });
  const N = (value) => ({ kind: 'NUMBER', value });
  return {
    adapter_schema_version: 2,
    date: N('45292.5'),
    operation_type: S('Расход'),
    expense_account: S('Synthetic Account'),
    expense_category: S('Synthetic Category'),
    description: S(description),
    expense_amount: N('123.45'),
    income_account: null,
    income_category: null,
    income_amount: null,
    vika_flag: null,
    note: null,
  };
}

function stagingRun(counters = {}) {
  return createMigrationRun({
    id: RUN_ID,
    startedAt: '2026-09-07T05:09:59.000Z',
    sourceSnapshotDigest: 'synthetic-incremental-snapshot',
    counters: {
      rowsSeen: 0,
      rowsNew: 0,
      rowsChanged: 0,
      rowsMissing: 0,
      rowsAmbiguous: 0,
      ...counters,
    },
  });
}

function mixedLineage() {
  return buildIncrementalLineagePlan(
    [
      { sourceRecordId: ID_A, rowHint: 2, digest: 'a' },
      { sourceRecordId: ID_B, rowHint: 4, digest: 'b' },
    ],
    [
      { rowHint: 2, digest: 'a2' },
      { rowHint: 3, digest: 'new' },
      { rowHint: 4, digest: 'b' },
    ],
    [{ currentRowHint: 3, sourceRecordId: ID_NEW }],
  );
}

test('plans first-sight and revised evidence only, preserving deterministic revision semantics', () => {
  const lineage = mixedLineage();
  const plan = buildIncrementalRevisionEvidencePlan(
    stagingRun(lineage.counters),
    lineage,
    OBSERVED_AT,
    [
      { currentRowHint: 2, payload: payload('Synthetic revised') },
      { currentRowHint: 3, payload: payload('Synthetic inserted') },
    ],
    [{ sourceRecordId: ID_A.toUpperCase(), currentRevision: 5 }],
    [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
  );

  assert.deepEqual(plan.revisions.map((revision) => ({
    sourceRecordId: revision.sourceRecordId,
    revision: revision.revision,
    rowHint: revision.rowHint,
    rowDigest: revision.rowDigest,
    changeClass: revision.changeClass,
  })), [
    {
      sourceRecordId: ID_A,
      revision: 6,
      rowHint: 2,
      rowDigest: 'a2',
      changeClass: 'OWNER_CORRECTION',
    },
    {
      sourceRecordId: ID_NEW,
      revision: 1,
      rowHint: 3,
      rowDigest: 'new',
      changeClass: null,
    },
  ]);
  assert.equal(plan.revisions[0].migrationRunId, RUN_ID);
  assert.equal(plan.revisions[0].observedAt, OBSERVED_AT);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.revisions), true);
  assert.equal(Object.isFrozen(plan.revisions[0]), true);
});

test('raw payload serialization is shared and canonical for incremental evidence', () => {
  const lineage = buildIncrementalLineagePlan(
    [],
    [{ rowHint: 2, digest: 'new' }],
    [{ currentRowHint: 2, sourceRecordId: ID_NEW }],
  );
  const plan = buildIncrementalRevisionEvidencePlan(
    stagingRun(lineage.counters),
    lineage,
    OBSERVED_AT,
    [{ currentRowHint: 2, payload: payload('Synthetic inserted') }],
    [],
    [],
  );

  assert.equal(
    plan.revisions[0].rawPayload,
    JSON.stringify({
      adapter_schema_version: 2,
      date: { kind: 'NUMBER', value: '45292.5' },
      operation_type: { kind: 'STRING', value: 'Расход' },
      expense_account: { kind: 'STRING', value: 'Synthetic Account' },
      expense_category: { kind: 'STRING', value: 'Synthetic Category' },
      description: { kind: 'STRING', value: 'Synthetic inserted' },
      expense_amount: { kind: 'NUMBER', value: '123.45' },
      income_account: null,
      income_category: null,
      income_amount: null,
      vika_flag: null,
      note: null,
    }),
  );
});

test('unchanged, missing and ambiguous lineage create no synthetic revisions', () => {
  const unchanged = buildIncrementalLineagePlan(
    [{ sourceRecordId: ID_A, rowHint: 2, digest: 'a' }],
    [{ rowHint: 2, digest: 'a' }],
    [],
  );
  const unchangedPlan = buildIncrementalRevisionEvidencePlan(
    stagingRun(unchanged.counters), unchanged, OBSERVED_AT, [], [], [],
  );
  assert.deepEqual(unchangedPlan.revisions, []);

  const missing = buildIncrementalLineagePlan(
    [{ sourceRecordId: ID_A, rowHint: 2, digest: 'a' }],
    [],
    [],
  );
  const missingPlan = buildIncrementalRevisionEvidencePlan(
    stagingRun(missing.counters), missing, OBSERVED_AT, [], [], [],
  );
  assert.deepEqual(missingPlan.revisions, []);

  const ambiguous = buildIncrementalLineagePlan(
    [
      { sourceRecordId: ID_A, rowHint: 2, digest: 'old-a' },
      { sourceRecordId: ID_B, rowHint: 3, digest: 'old-b' },
    ],
    [
      { rowHint: 2, digest: 'new-a' },
      { rowHint: 3, digest: 'new-b' },
    ],
    [],
  );
  const ambiguousPlan = buildIncrementalRevisionEvidencePlan(
    stagingRun(ambiguous.counters), ambiguous, OBSERVED_AT, [], [], [],
  );
  assert.deepEqual(ambiguousPlan.revisions, []);
});

test('payload observations must exactly cover INSERTED and REVISED current row hints', () => {
  const lineage = mixedLineage();

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters),
      lineage,
      OBSERVED_AT,
      [{ currentRowHint: 2, payload: payload('only revised') }],
      [{ sourceRecordId: ID_A, currentRevision: 1 }],
      [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'MISSING_PAYLOAD_ROW_HINT',
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters),
      lineage,
      OBSERVED_AT,
      [
        { currentRowHint: 2, payload: payload('revised') },
        { currentRowHint: 3, payload: payload('inserted') },
        { currentRowHint: 4, payload: payload('extra unchanged') },
      ],
      [{ sourceRecordId: ID_A, currentRevision: 1 }],
      [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'EXTRA_PAYLOAD_ROW_HINT',
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters),
      lineage,
      OBSERVED_AT,
      [
        { currentRowHint: 2, payload: payload('one') },
        { currentRowHint: 2, payload: payload('duplicate') },
        { currentRowHint: 3, payload: payload('inserted') },
      ],
      [{ sourceRecordId: ID_A, currentRevision: 1 }],
      [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'DUPLICATE_PAYLOAD_ROW_HINT',
  );
});

test('revised rows require exact previous revision and change-class evidence', () => {
  const lineage = buildIncrementalLineagePlan(
    [{ sourceRecordId: ID_A, rowHint: 2, digest: 'a' }],
    [{ rowHint: 2, digest: 'a2' }],
    [],
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters), lineage, OBSERVED_AT,
      [{ currentRowHint: 2, payload: payload('revised') }], [],
      [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'MISSING_PREVIOUS_REVISION_EVIDENCE',
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters), lineage, OBSERVED_AT,
      [{ currentRowHint: 2, payload: payload('revised') }],
      [{ sourceRecordId: ID_A, currentRevision: 2 }], [],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'MISSING_CHANGE_CLASS_EVIDENCE',
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters), lineage, OBSERVED_AT,
      [{ currentRowHint: 2, payload: payload('revised') }],
      [{ sourceRecordId: ID_A, currentRevision: Number.MAX_SAFE_INTEGER }],
      [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'REVISION_OVERFLOW',
  );
});

test('extra previous revision or change evidence cannot be attached to non-revised rows', () => {
  const lineage = buildIncrementalLineagePlan(
    [],
    [{ rowHint: 2, digest: 'new' }],
    [{ currentRowHint: 2, sourceRecordId: ID_NEW }],
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters), lineage, OBSERVED_AT,
      [{ currentRowHint: 2, payload: payload('new') }],
      [{ sourceRecordId: ID_A, currentRevision: 1 }], [],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'EXTRA_PREVIOUS_REVISION_EVIDENCE',
  );

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters), lineage, OBSERVED_AT,
      [{ currentRowHint: 2, payload: payload('new') }], [],
      [{ sourceRecordId: ID_A, changeClass: 'OWNER_CORRECTION' }],
    ),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'EXTRA_CHANGE_CLASS_EVIDENCE',
  );
});

test('invalid raw payload remains fail-closed through the shared provenance codec', () => {
  const lineage = buildIncrementalLineagePlan(
    [],
    [{ rowHint: 2, digest: 'new' }],
    [{ currentRowHint: 2, sourceRecordId: ID_NEW }],
  );
  const invalid = payload('bad');
  invalid.expense_amount = { kind: 'NUMBER', value: '1.230' };

  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(
      stagingRun(lineage.counters), lineage, OBSERVED_AT,
      [{ currentRowHint: 2, payload: invalid }], [], [],
    ),
    (error) => error instanceof RawPayloadProvenanceError
      && error.code === 'INVALID_PAYLOAD_VALUE',
  );
});

test('revision evidence plan requires an unfinished STAGING run', () => {
  const lineage = buildIncrementalLineagePlan([], [], []);
  const validated = markMigrationRunValidated(stagingRun(lineage.counters));
  assert.throws(
    () => buildIncrementalRevisionEvidencePlan(validated, lineage, OBSERVED_AT, [], [], []),
    (error) => error instanceof IncrementalRevisionEvidenceError
      && error.code === 'RUN_NOT_STAGING',
  );
});
