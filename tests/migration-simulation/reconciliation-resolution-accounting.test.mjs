import test from 'node:test';
import assert from 'node:assert/strict';
import { markReviewRequired, resolveReviewItem } from '../../dist/migration/resolution.js';
import {
  ReconciliationResolutionAccountingError,
  accountReconciliationResolutions,
} from '../../dist/migration/reconciliationResolutionAccounting.js';

const SOURCE_A = '00000000-0000-0000-0000-000000001401';
const SOURCE_B = '00000000-0000-0000-0000-000000001402';
const SOURCE_C = '00000000-0000-0000-0000-000000001403';
const AUDIT = { resolvedAt: '2026-09-07T04:30:00.000Z', resolvedBy: 'OWNER' };

function resolved(sourceRecordId, state = 'MISSING') {
  return resolveReviewItem(
    markReviewRequired(sourceRecordId, state, null),
    'RESOLVED_NO_CHANGE',
    AUDIT,
  );
}

test('complete resolution explains exactly one matching high-impact source mismatch', () => {
  const result = accountReconciliationResolutions(
    [
      { sourceRecordId: SOURCE_A, highImpact: true },
      { sourceRecordId: SOURCE_B, highImpact: true },
      { sourceRecordId: SOURCE_C, highImpact: false },
    ],
    [resolved(SOURCE_A), markReviewRequired(SOURCE_B, 'AMBIGUOUS', null)],
  );

  assert.deepEqual(result, {
    totalSourceMismatchCount: 3,
    highImpactSourceMismatchCount: 2,
    explainedHighImpactMismatchCount: 1,
    unexplainedHighImpactMismatchCount: 1,
  });
  assert.equal(Object.isFrozen(result), true);
});

test('mismatch without review evidence remains unexplained', () => {
  const result = accountReconciliationResolutions(
    [{ sourceRecordId: SOURCE_A, highImpact: true }],
    [],
  );
  assert.equal(result.unexplainedHighImpactMismatchCount, 1);
});

test('non-high-impact mismatch is not laundered into high-impact accounting', () => {
  const result = accountReconciliationResolutions(
    [{ sourceRecordId: SOURCE_A, highImpact: false }],
    [resolved(SOURCE_A)],
  );
  assert.equal(result.highImpactSourceMismatchCount, 0);
  assert.equal(result.explainedHighImpactMismatchCount, 0);
  assert.equal(result.unexplainedHighImpactMismatchCount, 0);
});

test('resolved review without corresponding mismatch fails closed', () => {
  assert.throws(
    () => accountReconciliationResolutions([], [resolved(SOURCE_A)]),
    (error) => error instanceof ReconciliationResolutionAccountingError
      && error.code === 'RESOLUTION_WITHOUT_MISMATCH',
  );
});

test('duplicate mismatch source IDs fail closed case-insensitively', () => {
  assert.throws(
    () => accountReconciliationResolutions(
      [
        { sourceRecordId: SOURCE_A, highImpact: true },
        { sourceRecordId: SOURCE_A.toUpperCase(), highImpact: true },
      ],
      [],
    ),
    (error) => error instanceof ReconciliationResolutionAccountingError
      && error.code === 'DUPLICATE_MISMATCH_SOURCE_ID',
  );
});

test('duplicate review source IDs fail closed', () => {
  assert.throws(
    () => accountReconciliationResolutions(
      [{ sourceRecordId: SOURCE_A, highImpact: true }],
      [markReviewRequired(SOURCE_A, 'MISSING', null), markReviewRequired(SOURCE_A, 'MISSING', null)],
    ),
    (error) => error instanceof ReconciliationResolutionAccountingError
      && error.code === 'DUPLICATE_REVIEW_SOURCE_ID',
  );
});
