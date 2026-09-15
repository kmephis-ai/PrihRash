import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  INITIAL_BOOTSTRAP_APPLICATION_PHASES,
  INITIAL_BOOTSTRAP_CODES,
  INITIAL_BOOTSTRAP_FUNCTION_ERROR_STATES,
  INITIAL_BOOTSTRAP_HTTP_STATUSES,
  INITIAL_BOOTSTRAP_METADATA_FAILURE_CODES,
  INITIAL_BOOTSTRAP_RECOVERY_REASONS,
  INITIAL_BOOTSTRAP_RECOVERY_VERDICTS,
  INITIAL_BOOTSTRAP_RUNTIME_CODES,
  INITIAL_BOOTSTRAP_YDB_DATA_FAILURE_CODES,
  READINESS_CODES,
  READINESS_TRANSPORT_CLASSES,
  R1_DIAGNOSTIC_CONTRACT,
  R1_DIAGNOSTIC_KINDS,
  classifyR1Diagnostic,
} from '../../scripts/r1-diagnostic-contract.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const source = (path) => readFile(resolve(ROOT, path), 'utf8');
const sorted = (values) => [...new Set(values)].sort();

function uppercaseStrings(text) {
  return [...text.matchAll(/["']([A-Z][A-Z0-9_]+)["']/g)].map((match) => match[1]);
}

function setBlock(text, name) {
  const match = text.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `missing ${name}`);
  return sorted(uppercaseStrings(match[1]));
}

function classifierBlock(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `missing classifier start: ${start}`);
  const endIndex = text.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing classifier end: ${end}`);
  return text.slice(startIndex, endIndex);
}

function bootstrapEvidence(overrides = {}) {
  return {
    status: 'PASS',
    code: 'INITIAL_BOOTSTRAP_COMMITTED',
    runtimeCode: null,
    applicationPhase: null,
    metadataFailureCode: null,
    ydbDataFailureCode: null,
    httpStatus: null,
    functionError: null,
    ...overrides,
  };
}

test('canonical R1 diagnostic classifier accepts only strict safe evidence shapes', () => {
  assert.equal(R1_DIAGNOSTIC_CONTRACT.version, 1);

  assert.deepEqual(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.READINESS, {
      status: 'PASS',
      code: 'READINESS_READY',
    }),
    { status: 'PASS', code: 'READINESS_READY' },
  );
  assert.deepEqual(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.READINESS, {
      status: 'FAIL',
      code: 'READINESS_INVOKE_NONZERO_UNCLASSIFIED',
      outputShape: 'STDOUT_JSON_OBJECT__STDERR_TEXT',
      transportClass: 'UNAVAILABLE',
    }),
    {
      status: 'FAIL',
      code: 'READINESS_INVOKE_NONZERO_UNCLASSIFIED',
      outputShape: 'STDOUT_JSON_OBJECT__STDERR_TEXT',
      transportClass: 'UNAVAILABLE',
    },
  );
  assert.equal(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.READINESS, {
      status: 'PASS',
      code: 'READINESS_RUNTIME_FAILED',
    }),
    null,
  );
  assert.equal(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.READINESS, {
      status: 'FAIL',
      code: 'READINESS_UNKNOWN',
    }),
    null,
  );
  assert.equal(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.READINESS, {
      status: 'FAIL',
      code: 'READINESS_CONFIG_INVALID',
      detail: 'private/raw text must never become canonical evidence',
    }),
    null,
  );

  assert.deepEqual(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP, bootstrapEvidence()),
    bootstrapEvidence(),
  );
  assert.deepEqual(
    classifyR1Diagnostic(
      R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP,
      bootstrapEvidence({
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
        runtimeCode: 'REFERENCE_APPLICATION_RUNTIME_FAILED',
        applicationPhase: 'RECONCILIATION_READ',
        metadataFailureCode: null,
        ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
      }),
    ),
    bootstrapEvidence({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_RUNTIME_FAILED',
      applicationPhase: 'RECONCILIATION_READ',
      metadataFailureCode: null,
      ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    }),
  );
  assert.deepEqual(
    classifyR1Diagnostic(
      R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP,
      bootstrapEvidence({
        status: 'FAIL',
        code: 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
        httpStatus: 'HTTP_503',
        functionError: 'PRESENT',
      }),
    ),
    bootstrapEvidence({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED',
      httpStatus: 'HTTP_503',
      functionError: 'PRESENT',
    }),
  );
  assert.equal(
    classifyR1Diagnostic(
      R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP,
      bootstrapEvidence({ status: 'FAIL', code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED' }),
    ),
    null,
  );
  assert.equal(
    classifyR1Diagnostic(
      R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP,
      bootstrapEvidence({ runtimeCode: 'REFERENCE_APPLICATION_RUNTIME_FAILED' }),
    ),
    null,
  );
  assert.equal(
    classifyR1Diagnostic(
      R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP,
      { ...bootstrapEvidence(), unexpected: 'field' },
    ),
    null,
  );

  assert.deepEqual(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP_RECOVERY, {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
    }),
    {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'RECOVERY_REQUIRED',
      reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
    },
  );
  assert.equal(
    classifyR1Diagnostic(R1_DIAGNOSTIC_KINDS.INITIAL_BOOTSTRAP_RECOVERY, {
      status: 'PASS',
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED',
      verdict: 'APPLIED',
      reason: 'EMPTY_DURABLE_STATE',
    }),
    null,
  );
  assert.equal(classifyR1Diagnostic('unknown-kind', {}), null);
});

test('canonical readiness vocabulary stays aligned with invoker and workflow classifier', async () => {
  const [invoker, workflow] = await Promise.all([
    source('scripts/invoke-yandex-readiness.mjs'),
    source('.github/workflows/r1-yandex-readiness.yml'),
  ]);

  const invokerCodes = sorted(
    uppercaseStrings(invoker).filter((value) => value.startsWith('READINESS_')),
  );
  assert.deepEqual(invokerCodes, sorted(READINESS_CODES));

  const block = classifierBlock(
    workflow,
    'tail -n 1 "$tmp" | jq -c -e',
    '> "$candidate"',
  );
  const workflowCodes = sorted(
    uppercaseStrings(block).filter((value) => value.startsWith('READINESS_')),
  );
  assert.deepEqual(workflowCodes, sorted(READINESS_CODES));
  for (const transportClass of READINESS_TRANSPORT_CLASSES) {
    assert.match(block, new RegExp(`\\b${transportClass}\\b`));
  }
});

test('canonical initial-bootstrap vocabulary stays aligned with invoker and workflow classifier', async () => {
  const [invoker, workflow] = await Promise.all([
    source('scripts/invoke-yandex-initial-bootstrap.mjs'),
    source('.github/workflows/r1-initial-shadow-bootstrap.yml'),
  ]);

  const invokerBootstrapCodes = sorted(
    uppercaseStrings(invoker).filter((value) => value.startsWith('INITIAL_BOOTSTRAP_')),
  );
  assert.deepEqual(invokerBootstrapCodes, sorted(INITIAL_BOOTSTRAP_CODES));
  assert.deepEqual(setBlock(invoker, 'REFERENCE_AWARE_RUNTIME_CODES'), sorted(INITIAL_BOOTSTRAP_RUNTIME_CODES));
  assert.deepEqual(setBlock(invoker, 'APPLICATION_PHASES'), sorted(INITIAL_BOOTSTRAP_APPLICATION_PHASES));
  assert.deepEqual(setBlock(invoker, 'METADATA_FAILURE_CODES'), sorted(INITIAL_BOOTSTRAP_METADATA_FAILURE_CODES));
  assert.deepEqual(setBlock(invoker, 'YDB_DATA_FAILURE_CODES'), sorted(INITIAL_BOOTSTRAP_YDB_DATA_FAILURE_CODES));

  const invokerHttpStatuses = sorted(
    uppercaseStrings(invoker).filter((value) => value.startsWith('HTTP_')),
  );
  assert.deepEqual(invokerHttpStatuses, sorted(INITIAL_BOOTSTRAP_HTTP_STATUSES));
  for (const state of INITIAL_BOOTSTRAP_FUNCTION_ERROR_STATES) assert.match(invoker, new RegExp(`'${state}'`));

  const block = classifierBlock(
    workflow,
    'tail -n 1 "$tmp" | jq -c -e',
    '> "$candidate"',
  );
  assert.deepEqual(
    sorted(uppercaseStrings(block).filter((value) => value.startsWith('INITIAL_BOOTSTRAP_'))),
    sorted(INITIAL_BOOTSTRAP_CODES),
  );
  assert.deepEqual(
    sorted(uppercaseStrings(block).filter((value) => value.startsWith('REFERENCE_'))),
    sorted(INITIAL_BOOTSTRAP_RUNTIME_CODES),
  );
  assert.deepEqual(
    sorted(uppercaseStrings(block).filter((value) => value.startsWith('HTTP_'))),
    sorted(INITIAL_BOOTSTRAP_HTTP_STATUSES),
  );
  for (const value of [
    ...INITIAL_BOOTSTRAP_APPLICATION_PHASES,
    ...INITIAL_BOOTSTRAP_METADATA_FAILURE_CODES,
    ...INITIAL_BOOTSTRAP_YDB_DATA_FAILURE_CODES,
    ...INITIAL_BOOTSTRAP_FUNCTION_ERROR_STATES,
  ]) {
    assert.match(block, new RegExp(`"${value}"`), `workflow classifier missing ${value}`);
  }
});

test('canonical recovery verdict/reason vocabulary stays aligned with invoker and published workflow shape', async () => {
  const [invoker, workflow] = await Promise.all([
    source('scripts/invoke-yandex-initial-bootstrap-recovery.mjs'),
    source('.github/workflows/r1-initial-bootstrap-recovery.yml'),
  ]);

  assert.deepEqual(setBlock(invoker, 'VERDICTS'), sorted(INITIAL_BOOTSTRAP_RECOVERY_VERDICTS));
  assert.deepEqual(setBlock(invoker, 'REASONS'), sorted(INITIAL_BOOTSTRAP_RECOVERY_REASONS));

  const block = classifierBlock(
    workflow,
    'tail -n 1 "$tmp" | jq -c -e',
    '> "$evidence_dir/classification.json"',
  );
  assert.match(block, /\(keys \| sort\) == \["code", "reason", "status", "verdict"\]/);
  assert.match(block, /\.status == "PASS"/);
  assert.match(block, /\.code == "INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED"/);
});
