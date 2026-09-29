import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyExactMainCiRun } from '../../scripts/classify-github-ci-run.mjs';

const runId = '36473073042';
const sha = '793c11cf5cbb609a94ef5331f07bda5bcb7d884f';

function exactRun(overrides = {}) {
  return {
    id: Number(runId),
    name: 'CI',
    head_sha: sha,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

test('exact triggering main CI run passes with its run ID, SHA, branch, event, and conclusion bound', () => {
  assert.equal(classifyExactMainCiRun(exactRun(), runId, sha), 'CI_RUN_EXACT_SUCCESS');
});

test('exact manually dispatched main CI run passes with the same exact identity and successful conclusion', () => {
  assert.equal(classifyExactMainCiRun(exactRun({ event: 'workflow_dispatch' }), runId, sha), 'CI_RUN_EXACT_SUCCESS');
});

test('CI run lookup fails closed for mismatched or incomplete identity and state', () => {
  assert.equal(classifyExactMainCiRun(exactRun({ id: Number(runId) + 1 }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ name: 'Browser Quality' }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ head_sha: 'a'.repeat(40) }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ head_branch: 'feature' }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ event: 'pull_request' }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ event: 'repository_dispatch' }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ event: 'workflow_dispatch', head_branch: 'feature' }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ status: 'in_progress', conclusion: null }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun({ conclusion: 'failure' }), runId, sha), 'CI_RUN_NOT_EXACT_SUCCESS');
  assert.equal(classifyExactMainCiRun(exactRun(), '0', sha), 'CI_RUN_INPUT_INVALID');
  assert.equal(classifyExactMainCiRun(exactRun(), runId, 'invalid-sha'), 'CI_RUN_INPUT_INVALID');
  assert.equal(classifyExactMainCiRun(null, runId, sha), 'CI_RUN_INPUT_INVALID');
});
