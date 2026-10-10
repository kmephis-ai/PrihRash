import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { classifyInitialBootstrapStagingRunLineage } from '../../dist/migration/initialBootstrapRecoveryProbe.js';

test('canonical lineage classifier keeps temporal ambiguity fail-closed', () => {
  const child='2026-01-01T10:00:00.000Z';
  assert.equal(classifyInitialBootstrapStagingRunLineage('2026-01-01T09:59:54.000Z',child), 'STAGING_PREDATES_BOOTSTRAP_CHILD');
  assert.equal(classifyInitialBootstrapStagingRunLineage('2026-01-01T10:00:06.000Z',child), 'STAGING_STARTED_AFTER_BOOTSTRAP_CHILD');
  assert.equal(classifyInitialBootstrapStagingRunLineage('2026-01-01T10:00:04.000Z',child), 'STAGING_START_TIME_AMBIGUOUS');
  assert.equal(classifyInitialBootstrapStagingRunLineage('malformed',child), 'DIAGNOSTIC_FAILED');
});
test('lineage runner cannot query with missing trusted credentials', () => {
  const run=spawnSync(process.execPath,['scripts/r1-direct-staging-lineage-readonly.mjs'],{
    encoding:'utf8',
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},timeout:6000,
  });
  assert.equal(run.status,2,run.stderr);
  assert.equal(run.stdout,'R1_LINEAGE=CONFIG_INVALID\n');
});
test('workflow proves causal child and strictly single read-only query', () => {
  const y=readFileSync('.github/workflows/r1-direct-ydb-readonly.yml','utf8');
  const s=readFileSync('scripts/r1-direct-staging-lineage-readonly.mjs','utf8');
  assert.match(y,/lineage_only:/);
  assert.match(y,/actions\/runs\/36327850242\/jobs/);
  assert.match(y,/Invoke exact initial bootstrap tag once/);
  assert.match(y,/CAUSAL_INVOKE_NOT_PROVEN/);
  assert.match(y,/npm run build --silent/);
  assert.match(y,/node scripts\/r1-direct-staging-lineage-readonly.mjs/);
  assert.match(s,/classifyInitialBootstrapStagingRunLineage/);
  assert.match(s,/SELECT started_at FROM migration_runs[\s\S]*WHERE state = 'STAGING' LIMIT 2/);
  assert.match(s,/\.isolation\('snapshotReadOnly'\)/);
  assert.doesNotMatch(s,/\b(?:INSERT|UPDATE|UPSERT|DELETE|CREATE|ALTER|DROP)\b/);
  assert.doesNotMatch(s,/console\.log|JSON\.stringify|\.message/);
});
