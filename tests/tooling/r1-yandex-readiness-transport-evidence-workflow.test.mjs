import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/r1-yandex-readiness.yml');

async function workflowText() {
  return readFile(WORKFLOW, 'utf8');
}

test('readiness artifact allows only enum-only transport classification for unclassified non-zero invokes', async () => {
  const workflow = await workflowText();

  assert.match(workflow, /\["code", "outputShape", "status", "transportClass"\]/);
  assert.match(workflow, /\.code == "READINESS_INVOKE_NONZERO_UNCLASSIFIED"/);
  assert.match(workflow, /\.transportClass \| type\) == "string"/);
  assert.match(
    workflow,
    /\^\(EMPTY\|AUTH\|NOT_FOUND\|RATE_LIMIT\|DEADLINE\|UNAVAILABLE\|FUNCTION_ERROR\|INVALID_REQUEST\|FAILED_PRECONDITION\|INTERNAL\|OTHER\)\$/,
  );
  assert.match(workflow, /then \{status, code, outputShape, transportClass\}/);
  assert.doesNotMatch(workflow, /then \{status, code, outputShape, transportClass, stderr\}/);
  assert.doesNotMatch(workflow, /classification\.json[^\n]*(stderr|stdout)/i);
});
