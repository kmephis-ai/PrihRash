import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(ROOT, path), 'utf8');

test('swap recovery surface is manual exact-main WU7 only', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml');
  assert.match(workflow, /name: R1 initial controlled rebuild swap recovery/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*tracking_issue:[\s\S]*expected_main_sha:/);
  assert.doesNotMatch(workflow, /\bschedule:|\bpush:/);
  assert.match(workflow, /Provider-Authority: WU7_CONTROLLED_REBUILD/);
  assert.match(workflow, /Authority-Scope: PRODUCTION_YDB_INITIAL_SHADOW_ONLY/);
  assert.match(workflow, /Blind-Replay: FORBIDDEN/);
  assert.match(workflow, /SWAP_RECOVERY_WRITER_CONFLICT/);
  assert.match(workflow, /SWAP_RECOVERY_EXACT_SHA_CI_MISSING/);
});

test('swap recovery deploy exposes only read-only diagnostic handler and YDB secret', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml');
  assert.match(workflow, /--entrypoint index\.initialControlledRebuildSwapRecoveryDiagnosticHandler/);
  assert.match(workflow, /--tags r1-initial-controlled-rebuild-swap-recovery/);
  assert.match(workflow, /PRIHRASH_YDB_CONNECTION_STRING/);
  assert.doesNotMatch(workflow, /PRIHRASH_GOOGLE_SPREADSHEET_ID|PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL|PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /initialControlledRebuildHandler/);
  assert.doesNotMatch(workflow, /--async-|allUsers.*add-access-binding/);
});

test('swap recovery invokes once and emits enum-only tri-state evidence', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml');
  assert.match(workflow, /Invoke read-only exact swap recovery diagnostic once/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED/);
  assert.match(workflow, /APPLIED.*NOT_APPLIED.*RECOVERY_REQUIRED/);
  assert.match(workflow, /classification\.json/);
  assert.doesNotMatch(workflow, /renameTables|copyTables|executeControlledInitialSwap|cleanup|retire/i);
});
