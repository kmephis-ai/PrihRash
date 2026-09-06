import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT,
} from '../../dist/migration/atomicPromotion.js';
import { planInitialBootstrapPromotion } from '../../dist/migration/initialBootstrapPromotionRoute.js';
import { prepareInitialVerifiedCurrentWrites } from '../../dist/migration/initialVerifiedCurrentPersistence.js';
import {
  createMigrationRun,
  markMigrationRunValidated,
} from '../../dist/migration/migrationRunState.js';

const R0_SAFE_PUBLIC_MEANINGFUL_SOURCE_ROW_COUNT = 17_790;
const SOURCE_ID = '00000000-0000-0000-0000-000000001201';

function compiledSourceOnlyWrite() {
  const run = markMigrationRunValidated(createMigrationRun({
    id: '00000000-0000-0000-0000-000000003201',
    startedAt: '2026-09-06T21:22:00Z',
    sourceSnapshotDigest: 'synthetic-snapshot-digest',
    counters: { rowsSeen: 1, rowsNew: 1, rowsChanged: 0, rowsMissing: 0, rowsAmbiguous: 1 },
  }));
  const plan = Object.freeze({
    sourceRecords: Object.freeze([Object.freeze({
      id: SOURCE_ID,
      sourceType: 'GOOGLE_SHEETS',
      sourceSheet: 'Ответы на форму (11)',
      firstSeenAt: '2026-09-06T21:22:00Z',
      lastSeenAt: '2026-09-06T21:22:00Z',
      lastRowHint: 2,
      currentDigest: 'synthetic-digest',
      state: null,
      classification: 'AMBIGUOUS',
      normalizationStatus: null,
      transactionId: null,
      currentRevision: 1,
      resolutionCode: null,
      resolvedAt: null,
      resolvedBy: null,
    })]),
    transactions: Object.freeze([]),
  });

  const writes = prepareInitialVerifiedCurrentWrites(run, plan, '2026-09-06T21:23:00Z');
  assert.equal(writes.length, 1);
  return writes[0];
}

test('actual compiled small initial write set remains eligible for ordinary atomic promotion', () => {
  const write = compiledSourceOnlyWrite();
  const route = planInitialBootstrapPromotion([write]);

  assert.equal(route.route, 'ORDINARY_ATOMIC');
  assert.equal(route.preflight.eligible, true);
  assert.equal(route.preflight.reason, null);
  assert.equal(route.currentWrites[0], write);
});

test('safe public R0 source scale necessarily requires controlled rebuild before any transaction writes', () => {
  const write = compiledSourceOnlyWrite();
  const sourceOnlyWrites = Object.freeze(
    Array.from({ length: R0_SAFE_PUBLIC_MEANINGFUL_SOURCE_ROW_COUNT }, () => write),
  );
  const route = planInitialBootstrapPromotion(sourceOnlyWrites);

  assert.equal(PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT, 512 * 1024);
  assert.equal(route.route, 'CONTROLLED_REBUILD_REQUIRED');
  assert.equal(route.preflight.eligible, false);
  assert.equal(route.preflight.reason, 'PARAMETER_LIMIT_EXCEEDED');
  assert.equal(route.preflight.totalEstimatedParameterBytes > PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT, true);
});
