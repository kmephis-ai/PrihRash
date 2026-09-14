import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtime = await readFile('src/runtime/initialBootstrapReferenceAwareJob.ts', 'utf8');
const invoker = await readFile('scripts/invoke-yandex-initial-bootstrap.mjs', 'utf8');

const STAGE_CODES = Object.freeze([
  'REFERENCE_SOURCE_READ_FAILED',
  'REFERENCE_YDB_CLIENT_CREATE_FAILED',
  'REFERENCE_RESOLUTION_FAILED',
  'REFERENCE_ADMISSION_READ_FAILED',
  'REFERENCE_APPLICATION_ADMISSION_EVIDENCE_FAILED',
  'REFERENCE_APPLICATION_SEMANTIC_FAILED',
  'REFERENCE_APPLICATION_METADATA_FAILED',
  'REFERENCE_APPLICATION_YDB_DATA_FAILED',
  'REFERENCE_APPLICATION_RUNTIME_FAILED',
]);

test('initial bootstrap exposes only allowlisted stage-level runtime diagnostics', () => {
  for (const code of STAGE_CODES) {
    assert.match(runtime, new RegExp(`'${code}'`));
    assert.match(invoker, new RegExp(`'${code}'`));
  }

  assert.match(runtime, /readFullSnapshotObservation[\s\S]*REFERENCE_SOURCE_READ_FAILED/);
  assert.match(runtime, /createYdbJsV6MetadataDataClient[\s\S]*REFERENCE_YDB_CLIENT_CREATE_FAILED/);
  assert.match(runtime, /planInitialReferenceBootstrap[\s\S]*REFERENCE_RESOLUTION_FAILED/);
  assert.match(runtime, /readScheduledSyncAdmissionEvidence[\s\S]*REFERENCE_ADMISSION_READ_FAILED/);
  assert.match(runtime, /ScheduledSyncAdmissionEvidenceError[\s\S]*REFERENCE_APPLICATION_ADMISSION_EVIDENCE_FAILED/);
  assert.match(runtime, /InitialBootstrapApplicationError[\s\S]*REFERENCE_APPLICATION_SEMANTIC_FAILED/);
  assert.match(runtime, /InitialBootstrapMetadataExecutorError[\s\S]*REFERENCE_APPLICATION_METADATA_FAILED/);
  assert.match(runtime, /YdbJsV6DataTransportError[\s\S]*REFERENCE_APPLICATION_YDB_DATA_FAILED/);
  assert.match(runtime, /return 'REFERENCE_APPLICATION_RUNTIME_FAILED'/);
});

test('application taxonomy stays category-only and keeps generic fallback', () => {
  assert.match(runtime, /classifyApplicationRuntimeError\(\s*error: unknown/);
  assert.match(runtime, /catch \(error\)[\s\S]*classifyApplicationRuntimeError\(error\)/);
  assert.doesNotMatch(runtime, /error\.message|error\.stack|String\(error\)|JSON\.stringify\(error\)/);
});

test('stage taxonomy does not expose exception text or provider payload through the invoker', () => {
  assert.match(invoker, /exactKeys\(result, \['status', 'code', 'runtimeCode'\]\)/);
  assert.match(invoker, /REFERENCE_AWARE_RUNTIME_CODES\.has\(result\.runtimeCode\)/);
  assert.doesNotMatch(invoker, /runtimeMessage|exceptionText|errorDetail/);
});
