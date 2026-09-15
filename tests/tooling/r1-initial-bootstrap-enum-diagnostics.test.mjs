import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtime = await readFile('src/runtime/initialBootstrapReferenceAwareJob.ts', 'utf8');
const invoker = await readFile('scripts/invoke-yandex-initial-bootstrap.mjs', 'utf8');
const workflow = await readFile('.github/workflows/r1-initial-shadow-bootstrap.yml', 'utf8');

test('bootstrap metadata diagnostics stay enum-only from runtime through invoker', () => {
  assert.match(invoker, /exactKeys\(result, \['status', 'code', 'runtimeCode', 'applicationPhase', 'metadataFailureCode'\]\)/);
  assert.match(invoker, /exactKeys\(result, \['status', 'code', 'runtimeCode', 'applicationPhase', 'metadataFailureCode', 'ydbDataFailureCode'\]\)/);
  assert.match(invoker, /APPLICATION_PHASES\.has\(result\.applicationPhase\)/);
  assert.match(invoker, /METADATA_FAILURE_CODES\.has\(result\.metadataFailureCode\)/);
  assert.match(invoker, /YDB_DATA_FAILURE_CODES\.has\(result\.ydbDataFailureCode\)/);
  assert.match(runtime, /classifyYdbDataFailureCode\(error\)/);
  assert.match(runtime, /classifyMetadataFailureCode\(error: unknown\)/);
  assert.match(runtime, /METADATA_EXECUTOR_\$\{error\.code\}/);
  assert.doesNotMatch(invoker, /runtimeMessage|exceptionText|errorDetail/);
});

test('bootstrap workflow projects only allowlisted phase and metadata failure enums', () => {
  assert.match(workflow, /applicationPhase:/);
  assert.match(workflow, /metadataFailureCode:/);
  assert.match(workflow, /ydbDataFailureCode:/);
  assert.match(workflow, /FRESH_CLAIM_WRITE/);
  assert.match(workflow, /METADATA_EXECUTOR_RUN_READBACK_MISMATCH/);
  assert.match(workflow, /METADATA_EXECUTOR_IDENTITY_MANIFEST_READ_FAILED/);
  assert.match(workflow, /METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTEXT_READBACK_MISMATCH/);
  assert.match(workflow, /METADATA_EXECUTOR_IDENTITY_MANIFEST_CONTENT_READBACK_MISMATCH/);
  const structuralManifestCodes = [
    'MALFORMED_ROW_CARDINALITY',
    'MALFORMED_BINDINGS_VALUE_MISSING',
    'MALFORMED_BINDINGS_VALUE_NULL',
    'MALFORMED_BINDINGS_VALUE_BINARY',
    'MALFORMED_BINDINGS_JSON_STRING_INVALID',
    'MALFORMED_BINDINGS_ROOT_TYPE',
    'MALFORMED_BINDINGS_SCHEMA_VERSION',
    'MALFORMED_BINDINGS_ARRAY',
    'MALFORMED_BINDINGS_ROOT_KEYS',
    'MALFORMED_BINDING_ENTRY',
    'MALFORMED_BINDING_SET',
    'MALFORMED_BINDING_COUNT',
    'MALFORMED_SNAPSHOT_ROW_COUNT',
    'MALFORMED_RUN_STATE',
    'MALFORMED_MIGRATION_RUN_ID',
    'MALFORMED_SOURCE_SNAPSHOT_ID',
    'MALFORMED_SOURCE_SNAPSHOT_DIGEST',
    'MALFORMED_RUN_SNAPSHOT_DIGEST',
    'MALFORMED_SNAPSHOT_DIGEST',
  ];
  for (const code of structuralManifestCodes) {
    assert.match(workflow, new RegExp(`IDENTITY_MANIFEST_${code}`));
    assert.match(invoker, new RegExp(`IDENTITY_MANIFEST_${code}`));
  }
  assert.doesNotMatch(workflow, /IDENTITY_MANIFEST_MALFORMED_MANIFEST_ROW/);
  assert.doesNotMatch(invoker, /IDENTITY_MANIFEST_MALFORMED_MANIFEST_ROW/);
  assert.doesNotMatch(workflow, /IDENTITY_MANIFEST_MALFORMED_BINDINGS_PAYLOAD/);
  assert.doesNotMatch(invoker, /IDENTITY_MANIFEST_MALFORMED_BINDINGS_PAYLOAD/);
  for (const code of [
    'YDB_TRANSPORT_SDK_SHAPE_INVALID',
    'YDB_TRANSPORT_PARAMETER_VALUE_INVALID',
    'YDB_TRANSPORT_PARAMETER_TYPE_UNSUPPORTED',
    'YDB_TRANSPORT_TIMESTAMP_PRECISION_UNSUPPORTED',
    'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    'YDB_TRANSPORT_CLIENT_CONFIG_INVALID',
    'YDB_ADAPTER_WRITE_REQUIRES_TRANSACTION',
      'YDB_COMMIT_OUTCOME_UNKNOWN',
  ]) {
    assert.match(workflow, new RegExp(code));
    assert.match(invoker, new RegExp(code));
  }
  assert.match(workflow, /runtimeCode:/);
  assert.match(workflow, /httpStatus:/);
  assert.match(workflow, /functionError:/);
  assert.match(workflow, /INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED/);
  assert.doesNotMatch(workflow, /classification\.json[^\n]*(?:stdout|stderr|message|payload|details)/i);
});
