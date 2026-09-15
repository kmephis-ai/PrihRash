import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXACT_SOURCE_ARTIFACT_SCHEMA_VERSION = 1;
export const EXACT_SOURCE_PACKAGE_DIRECTORIES = Object.freeze([
  'yandex-scheduled-sync-function',
  'yandex-schema-bootstrap-function',
  'yandex-schema-upgrade-003-function',
  'yandex-initial-bootstrap-function',
  'yandex-initial-bootstrap-recovery-function',
]);

const SHA_RE = /^[0-9a-f]{40}$/;

function fail(message) {
  throw new Error(`EXACT_SOURCE_ARTIFACT_INVALID: ${message}`);
}

async function listFiles(root, current = root, files = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      await listFiles(root, absolute, files);
    } else if (entry.isFile()) {
      files.push(absolute);
    } else {
      fail(`unsupported package entry ${relative(root, absolute)}`);
    }
  }

  return files;
}

export async function digestDirectory(directory) {
  const metadata = await stat(directory).catch(() => null);
  if (!metadata?.isDirectory()) {
    fail(`missing package directory ${directory}`);
  }

  const files = await listFiles(directory);
  if (files.length === 0) {
    fail(`empty package directory ${directory}`);
  }

  const digest = createHash('sha256');
  for (const file of files) {
    const relativePath = relative(directory, file).split(sep).join('/');
    const content = await readFile(file);
    digest.update(relativePath, 'utf8');
    digest.update('\0');
    digest.update(String(content.byteLength), 'utf8');
    digest.update('\0');
    digest.update(content);
    digest.update('\0');
  }

  return digest.digest('hex');
}

function assertSourceSha(sourceSha) {
  if (!SHA_RE.test(sourceSha)) {
    fail('source SHA must be a lowercase 40-character Git SHA');
  }
}

export async function createExactSourceManifest({ artifactRoot, sourceSha }) {
  assertSourceSha(sourceSha);
  const packages = {};

  for (const directory of EXACT_SOURCE_PACKAGE_DIRECTORIES) {
    packages[directory] = {
      directory,
      sha256: await digestDirectory(resolve(artifactRoot, directory)),
    };
  }

  const manifest = {
    schemaVersion: EXACT_SOURCE_ARTIFACT_SCHEMA_VERSION,
    sourceSha,
    packages,
  };

  await writeFile(
    resolve(artifactRoot, 'exact-source-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

export async function verifyExactSourceManifest({ artifactRoot, sourceSha }) {
  assertSourceSha(sourceSha);
  const manifestPath = resolve(artifactRoot, 'exact-source-manifest.json');
  const raw = await readFile(manifestPath, 'utf8').catch(() => null);
  if (raw === null) {
    fail('manifest missing');
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    fail('manifest JSON malformed');
  }

  if (manifest?.schemaVersion !== EXACT_SOURCE_ARTIFACT_SCHEMA_VERSION) {
    fail('manifest schema version mismatch');
  }
  if (manifest.sourceSha !== sourceSha) {
    fail('manifest source SHA mismatch');
  }

  const packageKeys = Object.keys(manifest.packages ?? {}).sort();
  const expectedKeys = [...EXACT_SOURCE_PACKAGE_DIRECTORIES].sort();
  if (JSON.stringify(packageKeys) !== JSON.stringify(expectedKeys)) {
    fail('manifest package allowlist mismatch');
  }

  for (const directory of EXACT_SOURCE_PACKAGE_DIRECTORIES) {
    const entry = manifest.packages[directory];
    if (entry?.directory !== directory || !/^[0-9a-f]{64}$/.test(entry?.sha256 ?? '')) {
      fail(`manifest package metadata invalid for ${directory}`);
    }
    const actual = await digestDirectory(resolve(artifactRoot, directory));
    if (actual !== entry.sha256) {
      fail(`package digest mismatch for ${directory}`);
    }
  }

  return manifest;
}

async function main() {
  const [command, sourceSha] = process.argv.slice(2);
  const artifactRoot = resolve(process.cwd(), '.artifacts');
  if (command === 'create') {
    await createExactSourceManifest({ artifactRoot, sourceSha });
  } else if (command === 'verify') {
    await verifyExactSourceManifest({ artifactRoot, sourceSha });
  } else {
    fail('usage: exact-source-artifact.mjs <create|verify> <source-sha>');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'EXACT_SOURCE_ARTIFACT_INVALID');
    process.exitCode = 1;
  });
}
