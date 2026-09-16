import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseInitialBootstrapStaleStagingRetirementCurrentState,
} from '../../dist/migration/initialBootstrapStaleStagingRetirementDiagnostic.js';

function reader(sourceCount, transactionCount) {
  const statements = [];
  return Object.freeze({
    statements,
    async read(statement) {
      statements.push(statement);
      assert.equal(statement.kind, 'READ');
      if (statement.text.includes('FROM source_records')) {
        return { rows: [{ row_count: sourceCount }] };
      }
      if (statement.text.includes('FROM transactions')) {
        return { rows: [{ row_count: transactionCount }] };
      }
      throw new Error('unexpected statement');
    },
  });
}

test('stale STAGING retirement diagnostic proves exact-empty current tables without exposing counts', async () => {
  const evidenceReader = reader(0n, 0n);
  assert.equal(
    await diagnoseInitialBootstrapStaleStagingRetirementCurrentState(evidenceReader),
    'STALE_STAGING_CURRENT_STATE_EMPTY',
  );
  assert.equal(evidenceReader.statements.length, 2);
});

test('stale STAGING retirement diagnostic fails closed when either current table is non-empty', async () => {
  assert.equal(
    await diagnoseInitialBootstrapStaleStagingRetirementCurrentState(reader(1n, 0n)),
    'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
  );
  assert.equal(
    await diagnoseInitialBootstrapStaleStagingRetirementCurrentState(reader(0n, 1n)),
    'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
  );
});

test('stale STAGING retirement diagnostic keeps malformed evidence enum-safe but propagates query failures', async () => {
  assert.equal(
    await diagnoseInitialBootstrapStaleStagingRetirementCurrentState({
      async read() { return { rows: [] }; },
    }),
    'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED',
  );

  const providerFailure = new Error('synthetic read failure');
  await assert.rejects(
    () => diagnoseInitialBootstrapStaleStagingRetirementCurrentState({
      async read() { throw providerFailure; },
    }),
    (error) => error === providerFailure,
  );
});
