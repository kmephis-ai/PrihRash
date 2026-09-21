import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(ROOT, path), 'utf8');

test('swap recovery surface is manual exact-main WU7 only', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml');
  assert.match(workflow, /name: R1 initial controlled rebuild swap recovery/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*tracking_issue:[\s\S]*expected_main_sha:[\s\S]*controlled_run_id:[\s\S]*recovery_run_id:[\s\S]*readiness_run_id:/);
  assert.doesNotMatch(workflow, /\bschedule:|\bpush:/);
  assert.match(workflow, /Provider-Authority: WU7_CONTROLLED_REBUILD/);
  assert.match(workflow, /Authority-Scope: PRODUCTION_YDB_INITIAL_SHADOW_ONLY/);
  assert.match(workflow, /Blind-Replay: FORBIDDEN/);
  assert.match(workflow, /SWAP_RECOVERY_WRITER_CONFLICT/);
  assert.match(workflow, /SWAP_RECOVERY_EXACT_SHA_CI_MISSING/);
  assert.match(workflow, /SWAP_RECOVERY_CONTROLLED_EVIDENCE_INVALID/);
  assert.match(workflow, /SWAP_OUTCOME_AMBIGUOUS/);
  assert.match(workflow, /VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY/);
  assert.match(workflow, /READINESS_READY/);
});

test('swap recovery deploy exposes read-only diagnostic handler with exact-source reconstruction secrets', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml');
  assert.match(workflow, /Build diagnostic package[\s\S]*npm run build --silent[\s\S]*npm run package:initial-controlled-rebuild:from-build/);
  assert.match(workflow, /--entrypoint index\.initialControlledRebuildSwapRecoveryDiagnosticHandler/);
  assert.match(workflow, /--tags r1-initial-controlled-rebuild-swap-recovery/);
  assert.match(workflow, /PRIHRASH_GOOGLE_SPREADSHEET_ID/);
  assert.match(workflow, /PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(workflow, /PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(workflow, /PRIHRASH_YDB_CONNECTION_STRING/);
  assert.match(workflow, /PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE/);
  assert.doesNotMatch(workflow, /initialControlledRebuildHandler/);
  assert.doesNotMatch(workflow, /--async-|allUsers.*add-access-binding/);
});

test('swap recovery invokes once and emits enum-only tri-state or bounded runtime evidence', async () => {
  const workflow = await read('.github/workflows/r1-initial-controlled-rebuild-swap-recovery.yml');
  assert.match(workflow, /Invoke read-only exact swap recovery diagnostic once/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_SWAP_RECOVERY_CLASSIFIED/);
  assert.match(workflow, /APPLIED[\s\S]*NOT_APPLIED[\s\S]*RECOVERY_REQUIRED/);
  assert.match(workflow, /DURABLE_RUN_NOT_VALIDATED.*SETUP_EVIDENCE_MISMATCH.*STAGING_RECONCILIATION_MISMATCH.*SWAP_DISCRIMINATION_AMBIGUOUS/s);
  assert.match(workflow, /recoveryReason/);
  assert.match(workflow, /INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED/);
  assert.match(workflow, /SOURCE_READ_FAILED[\s\S]*APPLICATION_FAILED[\s\S]*YDB_CLIENT_CLOSE_FAILED/);
  assert.match(workflow, /PREPARATION[\s\S]*STAGING_RECONCILIATION[\s\S]*SWAP_DISCRIMINATION/);
  assert.match(workflow, /ADMISSION_READ[\s\S]*RESUME_CONTEXT_READ[\s\S]*RESUME_IDENTITY_MANIFEST_READ[\s\S]*RESUME_SNAPSHOT_READ[\s\S]*LINEAGE_PREPARATION[\s\S]*CURRENT_WRITE_PREPARATION/);
  assert.match(workflow, /\{status,code,jobCode,phase,bootstrapPhase\}/);
  assert.match(workflow, /classification\.json/);
  assert.match(workflow, /if-no-files-found: ignore/);
  assert.doesNotMatch(workflow, /renameTables|copyTables|executeControlledInitialSwap|cleanup|retire/i);
});

test('swap recovery runtime keeps bootstrap subphase only inside controlled PREPARATION', async () => {
  const source = await read('src/runtime/initialControlledRebuildJob.ts');
  assert.match(source, /bootstrapPhase = nextPhase;/);
  assert.match(source, /if \(nextPhase !== 'PREPARATION'\) bootstrapPhase = null;/);
  assert.match(source, /InitialControlledRebuildJobError\([\s\S]*?'APPLICATION_FAILED',[\s\S]*?controlledPhase,[\s\S]*?bootstrapPhase/);
  assert.match(source, /error instanceof YdbJsV6DataTransportError \? error\.code : null/);
});
