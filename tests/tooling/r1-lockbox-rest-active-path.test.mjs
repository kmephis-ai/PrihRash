import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');

async function workflow(name) {
  return readFile(resolve(ROOT, '.github/workflows', name), 'utf8');
}

const byIdWorkflows = [
  'r1-initial-bootstrap-orchestrator.yml',
  'r1-initial-shadow-bootstrap.yml',
  'r1-initial-bootstrap-recovery.yml',
];

test('active R1 by-id Lockbox metadata resolution uses the proven REST Secret.Get path', async () => {
  for (const name of byIdWorkflows) {
    const source = await workflow(name);

    assert.match(
      source,
      /https:\/\/lockbox\.api\.cloud\.yandex\.net\/lockbox\/v1\/secrets\/\$\{YC_LOCKBOX_SECRET_ID\}/,
      `${name} must resolve the exact Lockbox locator through REST`,
    );
    assert.match(source, /Authorization: Bearer \$\{YC_IAM_TOKEN\}/);
    assert.match(source, /\.folderId == \$expected_folder_id/);
    assert.match(source, /\.status == "ACTIVE"/);
    assert.match(source, /\.currentVersion\.id/);
    assert.doesNotMatch(source, /yc lockbox secret get/);
    assert.doesNotMatch(source, /payload\.lockbox\.api\.cloud\.yandex\.net/);
  }
});

test('readiness resolves its named Lockbox secret through a bounded exact REST list', async () => {
  const source = await workflow('r1-yandex-readiness.yml');

  assert.match(source, /https:\/\/lockbox\.api\.cloud\.yandex\.net\/lockbox\/v1\/secrets/);
  assert.match(source, /Authorization: Bearer \$\{YC_IAM_TOKEN\}/);
  assert.match(source, /--data-urlencode "folderId=\$\{YC_FOLDER_ID\}"/);
  assert.match(source, /--data-urlencode 'pageSize=1000'/);
  assert.match(source, /\(\.nextPageToken \/\/ ""\) == ""/);
  assert.match(source, /\.name == \$expected_name/);
  assert.match(source, /\.folderId == \$expected_folder_id/);
  assert.match(source, /\.status == "ACTIVE"/);
  assert.match(source, /length == 1/);
  assert.match(source, /\.currentVersion\.id/);
  assert.doesNotMatch(source, /yc lockbox secret get/);
  assert.doesNotMatch(source, /payload\.lockbox\.api\.cloud\.yandex\.net/);
});

test('active R1 REST metadata failures stay enum-only and fail closed', async () => {
  const sources = await Promise.all([
    workflow('r1-initial-bootstrap-orchestrator.yml'),
    workflow('r1-yandex-readiness.yml'),
    workflow('r1-initial-shadow-bootstrap.yml'),
    workflow('r1-initial-bootstrap-recovery.yml'),
  ]);

  for (const source of sources) {
    assert.match(source, /LOCKBOX_REST_TRANSPORT_FAILED/);
    assert.match(source, /LOCKBOX_REST_AUTH_FAILED/);
    assert.match(source, /LOCKBOX_REST_PERMISSION_DENIED/);
    assert.match(source, /LOCKBOX_REST_NOT_FOUND/);
    assert.match(source, /LOCKBOX_REST_UNEXPECTED_STATUS/);
    assert.doesNotMatch(source, /cat\s+[^\n]*(?:secret|secrets)\.json/);
    assert.doesNotMatch(source, /echo\s+[^\n]*(?:secret|secrets)\.json/);
  }
});
