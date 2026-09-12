import { access, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-initial-bootstrap-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = JSON.parse(await readFile(resolve(ARTIFACT_ROOT, 'package.json'), 'utf8'));

const fail = (message) => {
  throw new Error(`YANDEX_INITIAL_BOOTSTRAP_PACKAGE_INVALID: ${message}`);
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

const requiredFiles = [
  'index.js',
  'package.json',
  'dist/runtime/initialBootstrapJob.js',
  'dist/runtime/initialBootstrapReferenceAwareJob.js',
  'dist/runtime/initialBootstrapReferenceClaimAdapter.js',
  'dist/runtime/yandexCloudInitialBootstrapFunction.js',
];
for (const required of requiredFiles) await access(resolve(ARTIFACT_ROOT, required));

const indexSource = await readFile(resolve(ARTIFACT_ROOT, 'index.js'), 'utf8');
if (indexSource !== "export { initialBootstrapHandler } from './dist/runtime/yandexCloudInitialBootstrapFunction.js';\n") {
  fail('root index.js is not the reviewed initial-bootstrap-only handler shim');
}

if (runtimePackage.name !== 'prihrash-yandex-initial-bootstrap-function') fail('unexpected package name');
if (runtimePackage.version !== rootPackage.version) fail('version differs from root package');
if (runtimePackage.private !== true || runtimePackage.type !== 'module') fail('runtime package metadata mismatch');
if (JSON.stringify(runtimePackage.engines) !== JSON.stringify(rootPackage.engines)) fail('Node engine mismatch');
if (JSON.stringify(runtimePackage.dependencies) !== JSON.stringify(rootPackage.dependencies)) {
  fail('runtime dependencies differ from exact-pinned root dependencies');
}
for (const forbiddenKey of ['devDependencies', 'scripts', 'optionalDependencies', 'peerDependencies']) {
  if (Object.hasOwn(runtimePackage, forbiddenKey)) fail(`forbidden package key: ${forbiddenKey}`);
}

const files = await filesUnder(ARTIFACT_ROOT);
const runtimeFiles = files.filter((file) => file.startsWith('dist/runtime/'));
const allowedRuntimeFiles = [
  'dist/runtime/initialBootstrapJob.d.ts',
  'dist/runtime/initialBootstrapJob.js',
  'dist/runtime/initialBootstrapJob.js.map',
  'dist/runtime/initialBootstrapReferenceAwareJob.d.ts',
  'dist/runtime/initialBootstrapReferenceAwareJob.js',
  'dist/runtime/initialBootstrapReferenceAwareJob.js.map',
  'dist/runtime/initialBootstrapReferenceClaimAdapter.d.ts',
  'dist/runtime/initialBootstrapReferenceClaimAdapter.js',
  'dist/runtime/initialBootstrapReferenceClaimAdapter.js.map',
  'dist/runtime/yandexCloudInitialBootstrapFunction.d.ts',
  'dist/runtime/yandexCloudInitialBootstrapFunction.js',
  'dist/runtime/yandexCloudInitialBootstrapFunction.js.map',
].filter((file) => files.includes(file));
if (JSON.stringify(runtimeFiles) !== JSON.stringify(allowedRuntimeFiles.sort())) {
  fail(`runtime surface is not bootstrap-only: ${runtimeFiles.join(',')}`);
}

for (const forbidden of [
  'dist/integration/ydb/ydbJsV6SchemaBootstrapClient.js',
  'dist/runtime/yandexCloudScheduledSyncFunction.js',
  'dist/runtime/scheduledSyncJob.js',
  'dist/runtime/scheduledSyncReadinessProbe.js',
  'dist/runtime/yandexCloudSchemaBootstrapFunction.js',
  'dist/runtime/ydbSchemaBootstrap.js',
  'dist/runtime/yandexCloudSchemaUpgrade003Function.js',
  'dist/runtime/ydbSchemaUpgrade003.js',
]) {
  if (files.includes(forbidden)) fail(`forbidden runtime content: ${forbidden}`);
}

const forbiddenPrefixes = ['tests/', 'docs/', 'db/', 'scripts/', '.github/', 'private/', 'node_modules/'];
for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) fail(`forbidden path: ${file}`);
  if (file === '.env' || file.startsWith('.env.') || file.endsWith('.private.json')) {
    fail(`private/config path: ${file}`);
  }
}
if (files.some((file) => !['index.js', 'package.json'].includes(file) && !file.startsWith('dist/'))) {
  fail('unexpected top-level deployment content');
}

process.stdout.write(`Yandex initial bootstrap package verified: ${files.length} files\n`);
