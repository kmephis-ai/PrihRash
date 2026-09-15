import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtime = await readFile('src/runtime/initialBootstrapReferenceAwareJob.ts', 'utf8');
const invoker = await readFile('scripts/invoke-yandex-initial-bootstrap.mjs', 'utf8');
const workflow = await readFile('.github/workflows/r1-initial-shadow-bootstrap.yml', 'utf8');

test('bootstrap metadata diagnostics stay enum-only from runtime through invoker', () => {
  assert.match(invoker, /exactKeys\(result, \['status', 'code', 'runtimeCode', 'applicationPhase', 'metadataFailureCode'\]\)/);
  assert.match(invoker, /APPLICATION_PHASES\.has\(result\.applicationPhase\)/);
  assert.match(invoker, /METADATA_FAILURE_CODES\.has\(result\.metadataFailureCode\)/);
  assert.match(runtime, /classifyMetadataFailureCode\(error: unknown\)/);
  assert.match(runtime, /METADATA_EXECUTOR_\$\{error\.code\}/);
  assert.doesNotMatch(invoker, /runtimeMessage|exceptionText|errorDetail/);
});

test('bootstrap workflow projects only allowlisted phase and metadata failure enums', () => {
  assert.match(workflow, /applicationPhase:/);
  assert.match(workflow, /metadataFailureCode:/);
  assert.match(workflow, /FRESH_CLAIM_WRITE/);
  assert.match(workflow, /METADATA_EXECUTOR_RUN_READBACK_MISMATCH/);
  assert.match(workflow, /METADATA_EXECUTOR_IDENTITY_MANIFEST_READ_FAILED/);
  assert.match(workflow, /METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTEXT_READBACK_MISMATCH/);
  assert.match(workflow, /METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTENT_READBACK_MISMATCH/);
  assert.match(workflow, /IDENTITY_MANIFEST_MALFORMED_MANIFEST_ROW/);
  assert.match(workflow, /runtimeCode:/);
  assert.match(workflow, /httpStatus:/);
  assert.match(workflow, /functionError:/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED/);
  assert.doesNotMatch(workflow, /classification\.json[^\n]*(?:stdout|stderr|message|payload|details)/i);
});
