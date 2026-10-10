import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readInitialBootstrapStaleStagingRetirementCurrentState }
  from '../../dist/migration/initialBootstrapStaleStagingRetirementDiagnostic.js';
import { diagnoseInitialBootstrapStagingRevisionCardinality }
  from '../../dist/migration/initialBootstrapStagingRevisionDiagnostic.js';

function readerWith({source=0n,transactions=0n,rowsSeen=2n,binding=2n,snapshot=2n}={}) {
  return Object.freeze({
    read: async (stmt) => {
      assert.equal(stmt.kind,'READ');
      if (stmt.text.includes('FROM source_records')) return {rows:[{row_count:source}]};
      if (stmt.text.includes('FROM transactions')) return {rows:[{row_count:transactions}]};
      if (stmt.text.includes('FROM migration_runs AS r')) return {rows:[{
        run_state:'STAGING',rows_seen:rowsSeen,binding_count:binding,snapshot_row_count:snapshot,
      }]};
      throw new Error('UNEXPECTED_STATEMENT');
    },
  });
}
test('canonical current state recognizes exact emptiness only', async () => {
  assert.equal(await readInitialBootstrapStaleStagingRetirementCurrentState(readerWith()),
    'STALE_STAGING_CURRENT_STATE_EMPTY');
  assert.equal(await readInitialBootstrapStaleStagingRetirementCurrentState(readerWith({source:1n})),
    'STALE_STAGING_CURRENT_STATE_NOT_EMPTY');
  assert.equal(await readInitialBootstrapStaleStagingRetirementCurrentState(readerWith({transactions:1n})),
    'STALE_STAGING_CURRENT_STATE_NOT_EMPTY');
});
test('canonical manifest cardinality is structural only, not exact source-lineage proof', async () => {
  assert.equal(await diagnoseInitialBootstrapStagingRevisionCardinality(readerWith()),'LT_5000_RU');
  assert.equal(await diagnoseInitialBootstrapStagingRevisionCardinality(readerWith({binding:3n})),
    'DIAGNOSTIC_FAILED');
});
test('no credentials cannot start network read', () => {
  const r=spawnSync(process.execPath,['scripts/r1-direct-staging-current-readonly.mjs'],{
    encoding:'utf8',
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},
    timeout:6000,
  });
  assert.equal(r.status,2,r.stderr);
  assert.equal(r.stdout,'R1_STAGING_CURRENT=CONFIG_INVALID\n');
});
test('workflow and runner stay manual snapshot-only with enum output', () => {
  const flow=readFileSync('.github/workflows/r1-direct-ydb-readonly.yml','utf8');
  const run=readFileSync('scripts/r1-direct-staging-current-readonly.mjs','utf8');
  assert.match(flow,/current_only:/);
  assert.match(flow,/node scripts\/r1-direct-staging-current-readonly.mjs/);
  assert.match(flow,/r1-staging-current-readonly\.test\.mjs/);
  assert.match(run,/readInitialBootstrapStaleStagingRetirementCurrentState/);
  assert.match(run,/diagnoseInitialBootstrapStagingRevisionCardinality/);
  assert.match(run,/snapshotReadOnly/);
  assert.match(run,/READ_SCOPE_NOT_ALLOWLISTED/);
  assert.doesNotMatch(run,/\b(?:INSERT|UPSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+(?:INTO|FROM|TABLE|migration_runs)/i);
  assert.doesNotMatch(run,/JSON\.stringify|\.message|console\.log/);
});
