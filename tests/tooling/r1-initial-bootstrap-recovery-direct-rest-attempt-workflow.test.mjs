import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile(
  '.github/workflows/r1-initial-bootstrap-recovery-direct-rest-attempt.yml', 'utf8',
)).replace(/\r\n/g, '\n');
const runbook = (await readFile('docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md', 'utf8')).replace(/\r\n/g, '\n');

test('direct REST one-shot is exact-main, exact-authority and has its own one-shot history', () => {
  assert.match(workflow, /name: R1 direct REST recovery CreateVersion attempt/);
  assert.match(workflow, /run-name: R1 direct REST recovery CreateVersion for failed run/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT.*'1'/);
  assert.match(workflow, /r1-initial-bootstrap-recovery-direct-rest-attempt\.yml\/runs/);
  assert.match(workflow, /RECOVERY_DIRECT_REST_ATTEMPT_SAME_SHA_REPLAY_FORBIDDEN/);
  assert.match(workflow, /RECOVERY_DIRECT_REST_ATTEMPT_ALREADY_CONSUMED_OR_UNCLASSIFIED/);
  assert.match(workflow, /Create exactly one recovery Function version via direct REST without invoking it"[\s\S]*?\.conclusion == "skipped"/);
  assert.match(workflow, /37680553048/);
  assert.match(workflow, /37727175095/);
  assert.match(workflow, /RECOVERY_DIRECT_REST_PREWRITE_PHASE_NOT_PROVEN/);
  assert.match(workflow, /RECOVERY_DIRECT_REST_CONSUMED_PHASE_NOT_PROVEN/);
  assert.match(workflow, /Authority-Comment-ID: 6056859760/);
  assert.match(workflow, /OWNER_AUTHORIZED_DIRECT_REST_RECOVERY_DEPLOY/);
  assert.match(workflow, /Recovery-Consumed-Run-ID: 37727175095/);
  assert.match(workflow, /RECOVERY_ONLY_FUNCTION_VERSION_CREATE_REST_CLASSIFIED/);
});

test('direct REST source PR cannot expand product or deployment packaging authority', () => {
  assert.match(workflow, /r1-initial-bootstrap-recovery-direct-rest-attempt\.yml/);
  assert.match(workflow, /classify-yandex-function-create-version-rest\.mjs/);
  assert.match(workflow, /yandex-function-create-version-rest-classifier\.test\.mjs/);
  assert.match(workflow, /r1-initial-bootstrap-recovery-direct-rest-attempt-workflow\.test\.mjs/);
  assert.match(workflow, /startswith\("src\/"\)/);
  assert.match(workflow, /package-lock\.json/);
  assert.match(workflow, /package-yandex-initial-bootstrap-recovery-function\.mjs/);
});

test('provider preflight remains private trigger-free and exact-reference gated before POST', () => {
  assert.match(workflow, /serverless-functions\.api\.cloud\.yandex\.net\/functions\/v1\/functions/);
  assert.match(workflow, /:listAccessBindings/);
  assert.match(workflow, /classify-yandex-function-access-bindings\.mjs/);
  assert.match(workflow, /serverless-triggers\.api\.cloud\.yandex\.net\/triggers\/v1\/triggers/);
  assert.match(workflow, /classify-yandex-trigger-list\.mjs/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_FUNCTION_PUBLIC/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_EDITOR_BINDING_MISSING/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_TRIGGER_PRESENT/);
  assert.match(workflow, /RECOVERY_DEPLOY_ATTEMPT_LOCKBOX_METADATA_INVALID/);
});

test('create transport is one direct REST POST with exact-source inline content and no yc create', () => {
  assert.match(workflow, /Create exactly one recovery Function version via direct REST without invoking it/);
  assert.match(workflow, /recovery-package\.zip/);
  assert.match(workflow, /base64 --wrap=0/);
  assert.match(workflow, /--rawfile content/);
  assert.match(workflow, /resources: \{memory: "1073741824"\}/);
  assert.match(workflow, /executionTimeout: "150s"/);
  assert.match(workflow, /content: \$content/);
  assert.match(workflow, /logOptions: \{disabled:true\}/);
  assert.match(workflow, /gceHttpEndpoint:"ENABLED"/);
  assert.match(workflow, /awsV1HttpEndpoint:"DISABLED"/);
  assert.match(workflow, /https:\/\/serverless-functions\.api\.cloud\.yandex\.net\/functions\/v1\/versions/);
  assert.match(workflow, /--request POST/);
  assert.doesNotMatch(workflow, /yc serverless function version create/);
  assert.doesNotMatch(workflow, /--retry [1-9]/);
});

test('direct REST request preserves only secret references and never reads payload values', () => {
  for (const key of [
    'google_spreadsheet_id',
    'google_service_account_email',
    'google_service_account_private_key',
    'ydb_connection_string',
    'initial_bootstrap_private_historical_evidence',
  ]) assert.match(workflow, new RegExp(`key:"${key}"`));
  assert.match(workflow, /versionId:\$secretVersionId/);
  assert.match(workflow, /environmentVariable:"PRIHRASH_/);
  assert.doesNotMatch(workflow, /lockbox payload get|secret payload|payloadEntries/);
});

test('accepted POST is followed only by read-only Operation and Function operation evidence', () => {
  assert.match(workflow, /operation\.api\.cloud\.yandex\.net\/operations\/\$\{encoded_operation_id\}/);
  assert.match(workflow, /functions\/v1\/functions\/\$\{encoded_function_id\}\/operations/);
  assert.match(workflow, /classify-yandex-function-create-version-rest\.mjs/);
  assert.match(workflow, /direct-rest-create\.json/);
  assert.match(workflow, /RECOVERY_DIRECT_REST_CREATE_CLASSIFIED_NON_ACCEPTED_NO_RETRY/);
  assert.match(workflow, /RECOVERY_DIRECT_REST_CREATE_OPERATION_NOT_SUCCESSFUL_NO_RETRY/);
  assert.doesNotMatch(workflow, /serverless function invoke|functions\.yandexcloud\.net/);
  assert.doesNotMatch(workflow, /yc ydb|migration_runs|source_records|source_snapshots/);
  assert.doesNotMatch(workflow, /add-access-binding|set-access-bindings|remove-access-binding/);
});

test('raw request, provider response and operation evidence are runner-local only', () => {
  assert.match(workflow, /r1-direct-rest-create-evidence\/\*\.json/);
  assert.doesNotMatch(workflow, /path:.*create-request\.json/);
  assert.doesNotMatch(workflow, /path:.*create-response\.json/);
  assert.doesNotMatch(workflow, /path:.*operation\.json/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/create-response\.json"/);
  assert.doesNotMatch(workflow, /cat "\$tmp\/operation\.json"/);
});

test('runbook documents the second Owner authority as a separate consumed-CLI bypass', () => {
  const section = runbook.match(
    /### 2026-10-08 Owner-authorized direct REST recovery CreateVersion([\s\S]*?)(?=\n### |\n## |$)/,
  )?.[1];
  assert.ok(section);
  assert.match(section, /6056859760/);
  assert.match(section, /37727175095/);
  assert.match(section, /OWNER_AUTHORIZED_DIRECT_REST_RECOVERY_DEPLOY/);
  assert.match(section, /Function invoke.*not authorized/i);
});
