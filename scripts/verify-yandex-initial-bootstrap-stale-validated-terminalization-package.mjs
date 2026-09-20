import { access, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-initial-bootstrap-stale-validated-terminalization-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = JSON.parse(await readFile(resolve(ARTIFACT_ROOT, 'package.json'), 'utf8'));
const fail = (message) => { throw new Error(`YANDEX_INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_PACKAGE_INVALID: ${message}`); };

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

for (const required of [
  'index.js',
  'package.json',
  'dist/runtime/initialBootstrapRecoveryConfig.js',
  'dist/runtime/initialBootstrapRecoveryJob.js',
  'dist/runtime/initialBootstrapStaleValidatedTerminalizationJob.js',
  'dist/runtime/yandexCloudInitialBootstrapStaleValidatedTerminalizationFunction.js',
  'dist/migration/initialBootstrapStaleValidatedTerminalization.js',
  'dist/migration/initialBootstrapGateCGuard.js',
  'dist/migration/migrationRunLifecycleExecutor.js',
  'dist/migration/migrationRunPersistence.js',
]) await access(resolve(ARTIFACT_ROOT, required));

const expectedIndex = "export { initialBootstrapStaleValidatedTerminalizationHandler } from './dist/runtime/yandexCloudInitialBootstrapStaleValidatedTerminalizationFunction.js';\n";
if (await readFile(resolve(ARTIFACT_ROOT, 'index.js'), 'utf8') !== expectedIndex) fail('root index is not the reviewed Gate B handler shim');
if (runtimePackage.name !== 'prihrash-yandex-initial-bootstrap-stale-validated-terminalization-function') fail('unexpected package name');
if (runtimePackage.version !== rootPackage.version || runtimePackage.private !== true || runtimePackage.type !== 'module') fail('runtime package metadata mismatch');
if (JSON.stringify(runtimePackage.engines) !== JSON.stringify(rootPackage.engines)) fail('Node engine mismatch');
if (JSON.stringify(runtimePackage.dependencies) !== JSON.stringify(rootPackage.dependencies)) fail('runtime dependencies differ from root dependencies');
for (const key of ['devDependencies', 'scripts', 'optionalDependencies', 'peerDependencies']) if (Object.hasOwn(runtimePackage, key)) fail(`forbidden package key: ${key}`);

const files = await filesUnder(ARTIFACT_ROOT);
const runtimeFiles = files.filter((file) => file.startsWith('dist/runtime/'));
const allowedRuntimeBases = new Set([
  'initialBootstrapRecoveryConfig',
  'initialBootstrapRecoveryJob',
  'initialBootstrapStaleValidatedTerminalizationJob',
  'yandexCloudInitialBootstrapStaleValidatedTerminalizationFunction',
]);
for (const file of runtimeFiles) {
  const base = file.slice('dist/runtime/'.length).replace(/\.(?:d\.ts|js|js\.map)$/, '');
  if (!allowedRuntimeBases.has(base)) fail(`runtime surface is not Gate-B-only: ${file}`);
}

for (const forbidden of [
  'dist/integration/ydb/ydbJsV6SchemaBootstrapClient.js',
  'dist/runtime/yandexCloudInitialBootstrapFunction.js',
  'dist/runtime/yandexCloudInitialControlledRebuildFunction.js',
  'dist/runtime/yandexCloudScheduledSyncFunction.js',
  'dist/runtime/yandexCloudSchemaBootstrapFunction.js',
  'dist/runtime/yandexCloudSchemaUpgrade003Function.js',
]) if (files.includes(forbidden)) fail(`forbidden runtime content: ${forbidden}`);

for (const relativePath of [
  'dist/runtime/initialBootstrapStaleValidatedTerminalizationJob.js',
  'dist/runtime/yandexCloudInitialBootstrapStaleValidatedTerminalizationFunction.js',
]) {
  const source = await readFile(resolve(ARTIFACT_ROOT, relativePath), 'utf8');
  for (const forbiddenToken of ['renameTables(', 'copyTables(', 'removeDirectory(', 'dropTable(', 'deleteTable(']) {
    if (source.includes(forbiddenToken)) fail(`Gate B runtime contains forbidden scheme/data mutation token ${forbiddenToken}`);
  }
}
const terminalizer = await readFile(resolve(ARTIFACT_ROOT, 'dist/migration/initialBootstrapStaleValidatedTerminalization.js'), 'utf8');
if (!terminalizer.includes('INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT')) fail('fixed failure marker is missing');
if (!terminalizer.includes('serializableReadWrite')) fail('marker transaction is missing');

const forbiddenPrefixes = ['tests/', 'docs/', 'db/', 'scripts/', '.github/', 'private/', 'node_modules/'];
for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) fail(`forbidden path: ${file}`);
  if (file === '.env' || file.startsWith('.env.') || file.endsWith('.private.json')) fail(`private/config path: ${file}`);
}
if (files.some((file) => !['index.js', 'package.json'].includes(file) && !file.startsWith('dist/'))) fail('unexpected top-level deployment content');

process.stdout.write(`Yandex stale VALIDATED Gate B package verified: ${files.length} files\n`);
