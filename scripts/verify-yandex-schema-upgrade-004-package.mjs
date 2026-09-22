import { access, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-schema-upgrade-004-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = JSON.parse(await readFile(resolve(ARTIFACT_ROOT, 'package.json'), 'utf8'));
const allowedDependencies = [
  '@ydbjs/api',
  '@ydbjs/auth',
  '@ydbjs/core',
  '@ydbjs/query',
  '@ydbjs/value',
];
const requiredFiles = [
  'index.js',
  'package.json',
  'dist/runtime/yandexCloudSchemaUpgrade004Function.js',
  'dist/runtime/ydbSchemaUpgrade004.js',
  'dist/integration/ydb/ydbJsV6SchemaBootstrapClient.js',
  'dist/integration/ydb/adapter.js',
  'dist/integration/ydb/parameters.js',
  'migrations/004_source_record_revision_run_index.sql',
];

const fail = (message) => {
  throw new Error(`YANDEX_SCHEMA_UPGRADE_004_PACKAGE_INVALID: ${message}`);
};

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(relative(ARTIFACT_ROOT, path).split(sep).join('/'));
    else fail(`unsupported filesystem entry: ${entry.name}`);
  }
  return result.sort();
}

for (const required of requiredFiles) await access(resolve(ARTIFACT_ROOT, required));
const files = await filesUnder(ARTIFACT_ROOT);
if (JSON.stringify(files) !== JSON.stringify([...requiredFiles].sort())) {
  fail(`unexpected deployment file set: ${files.join(',')}`);
}

const indexSource = await readFile(resolve(ARTIFACT_ROOT, 'index.js'), 'utf8');
if (indexSource !== "export { schemaUpgrade004Handler } from './dist/runtime/yandexCloudSchemaUpgrade004Function.js';\n") {
  fail('root index.js is not the reviewed migration-004-only handler shim');
}

if (runtimePackage.name !== 'prihrash-yandex-schema-upgrade-004-function') fail('unexpected package name');
if (runtimePackage.version !== rootPackage.version) fail('version differs from root package');
if (runtimePackage.private !== true || runtimePackage.type !== 'module') fail('runtime package metadata mismatch');
if (JSON.stringify(runtimePackage.engines) !== JSON.stringify(rootPackage.engines)) fail('Node engine mismatch');
if (JSON.stringify(Object.keys(runtimePackage.dependencies ?? {}).sort()) !== JSON.stringify([...allowedDependencies].sort())) {
  fail('runtime dependency surface is not the exact migration-004 allowlist');
}
for (const name of allowedDependencies) {
  if (runtimePackage.dependencies[name] !== rootPackage.dependencies[name]) {
    fail(`runtime dependency differs from exact-pinned root dependency: ${name}`);
  }
}
for (const forbiddenKey of ['devDependencies', 'scripts', 'optionalDependencies', 'peerDependencies']) {
  if (Object.hasOwn(runtimePackage, forbiddenKey)) fail(`forbidden package key: ${forbiddenKey}`);
}

const packaged = await readFile(resolve(ARTIFACT_ROOT, 'migrations', '004_source_record_revision_run_index.sql'));
const canonical = await readFile(resolve(ROOT, 'db', 'migrations', '004_source_record_revision_run_index.sql'));
if (!packaged.equals(canonical)) fail('migration 004 bytes differ from canonical source');

for (const forbidden of [
  'migrations/001_initial.sql',
  'migrations/002_reference_source_labels.sql',
  'migrations/003_initial_bootstrap_identity_manifest.sql',
  'db/auth/001_owner_auth.sql',
  'dist/runtime/ydbSchemaBootstrap.js',
  'dist/runtime/yandexCloudSchemaBootstrapFunction.js',
  'dist/runtime/yandexCloudScheduledSyncFunction.js',
  'dist/runtime/scheduledSyncJob.js',
]) {
  if (files.includes(forbidden)) fail(`forbidden migration-004 content: ${forbidden}`);
}

process.stdout.write(`Yandex schema upgrade 004 package verified: ${files.length} files\n`);
