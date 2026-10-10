import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyMigrationLifecycleGroups } from '../../scripts/r1-migration-lifecycle-classifier.mjs';

const one = (state, count = 1n) => [[{ state, row_count: count }]];
test('empty history does not prove a verified financial baseline', () => {
  assert.equal(classifyMigrationLifecycleGroups([[]]), 'EMPTY_RUN_HISTORY_UNVERIFIED');
});
test('staging and validated evidence stays in recovery boundary', () => {
  assert.equal(classifyMigrationLifecycleGroups(one('STAGING')), 'STAGING_PRESENT_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationLifecycleGroups(one('VALIDATED')), 'VALIDATED_PRESENT_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationLifecycleGroups(one('STAGING', 2n)), 'MULTIPLE_STAGING_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationLifecycleGroups(one('VALIDATED', 2n)), 'MULTIPLE_VALIDATED_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationLifecycleGroups([[{state:'STAGING',row_count:1n},{state:'VALIDATED',row_count:1n}]]),
    'MULTIPLE_ACTIVE_STATES_RECOVERY_REQUIRED');
});
test('committed marker is never promoted into verified baseline', () => {
  assert.equal(classifyMigrationLifecycleGroups(one('COMMITTED')), 'COMMITTED_MARKER_UNVERIFIED');
  assert.equal(classifyMigrationLifecycleGroups([[{state:'FAILED',row_count:1n},{state:'COMMITTED',row_count:1n}]]),
    'COMMITTED_MARKER_UNVERIFIED');
  assert.equal(classifyMigrationLifecycleGroups(one('FAILED')), 'FAILED_HISTORY_ONLY_UNVERIFIED');
});
test('malformed cardinalities, vocabulary and result sets fail closed', () => {
  for (const evidence of [
    null, [], [[], []], [null], [[null]], [[{state:'OTHER',row_count:1n}]],
    [[{state:'STAGING',row_count:0}]], [[{state:'STAGING',row_count:-1n}]],
    [[{state:'STAGING',row_count:'1'}]], [[{state:'STAGING',row_count:1.1}]],
    [[{state:'STAGING',row_count:1n},{state:'STAGING',row_count:1n}]],
    [Array.from({length:5},()=>({state:'STAGING',row_count:1n}))],
  ]) assert.equal(classifyMigrationLifecycleGroups(evidence), 'EVIDENCE_INVALID');
});
test('live runner and manual workflow stay read-only and enum-only', () => {
  const runner=readFileSync('scripts/r1-direct-migration-lifecycle-readonly.mjs','utf8');
  const workflow=readFileSync('.github/workflows/r1-direct-ydb-readonly.yml','utf8');
  assert.match(runner,/SELECT state, COUNT\(\*\) AS row_count[\s\S]*FROM migration_runs[\s\S]*GROUP BY state/);
  assert.match(runner,/\.isolation\('snapshotReadOnly'\)/);
  assert.doesNotMatch(runner,/\b(?:INSERT|UPSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE)\s+(?:INTO|TABLE|FROM|migration_runs)/i);
  assert.match(workflow,/lifecycle_only:/);
  assert.match(workflow,/node scripts\/r1-direct-migration-lifecycle-readonly\.mjs/);
  assert.match(workflow,/GITHUB_RUN_ATTEMPT.*'1'/);
  assert.match(workflow,/get.*YC_TARGET_DB_ID|ydb\/v1\/databases\/\$\{YC_TARGET_DB_ID\}/);
});
