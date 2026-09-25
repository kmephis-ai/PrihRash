import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile(
  new URL('../../.github/workflows/r1-initial-bootstrap-recovery-autocontinue.yml', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

test('recovery autocontinue is a bounded exact-main read-only dispatch surface', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\n\s*- CI/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /actions:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.match(workflow, /Provider-Attempt: NOT_AUTHORIZED/);
  assert.match(workflow, /Recovery-Probe: READY/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION/);
  assert.match(workflow, /Expected-Transition: READ_ONLY_DURABLE_CLASSIFICATION/);
  assert.match(workflow, /Recovery-State: STAGING_PRESENT_UNCLASSIFIED/);
  assert.match(workflow, /"surface_only":"true"/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_WRITER_ACTIVE/);
  assert.match(workflow, /R1_RECOVERY_AUTOCONTINUE_ALREADY_DISPATCHED/);
  assert.match(workflow, /r1-initial-bootstrap-recovery\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-yandex-readiness\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-bootstrap-orchestrator\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /r1-initial-shadow-bootstrap\.yml\/dispatches/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('unknown durable outcome accepts only the read-only classification marker pair', (t) => {
  const filter = workflow.match(/marker="\$\(jq -Rn --arg body "\$source_pr_body" '\n([\s\S]*?)\n          '\)"/)?.[1];
  assert.ok(filter, 'extract the live jq marker filter from the workflow');
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (jq.error?.code === 'ENOENT') {
    t.skip('jq CLI is unavailable');
    return;
  }

  const valid = (overrides = {}) => {
    const lines = {
      'Provider-Attempt': 'NOT_AUTHORIZED',
      'Recovery-Probe': 'READY',
      'Expected-Transition': 'READ_ONLY_DURABLE_CLASSIFICATION',
      'Recovery-State': 'UNKNOWN_AFTER_NON_SUCCESS',
      'Regression-Test': 'tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs',
      ...overrides,
    };
    const body = Object.entries(lines).map(([key, value]) => `${key}: ${value}`).join('\n');
    const result = spawnSync('jq', ['-Rn', '--arg', 'body', body, filter], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  assert.deepEqual(valid(), { valid: true, surfaceOnly: true });
  assert.equal(valid({ 'Provider-Attempt': 'READY' }).valid, false);
  assert.equal(valid({ 'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION' }).valid, false);
  assert.equal(valid({ 'Recovery-State': 'UNKNOWN_AFTER_NON_SUCCESS\nRecovery-State: UNKNOWN_AFTER_NON_SUCCESS' }).valid, false);
  assert.equal(valid({ 'Recovery-State': 'STAGING_RESUMABLE' }).valid, false);
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_PRESENT_UNCLASSIFIED',
  }), { valid: true, surfaceOnly: false });
  assert.deepEqual(valid({
    'Expected-Transition': 'READ_ONLY_EXACT_REVISION_CLASSIFICATION',
    'Recovery-State': 'STAGING_RESUMABLE',
  }), { valid: true, surfaceOnly: false });
});
