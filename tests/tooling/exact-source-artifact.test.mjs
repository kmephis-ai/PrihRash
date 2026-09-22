import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  EXACT_SOURCE_PACKAGE_DIRECTORIES,
  createExactSourceManifest,
  verifyExactSourceManifest,
} from '../../scripts/exact-source-artifact.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

async function withSyntheticArtifact(callback) {
  const root = await mkdtemp(join(tmpdir(), 'prihrash-exact-source-'));
  try {
    for (const directory of EXACT_SOURCE_PACKAGE_DIRECTORIES) {
      const packageRoot = join(root, directory);
      await mkdir(join(packageRoot, 'nested'), { recursive: true });
      await writeFile(join(packageRoot, 'index.js'), `export const packageName = ${JSON.stringify(directory)};\n`);
      await writeFile(join(packageRoot, 'nested', 'data.txt'), `${directory}\n`);
    }
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('exact-source manifest binds the complete package allowlist to one SHA', async () => {
  await withSyntheticArtifact(async (artifactRoot) => {
    const created = await createExactSourceManifest({ artifactRoot, sourceSha: SHA });
    assert.equal(created.sourceSha, SHA);
    assert.deepEqual(Object.keys(created.packages).sort(), [...EXACT_SOURCE_PACKAGE_DIRECTORIES].sort());
    await verifyExactSourceManifest({ artifactRoot, sourceSha: SHA });
  });
});

test('exact-source verification fails closed on SHA mismatch and package mutation', async () => {
  await withSyntheticArtifact(async (artifactRoot) => {
    await createExactSourceManifest({ artifactRoot, sourceSha: SHA });
    await assert.rejects(
      verifyExactSourceManifest({ artifactRoot, sourceSha: 'fedcba9876543210fedcba9876543210fedcba98' }),
      /manifest source SHA mismatch/,
    );

    const first = EXACT_SOURCE_PACKAGE_DIRECTORIES[0];
    await writeFile(join(artifactRoot, first, 'index.js'), 'tampered\n');
    await assert.rejects(
      verifyExactSourceManifest({ artifactRoot, sourceSha: SHA }),
      new RegExp(`package digest mismatch for ${first}`),
    );
  });
});

test('manifest is privacy-safe package metadata only', async () => {
  await withSyntheticArtifact(async (artifactRoot) => {
    await createExactSourceManifest({ artifactRoot, sourceSha: SHA });
    const manifest = await readFile(join(artifactRoot, 'exact-source-manifest.json'), 'utf8');
    assert.doesNotMatch(manifest, /description|amount|note|spreadsheet|row/i);
  });
});

const providerWorkflowPaths = [
  'r1-yandex-readiness.yml',
  'r1-initial-shadow-bootstrap.yml',
  'r1-initial-bootstrap-recovery.yml',
  'r1-initial-bootstrap-orchestrator.yml',
  'r1-initial-controlled-rebuild.yml',
  'r1-ydb-schema-bootstrap.yml',
  'r1-ydb-schema-upgrade-003.yml',
  'r1-ydb-schema-upgrade-004.yml',
];

test('canonical CI publishes one exact-SHA provider artifact after the full check', async () => {
  const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const checkIndex = ci.indexOf('- run: npm run check');
  const manifestIndex = ci.indexOf('scripts/exact-source-artifact.mjs create');
  const uploadIndex = ci.indexOf('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');

  assert.ok(checkIndex >= 0 && manifestIndex > checkIndex && uploadIndex > manifestIndex);
  assert.match(ci, /name: r1-exact-source-\$\{\{ github\.sha \}\}/);
  assert.match(ci, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(ci, /include-hidden-files: true/);
  assert.doesNotMatch(ci, /path: \.artifacts\/\s*$/m);
  assert.match(ci, /\.artifacts\/exact-source-manifest\.json/);
  for (const directory of EXACT_SOURCE_PACKAGE_DIRECTORIES) {
    assert.match(ci, new RegExp(`\\.artifacts/${directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
  }
  assert.match(ci, /retention-days: 7/);
});

test('provider workflows restore the successful exact-SHA CI artifact instead of rebuilding it', async () => {
  for (const workflowName of providerWorkflowPaths) {
    const workflow = await readFile(new URL(`../../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
    assert.match(workflow, /uses: \.\/\.github\/actions\/restore-exact-source/);
    assert.match(workflow, /source-sha: \$\{\{ github\.sha \}\}/);
    assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
    assert.doesNotMatch(workflow, /npm run check|npm run package:/);
    assert.match(workflow, /actions: (?:read|write)/);
    assert.match(workflow, /cancel-in-progress: false/);
  }
});

test('restore action requires one successful canonical CI push for the exact current main SHA', async () => {
  const action = await readFile(new URL('../../.github/actions/restore-exact-source/action.yml', import.meta.url), 'utf8');
  assert.match(action, /test "\$GITHUB_SHA" = "\$SOURCE_SHA"/);
  assert.match(action, /test "\$GITHUB_REF" = 'refs\/heads\/main'/);
  assert.match(action, /actions\/workflows\/ci\.yml\/runs\?branch=main&event=push&status=success/);
  assert.match(action, /if length == 1 then \.\[0\]\.id else error\("exact CI run count mismatch"\) end/);
  assert.match(action, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/);
  assert.match(action, /scripts\/exact-source-artifact\.mjs verify/);
});
