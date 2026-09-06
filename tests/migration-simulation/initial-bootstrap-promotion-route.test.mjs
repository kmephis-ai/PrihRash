import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatement } from '../../dist/integration/ydb/adapter.js';
import {
  COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES,
  PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT,
} from '../../dist/migration/atomicPromotion.js';
import { planInitialBootstrapPromotion } from '../../dist/migration/initialBootstrapPromotionRoute.js';

function syntheticCurrentWrite(estimatedParameterBytes) {
  return {
    statement: writeStatement('UPSERT INTO source_records (id) VALUES ($id)'),
    estimatedParameterBytes,
  };
}

test('routes eligible current-state bootstrap writes through ordinary atomic promotion', () => {
  const plan = planInitialBootstrapPromotion([
    syntheticCurrentWrite(128),
    syntheticCurrentWrite(256),
  ]);

  assert.equal(plan.route, 'ORDINARY_ATOMIC');
  assert.equal(plan.preflight.eligible, true);
  assert.equal(
    plan.preflight.totalEstimatedParameterBytes,
    COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES + 384,
  );
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.currentWrites), true);
});

test('routes oversized full bootstrap to controlled rebuild without changing calibrated cap', () => {
  const perRowLowerBound = 368;
  const enoughRowsToExceedOrdinaryCap = Math.floor(
    (PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT - COMMIT_MARKER_ESTIMATED_PARAMETER_BYTES)
      / perRowLowerBound,
  ) + 1;
  const currentWrites = Array.from(
    { length: enoughRowsToExceedOrdinaryCap },
    () => syntheticCurrentWrite(perRowLowerBound),
  );

  const plan = planInitialBootstrapPromotion(currentWrites);

  assert.equal(plan.route, 'CONTROLLED_REBUILD_REQUIRED');
  assert.equal(plan.preflight.eligible, false);
  assert.equal(plan.preflight.reason, 'PARAMETER_LIMIT_EXCEEDED');
  assert.equal(plan.preflight.totalEstimatedParameterBytes > PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT, true);
});

test('invalid promotion write contract still fails closed instead of choosing a route', () => {
  assert.throws(
    () => planInitialBootstrapPromotion([{ statement: { kind: 'READ', text: 'SELECT 1', parameters: {} }, estimatedParameterBytes: 0 }]),
    /INVALID_PROMOTION_STATEMENT/,
  );
});
